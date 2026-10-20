//! Todo task model.

use rusqlite::{params, Row};
use serde::Serialize;

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::{time, windows};

/// Columns every query selects, in the order [`Todo::from_row`] reads them.
const COLUMNS: &str =
    "id, title, completed, created_at, updated_at, tag_ids, start_at, end_at, starred_at";

/// Starred tasks first, the most recently starred on top; everything else keeps its old order.
const ORDER: &str = "completed, starred_at IS NULL, starred_at DESC, id DESC";

/// A task the user maintains.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: i64,
    pub title: String,
    pub completed: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Ids of the tags the task carries, cached from the `todo_tags` link table.
    pub tag_ids: Vec<i64>,
    /// When the task is planned to start, UTC epoch seconds; `None` when it has no start.
    pub start_at: Option<i64>,
    /// When the task is planned to end, UTC epoch seconds; `None` when it has no end.
    pub end_at: Option<i64>,
    /// When the task was pinned to the top of its group, UTC epoch seconds; `None` when it is not.
    pub starred_at: Option<i64>,
}

/// Totals shown beside the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCounts {
    pub total: i64,
    pub remaining: i64,
    pub completed: i64,
}

/// How many tasks are finished: today, and in total.
///
/// A task is a plan for later, so "three of five done" says nothing about the day. What the app
/// shows instead is a count of finished tasks, dated by `completed_at`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCompletions {
    /// Tasks finished since local midnight.
    pub today: i64,
    /// Every finished task still stored; a row finished before `completed_at` existed counts here
    /// only, because there is no day to put it on.
    pub all: i64,
}

impl Todo {
    /// Maps one `todos` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            title: row.get(1)?,
            completed: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            tag_ids: parse_tag_ids(&row.get::<_, String>(5)?)?,
            start_at: row.get(6)?,
            end_at: row.get(7)?,
            starred_at: row.get(8)?,
        })
    }

    /// Lists tasks, open ones first and newest first, starred ones on top of either group;
    /// `completed` narrows the result.
    pub fn list(db: &Db, completed: Option<bool>) -> ApiResult<Vec<Self>> {
        let condition = match completed {
            None => "",
            Some(false) => " WHERE completed = 0",
            Some(true) => " WHERE completed = 1",
        };
        let sql = format!("SELECT {COLUMNS} FROM todos{condition} ORDER BY {ORDER}");

        repository::query_all(db, &sql, [], Self::from_row)
    }

    /// Returns one task; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM todos WHERE id = ?1"),
            [id],
            Self::from_row,
        )
    }

    /// Inserts a task and answers with the stored row; a blank title is `INVALID_INPUT`.
    pub fn add(
        db: &Db,
        title: &str,
        start_at: Option<i64>,
        end_at: Option<i64>,
    ) -> ApiResult<Self> {
        let title = validate_title(title)?;
        let start_at = validate_instant(start_at, "start_at")?;
        let end_at = validate_instant(end_at, "end_at")?;
        let now = time::now_seconds();
        let id = repository::insert(
            db,
            "INSERT INTO todos (title, completed, created_at, updated_at, start_at, end_at)
             VALUES (?1, 0, ?2, ?2, ?3, ?4)",
            params![title, now, start_at, end_at],
        )?;

        Self::find(db, id)
    }

    /// Renames a task; a missing id is `NOT_FOUND`.
    pub fn rename(db: &Db, id: i64, title: &str) -> ApiResult<Self> {
        let title = validate_title(title)?;
        let changed = repository::execute(
            db,
            "UPDATE todos SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Sets the completion flag, stamping `completed_at` when the task is done and clearing it
    /// when it is reopened; a missing id is `NOT_FOUND`.
    pub fn set_completed(db: &Db, id: i64, completed: bool) -> ApiResult<Self> {
        let changed = repository::execute(
            db,
            "UPDATE todos
             SET completed = ?1,
                 completed_at = CASE WHEN ?1 THEN ?2 ELSE NULL END,
                 updated_at = ?2
             WHERE id = ?3",
            params![completed, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Sets or clears the moment a task is planned to start; a missing id is `NOT_FOUND`.
    pub fn set_start_at(db: &Db, id: i64, start_at: Option<i64>) -> ApiResult<Self> {
        let start_at = validate_instant(start_at, "start_at")?;
        let changed = repository::execute(
            db,
            "UPDATE todos SET start_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![start_at, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Sets or clears the moment a task is planned to end; a missing id is `NOT_FOUND`.
    pub fn set_end_at(db: &Db, id: i64, end_at: Option<i64>) -> ApiResult<Self> {
        let end_at = validate_instant(end_at, "end_at")?;
        let changed = repository::execute(
            db,
            "UPDATE todos SET end_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![end_at, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Pins or unpins a task; a missing id is `NOT_FOUND`.
    ///
    /// The pin is stored as the moment it was made rather than as a flag, because the list puts the
    /// most recently starred task on top: pinning again is a fresh pin and moves the task up.
    pub fn set_starred(db: &Db, id: i64, starred: bool) -> ApiResult<Self> {
        let now = time::now_seconds();
        let changed = repository::execute(
            db,
            "UPDATE todos SET starred_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![starred.then_some(now), now, id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Deletes a task; a missing id is `NOT_FOUND`.
    pub fn delete(db: &Db, id: i64) -> ApiResult<()> {
        let changed = repository::execute(db, "DELETE FROM todos WHERE id = ?1", [id])?;

        require_changed(changed, id)
    }

    /// Replaces the tags of a task; the cached id list and the link table move together.
    pub fn set_tags(db: &Db, id: i64, tag_ids: &[i64]) -> ApiResult<Self> {
        Self::find(db, id)?;

        let mut ids = tag_ids.to_vec();
        ids.sort_unstable();
        ids.dedup();

        for tag_id in &ids {
            let known = repository::exists(db, "SELECT 1 FROM tags WHERE id = ?1", [*tag_id])?;

            if !known {
                return Err(ApiError::not_found(format!("no tag with id {tag_id}")));
            }
        }

        let stored = serde_json::to_string(&ids)?;

        repository::transaction(db, |transaction| {
            transaction.execute(
                "UPDATE todos SET tag_ids = ?1, updated_at = ?2 WHERE id = ?3",
                params![stored, time::now_seconds(), id],
            )?;
            transaction.execute("DELETE FROM todo_tags WHERE todo_id = ?1", [id])?;

            for tag_id in &ids {
                transaction.execute(
                    "INSERT INTO todo_tags (todo_id, tag_id) VALUES (?1, ?2)",
                    params![id, tag_id],
                )?;
            }

            Ok(())
        })?;

        Self::find(db, id)
    }

    /// Lists the tasks carrying one tag; the reverse lookup through the link table.
    pub fn list_by_tag(db: &Db, tag_id: i64) -> ApiResult<Vec<Self>> {
        repository::query_all(
            db,
            &format!(
                "SELECT {COLUMNS} FROM todos
                   INNER JOIN todo_tags ON todo_tags.todo_id = todos.id
                  WHERE todo_tags.tag_id = ?1
                  ORDER BY {ORDER}"
            ),
            [tag_id],
            Self::from_row,
        )
    }
}

/// Reads the cached id list; a malformed column is reported as `INTERNAL`.
fn parse_tag_ids(raw: &str) -> ApiResult<Vec<i64>> {
    serde_json::from_str(raw).map_err(|error| {
        ApiError::internal("the cached tag ids are not a JSON array of numbers")
            .with_details(error.to_string())
    })
}

impl TodoCounts {
    /// Counts every task and how many of them are still open.
    pub fn load(db: &Db) -> ApiResult<Self> {
        repository::query_one(
            db,
            "SELECT COUNT(*), SUM(completed = 0) FROM todos",
            [],
            |row| {
                let total = row.get::<_, i64>(0)?;
                let remaining = row.get::<_, Option<i64>>(1)?.unwrap_or_default();

                Ok(Self {
                    total,
                    remaining,
                    completed: total - remaining,
                })
            },
        )
    }
}

impl TodoCompletions {
    /// Counts finished tasks; `now` decides where "today" starts.
    pub fn load(db: &Db, now: i64) -> ApiResult<Self> {
        let midnight = windows::local_midnight(now)
            .ok_or_else(|| ApiError::internal("the local day boundary could not be resolved"))?;

        repository::query_one(
            db,
            "SELECT
               COALESCE(SUM(completed = 1 AND completed_at >= ?1), 0),
               COALESCE(SUM(completed = 1), 0)
             FROM todos",
            params![midnight],
            |row| {
                Ok(Self {
                    today: row.get(0)?,
                    all: row.get(1)?,
                })
            },
        )
    }
}

/// Trims the title and rejects an empty result.
fn validate_title(title: &str) -> ApiResult<String> {
    let trimmed = title.trim();

    if trimmed.is_empty() {
        return Err(ApiError::invalid_input("title must not be empty"));
    }

    Ok(trimmed.to_owned())
}

/// Rejects a planning moment before the epoch; a stored timestamp is never earlier than that.
fn validate_instant(value: Option<i64>, field: &str) -> ApiResult<Option<i64>> {
    if let Some(seconds) = value {
        if seconds <= 0 {
            return Err(ApiError::invalid_input(format!(
                "{field} must be after the Unix epoch"
            )));
        }
    }

    Ok(value)
}

fn require_changed(changed: usize, id: i64) -> ApiResult<()> {
    if changed == 0 {
        return Err(ApiError::not_found(format!("no todo with id {id}")));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::utils::response::ApiCode;

    fn migrated() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn add_trims_the_title_and_rejects_a_blank_one() {
        let db = migrated();

        let todo = Todo::add(&db, "  write the docs  ", None, None).expect("the task is stored");
        assert_eq!(todo.title, "write the docs");
        assert!(!todo.completed);
        assert_eq!(todo.created_at, todo.updated_at);

        let error = Todo::add(&db, "   ", None, None).expect_err("a blank title is refused");
        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert_eq!(Todo::list(&db, None).expect("list").len(), 1);
    }

    #[test]
    fn list_puts_open_tasks_first_and_filters_by_completion() {
        let db = migrated();

        let first = Todo::add(&db, "first", None, None).expect("stored");
        Todo::add(&db, "second", None, None).expect("stored");
        Todo::set_completed(&db, first.id, true).expect("completed");

        let all = Todo::list(&db, None).expect("list");
        assert_eq!(
            all.iter()
                .map(|todo| todo.title.as_str())
                .collect::<Vec<_>>(),
            ["second", "first"]
        );

        let open = Todo::list(&db, Some(false)).expect("list");
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].title, "second");

        let done = Todo::list(&db, Some(true)).expect("list");
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].title, "first");
    }

    #[test]
    fn rename_and_set_completed_touch_the_stored_row() {
        let db = migrated();
        let todo = Todo::add(&db, "draft", None, None).expect("stored");

        let renamed = Todo::rename(&db, todo.id, " final ").expect("renamed");
        assert_eq!(renamed.title, "final");
        assert!(renamed.updated_at >= todo.updated_at);

        let completed = Todo::set_completed(&db, todo.id, true).expect("completed");
        assert!(completed.completed);
        assert_eq!(Todo::find(&db, todo.id).expect("found"), completed);
        assert!(
            completed_at(&db, todo.id).is_some(),
            "completing stamps the time"
        );

        let reopened = Todo::set_completed(&db, todo.id, false).expect("reopened");
        assert!(!reopened.completed);
        assert_eq!(completed_at(&db, todo.id), None, "reopening clears it");
    }

    /// Reads the column the heatmap counts tasks by, which the `Todo` shape does not carry.
    fn completed_at(db: &Db, id: i64) -> Option<i64> {
        db.connection()
            .expect("connection")
            .query_row(
                "SELECT completed_at FROM todos WHERE id = ?1",
                [id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .expect("the row exists")
    }

    #[test]
    fn unknown_ids_report_not_found() {
        let db = migrated();

        for result in [
            Todo::rename(&db, 404, "x").map(|_| ()),
            Todo::set_completed(&db, 404, true).map(|_| ()),
            Todo::set_starred(&db, 404, true).map(|_| ()),
            Todo::delete(&db, 404),
            Todo::find(&db, 404).map(|_| ()),
        ] {
            assert_eq!(result.expect_err("missing id").code(), ApiCode::NotFound);
        }
    }

    /// Titles in the order the list answers them, which is what the page draws.
    fn titles(db: &Db, completed: Option<bool>) -> Vec<String> {
        Todo::list(db, completed)
            .expect("list")
            .into_iter()
            .map(|todo| todo.title)
            .collect()
    }

    #[test]
    fn starring_stamps_the_moment_and_unstarring_clears_it() {
        let db = migrated();
        let todo = Todo::add(&db, "important", None, None).expect("stored");

        assert_eq!(todo.starred_at, None, "a new task is not starred");

        let starred = Todo::set_starred(&db, todo.id, true).expect("starred");
        let stamped = starred.starred_at.expect("starring writes a moment");
        assert!(stamped > 0, "the moment is a real epoch second");
        assert_eq!(
            Todo::find(&db, todo.id).expect("found"),
            starred,
            "the answer is the stored row"
        );

        let cleared = Todo::set_starred(&db, todo.id, false).expect("unstarred");
        assert_eq!(cleared.starred_at, None);
        assert_eq!(
            Todo::find(&db, todo.id).expect("found").starred_at,
            None,
            "unstarring is stored too"
        );
    }

    #[test]
    fn starred_tasks_sit_on_top_of_their_group_most_recent_first() {
        let db = migrated();
        let first = Todo::add(&db, "first", None, None).expect("stored");
        let second = Todo::add(&db, "second", None, None).expect("stored");
        let third = Todo::add(&db, "third", None, None).expect("stored");

        // Nothing starred: newest id first, as before the pin existed.
        assert_eq!(titles(&db, None), ["third", "second", "first"]);

        // The stamps are written by hand so the order does not depend on how fast the test runs.
        pin_at(&db, first.id, 1_800_000_100);
        pin_at(&db, third.id, 1_800_000_200);

        assert_eq!(
            titles(&db, None),
            ["third", "first", "second"],
            "starred on top, the most recently starred first"
        );

        // A finished starred task still sits under the open ones: the groups are never mixed.
        Todo::set_completed(&db, second.id, true).expect("completed");

        assert_eq!(titles(&db, None), ["third", "first", "second"]);
        assert_eq!(titles(&db, Some(false)), ["third", "first"]);
        assert_eq!(titles(&db, Some(true)), ["second"]);
    }

    /// Writes a star stamp directly, so a fixture can choose the order it wants.
    fn pin_at(db: &Db, id: i64, instant: i64) {
        repository::execute(
            db,
            "UPDATE todos SET starred_at = ?1 WHERE id = ?2",
            params![instant, id],
        )
        .expect("the pin is stored");
    }

    #[test]
    fn counts_follow_the_stored_rows() {
        let db = migrated();

        assert_eq!(
            TodoCounts::load(&db).expect("counts"),
            TodoCounts {
                total: 0,
                remaining: 0,
                completed: 0
            }
        );

        let first = Todo::add(&db, "first", None, None).expect("stored");
        Todo::add(&db, "second", None, None).expect("stored");
        Todo::set_completed(&db, first.id, true).expect("completed");

        assert_eq!(
            TodoCounts::load(&db).expect("counts"),
            TodoCounts {
                total: 2,
                remaining: 1,
                completed: 1
            }
        );

        Todo::delete(&db, first.id).expect("deleted");
        assert_eq!(
            TodoCounts::load(&db).expect("counts"),
            TodoCounts {
                total: 1,
                remaining: 1,
                completed: 0
            }
        );
    }

    /// Stores a task that was finished (or opened) at a chosen instant.
    fn stored_at(db: &Db, title: &str, instant: i64, completed: bool) {
        repository::insert(
            db,
            "INSERT INTO todos (title, completed, completed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![title, completed, completed.then_some(instant), instant],
        )
        .expect("the task is stored");
    }

    /// Local midnight of the day the test runs in.
    fn today() -> i64 {
        windows::local_midnight(time::now_seconds()).expect("today has a start")
    }

    #[test]
    fn completions_count_today_and_every_finished_task() {
        let db = migrated();
        let now = today() + 3_600;

        stored_at(&db, "last month", today() - 30 * 86_400, true);
        stored_at(&db, "this morning", now + 60, true);
        stored_at(&db, "still open", now + 120, false);

        assert_eq!(
            TodoCompletions::load(&db, now).expect("completions"),
            TodoCompletions { today: 1, all: 2 }
        );
    }

    #[test]
    fn a_finished_task_without_a_stamp_only_counts_in_the_total() {
        let db = migrated();

        repository::insert(
            &db,
            "INSERT INTO todos (title, completed, created_at, updated_at)
             VALUES ('finished before the stamp existed', 1, 100, 100)",
            [],
        )
        .expect("the legacy row is stored");

        assert_eq!(
            TodoCompletions::load(&db, today()).expect("completions"),
            TodoCompletions { today: 0, all: 1 }
        );
    }

    #[test]
    fn an_empty_table_answers_zero_counts() {
        let db = migrated();

        assert_eq!(
            TodoCompletions::load(&db, today()).expect("completions"),
            TodoCompletions { today: 0, all: 0 }
        );
    }

    #[test]
    fn set_tags_sorts_dedups_and_keeps_the_link_table_in_step() {
        let db = migrated();
        let todo = Todo::add(&db, "tagged", None, None).expect("stored");
        let work = crate::models::tag::Tag::add(&db, "work").expect("stored");
        let home = crate::models::tag::Tag::add(&db, "home").expect("stored");

        let tagged = Todo::set_tags(&db, todo.id, &[work.id, home.id, work.id]).expect("linked");
        assert_eq!(
            tagged.tag_ids,
            [work.id, home.id],
            "ids are sorted and deduplicated"
        );
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_tags", []).expect("count"),
            2
        );

        let cleared = Todo::set_tags(&db, todo.id, &[]).expect("cleared");
        assert!(cleared.tag_ids.is_empty());
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_tags", []).expect("count"),
            0
        );
    }

    #[test]
    fn set_tags_rejects_unknown_ids_and_malformed_caches_are_reported() {
        let db = migrated();
        let todo = Todo::add(&db, "tagged", None, None).expect("stored");

        let unknown_tag = Todo::set_tags(&db, todo.id, &[404]).expect_err("unknown tag");
        assert_eq!(unknown_tag.code(), ApiCode::NotFound);

        let unknown_todo = Todo::set_tags(&db, 404, &[]).expect_err("unknown task");
        assert_eq!(unknown_todo.code(), ApiCode::NotFound);

        repository::execute(
            &db,
            "UPDATE todos SET tag_ids = 'not json' WHERE id = ?1",
            [todo.id],
        )
        .expect("the cache is overwritten by hand");

        let error = Todo::find(&db, todo.id).expect_err("the cache cannot be read");
        assert_eq!(error.code(), ApiCode::Internal);
        assert!(error.details().is_some());
    }

    #[test]
    fn start_and_end_times_are_optional_and_stored() {
        let db = migrated();

        let planned =
            Todo::add(&db, "planned", Some(1_800_000_000), Some(1_800_003_600)).expect("stored");
        assert_eq!(planned.start_at, Some(1_800_000_000));
        assert_eq!(planned.end_at, Some(1_800_003_600));

        let undated = Todo::add(&db, "undated", None, None).expect("stored");
        assert_eq!(undated.start_at, None);
        assert_eq!(undated.end_at, None);

        let only_end = Todo::add(&db, "only end", None, Some(1_800_007_200)).expect("stored");
        assert_eq!(only_end.start_at, None);
        assert_eq!(only_end.end_at, Some(1_800_007_200));

        assert_eq!(Todo::list(&db, None).expect("list").len(), 3);
    }

    #[test]
    fn start_and_end_times_set_clear_and_report_a_missing_task() {
        let db = migrated();
        let todo = Todo::add(&db, "draft", None, None).expect("stored");

        let started = Todo::set_start_at(&db, todo.id, Some(1_800_000_000)).expect("started");
        assert_eq!(started.start_at, Some(1_800_000_000));
        assert_eq!(
            started.end_at, None,
            "setting one side leaves the other alone"
        );
        assert!(started.updated_at >= todo.updated_at);

        let ended = Todo::set_end_at(&db, todo.id, Some(1_800_003_600)).expect("ended");
        assert_eq!(ended.start_at, Some(1_800_000_000));
        assert_eq!(ended.end_at, Some(1_800_003_600));
        assert_eq!(
            Todo::find(&db, todo.id).expect("found").end_at,
            Some(1_800_003_600)
        );

        let cleared_start = Todo::set_start_at(&db, todo.id, None).expect("cleared");
        assert_eq!(cleared_start.start_at, None);
        assert_eq!(cleared_start.end_at, Some(1_800_003_600));

        let cleared_end = Todo::set_end_at(&db, todo.id, None).expect("cleared");
        assert_eq!(cleared_end.end_at, None);

        for result in [
            Todo::set_start_at(&db, 404, None).map(|_| ()),
            Todo::set_end_at(&db, 404, None).map(|_| ()),
        ] {
            assert_eq!(result.expect_err("missing id").code(), ApiCode::NotFound);
        }

        assert_eq!(
            Todo::set_start_at(&db, todo.id, Some(0))
                .expect_err("the epoch itself is refused")
                .code(),
            ApiCode::InvalidInput
        );
        assert_eq!(
            Todo::set_end_at(&db, todo.id, Some(-1))
                .expect_err("a negative instant is refused")
                .code(),
            ApiCode::InvalidInput
        );
    }
}
