//! Todo task model.

use rusqlite::{params, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::models::recurrence::Recurrence;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::{time, windows};

/// Columns every query selects, in the order [`Todo::from_row`] reads them.
pub(crate) const COLUMNS: &str = "todos.id, todos.title, todos.completed, todos.created_at, todos.updated_at,
                      todos.tag_ids, recurrence.unit, recurrence.interval, recurrence.next_at, todos.due_date";
pub(crate) const SOURCE: &str =
    "todos LEFT JOIN todo_recurrences AS recurrence ON recurrence.todo_id = todos.id";

/// Date-only values are UTC midnights from 1970-01-01 through 9999-12-31.
const LAST_DUE_DATE: i64 = 253_402_214_400;

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
    /// Absent for a one-time task.
    pub recurrence: Option<Recurrence>,
    /// UTC epoch seconds of the next cycle boundary, absent for a one-time task.
    pub next_occurrence_at: Option<i64>,
    pub due_date: Option<i64>,
}

/// Task ordering; undated tasks always follow dated tasks in either date direction.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TodoSort {
    #[default]
    Default,
    DueDateAsc,
    DueDateDesc,
}

/// Totals shown beside the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCounts {
    pub total: i64,
    pub remaining: i64,
    pub completed: i64,
}

/// Tasks whose completion rate is measured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletionScope {
    /// Every stored task, however old.
    All,
    /// Tasks created since local midnight.
    Today,
}

/// Numerator and denominator of the completion rate; the caller renders the percentage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletion {
    pub total: i64,
    pub completed: i64,
}

impl Todo {
    /// Maps one `todos` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        let recurrence = row
            .get::<_, Option<String>>(6)?
            .map(|unit| Recurrence::from_storage(&unit, row.get(7)?))
            .transpose()?;
        Ok(Self {
            id: row.get(0)?,
            title: row.get(1)?,
            completed: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            tag_ids: parse_tag_ids(&row.get::<_, String>(5)?)?,
            recurrence,
            next_occurrence_at: row.get(8)?,
            due_date: row.get(9)?,
        })
    }

    /// Lists tasks, open ones first and newest first; `completed` narrows the result.
    pub fn list(db: &Db, completed: Option<bool>) -> ApiResult<Vec<Self>> {
        Self::list_sorted(db, completed, TodoSort::Default)
    }

    pub fn list_sorted(db: &Db, completed: Option<bool>, sort: TodoSort) -> ApiResult<Vec<Self>> {
        let condition = match completed {
            None => "",
            Some(false) => " WHERE completed = 0",
            Some(true) => " WHERE completed = 1",
        };
        let order = match sort {
            TodoSort::Default => "completed, todos.id DESC",
            TodoSort::DueDateAsc => "due_date IS NULL, due_date ASC, todos.id DESC",
            TodoSort::DueDateDesc => "due_date IS NULL, due_date DESC, todos.id DESC",
        };
        let sql = format!("SELECT {COLUMNS} FROM {SOURCE}{condition} ORDER BY {order}");

        repository::query_all(db, &sql, [], Self::from_row)
    }

    /// Returns one task; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM {SOURCE} WHERE todos.id = ?1"),
            [id],
            Self::from_row,
        )
    }

    /// Inserts a task and answers with the stored row; a blank title is `INVALID_INPUT`.
    pub fn add(db: &Db, title: &str) -> ApiResult<Self> {
        Self::add_with_recurrence(db, title, None)
    }

    /// Creates a task and its optional repeat schedule atomically. The first cycle starts now.
    pub fn add_with_recurrence(
        db: &Db,
        title: &str,
        recurrence: Option<Recurrence>,
    ) -> ApiResult<Self> {
        Self::add_with_options(db, title, recurrence, None)
    }

    pub fn add_with_due_date(db: &Db, title: &str, due_date: Option<i64>) -> ApiResult<Self> {
        Self::add_with_options(db, title, None, due_date)
    }

    /// Creates a task with both optional scheduling fields in one transaction.
    pub fn add_with_options(
        db: &Db,
        title: &str,
        recurrence: Option<Recurrence>,
        due_date: Option<i64>,
    ) -> ApiResult<Self> {
        Self::add_with_options_at(db, title, recurrence, due_date, time::now_seconds())
    }

    #[cfg(test)]
    fn add_at(db: &Db, title: &str, recurrence: Option<Recurrence>, now: i64) -> ApiResult<Self> {
        Self::add_with_options_at(db, title, recurrence, None, now)
    }

    fn add_with_options_at(
        db: &Db,
        title: &str,
        recurrence: Option<Recurrence>,
        due_date: Option<i64>,
        now: i64,
    ) -> ApiResult<Self> {
        validate_due_date(due_date)?;
        let title = validate_title(title)?;
        let next = recurrence
            .map(|rule| rule.cycle_at(now, now).map(|cycle| cycle.1))
            .transpose()?;
        let id = repository::transaction(db, |transaction| {
            transaction.execute(
                "INSERT INTO todos (title, completed, created_at, updated_at, due_date) VALUES (?1, 0, ?2, ?2, ?3)",
                params![title, now, due_date],
            )?;
            let id = transaction.last_insert_rowid();
            if let (Some(rule), Some(next)) = (recurrence, next) {
                transaction.execute(
                    "INSERT INTO todo_recurrences (todo_id, unit, interval, current_at, next_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, rule.unit.as_str(), rule.interval, now, next],
                )?;
            }
            Ok(id)
        })?;

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

    /// Saves the title and optional due date together; `None` explicitly clears the date.
    pub fn update(db: &Db, id: i64, title: &str, due_date: Option<i64>) -> ApiResult<Self> {
        let title = validate_title(title)?;
        validate_due_date(due_date)?;
        let changed = repository::execute(
            db,
            "UPDATE todos SET title = ?1, due_date = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, due_date, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Sets or clears a deadline without changing the task's title or completion state.
    pub fn set_due_date(db: &Db, id: i64, due_date: Option<i64>) -> ApiResult<Self> {
        validate_due_date(due_date)?;
        let changed = repository::execute(
            db,
            "UPDATE todos SET due_date = ?1, updated_at = ?2 WHERE id = ?3",
            params![due_date, time::now_seconds(), id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Sets the completion flag, stamping `completed_at` when the task is done and clearing it
    /// when it is reopened; a missing id is `NOT_FOUND`.
    pub fn set_completed(db: &Db, id: i64, completed: bool) -> ApiResult<Self> {
        Self::set_completed_at(db, id, completed, time::now_seconds())
    }

    fn set_completed_at(db: &Db, id: i64, completed: bool, now: i64) -> ApiResult<Self> {
        repository::immediate_transaction(db, |transaction| {
            // A click at a cycle boundary always belongs to the new cycle, even before the next
            // scheduler tick. Rotation and completion must commit together.
            advance_recurring_in(transaction, now)?;
            let changed = transaction.execute(
                "UPDATE todos
                 SET completed = ?1,
                     completed_at = CASE WHEN ?1 THEN COALESCE(completed_at, ?2) ELSE NULL END,
                     updated_at = ?2
                 WHERE id = ?3",
                params![completed, now, id],
            )?;
            require_changed(changed, id)
        })?;

        Self::find(db, id)
    }

    /// Resets due recurring tasks and archives completed cycles in the same transaction.
    /// Missing cycles are skipped, leaving one current task in the list.
    pub fn advance_recurring(db: &Db, now: i64) -> ApiResult<usize> {
        if !repository::exists(
            db,
            "SELECT 1 FROM todo_recurrences WHERE next_at <= ?1",
            [now],
        )? {
            return Ok(0);
        }
        repository::immediate_transaction(db, |transaction| advance_recurring_in(transaction, now))
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
                "SELECT {COLUMNS} FROM {SOURCE}
                   INNER JOIN todo_tags ON todo_tags.todo_id = todos.id
                  WHERE todo_tags.tag_id = ?1
                  ORDER BY completed, todos.id DESC"
            ),
            [tag_id],
            Self::from_row,
        )
    }
}

pub(crate) fn advance_recurring_in(transaction: &Transaction<'_>, now: i64) -> ApiResult<usize> {
    let due = {
        let mut statement = transaction.prepare(
            "SELECT todos.id, todos.created_at, recurrence.unit, recurrence.interval
             FROM todo_recurrences AS recurrence INNER JOIN todos ON todos.id = recurrence.todo_id
             WHERE recurrence.next_at <= ?1",
        )?;
        let rows = statement.query_and_then([now], |row| -> ApiResult<_> {
            let unit: String = row.get(2)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                Recurrence::from_storage(&unit, row.get(3)?)?,
            ))
        })?;
        rows.collect::<ApiResult<Vec<_>>>()?
    };

    for (id, anchor, recurrence) in &due {
        let (start, next) = recurrence.cycle_at(*anchor, now)?;
        transaction.execute(
            "INSERT INTO todo_completions (todo_id, occurrence_at, completed_at)
             SELECT todos.id, recurrence.current_at, todos.completed_at FROM todos
             INNER JOIN todo_recurrences AS recurrence ON recurrence.todo_id = todos.id
             WHERE todos.id = ?1 AND todos.completed = 1 AND todos.completed_at IS NOT NULL",
            [id],
        )?;
        transaction.execute(
            "UPDATE todos SET completed = 0, completed_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        transaction.execute(
            "UPDATE todo_recurrences SET current_at = ?1, next_at = ?2 WHERE todo_id = ?3",
            params![start, next, id],
        )?;
    }

    Ok(due.len())
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

impl TaskCompletion {
    /// Counts the tasks of `scope`; `now` decides where "today" starts.
    pub fn load(db: &Db, scope: CompletionScope, now: i64) -> ApiResult<Self> {
        let from = match scope {
            CompletionScope::All => None,
            CompletionScope::Today => Some(windows::local_midnight(now).ok_or_else(|| {
                ApiError::internal("the local day boundary could not be resolved")
            })?),
        };

        repository::query_one(
            db,
            "SELECT COUNT(*), SUM(completed = 1) FROM todos
             LEFT JOIN todo_recurrences AS recurrence ON recurrence.todo_id = todos.id
             WHERE ?1 IS NULL OR COALESCE(recurrence.current_at, todos.created_at) >= ?1",
            params![from],
            |row| {
                Ok(Self {
                    total: row.get(0)?,
                    completed: row.get::<_, Option<i64>>(1)?.unwrap_or_default(),
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

fn validate_due_date(due_date: Option<i64>) -> ApiResult<()> {
    if let Some(value) = due_date {
        if !(0..=LAST_DUE_DATE).contains(&value) || value % 86_400 != 0 {
            return Err(ApiError::invalid_input(
                "due date must be a UTC midnight between 1970-01-01 and 9999-12-31",
            ));
        }
    }

    Ok(())
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

        let todo =
            Todo::add_with_due_date(&db, "  write the docs  ", None).expect("the task is stored");
        assert_eq!(todo.title, "write the docs");
        assert!(!todo.completed);
        assert_eq!(todo.recurrence, None);
        assert_eq!(todo.next_occurrence_at, None);
        assert_eq!(todo.created_at, todo.updated_at);
        assert_eq!(todo.due_date, None);

        let error =
            Todo::add_with_due_date(&db, "   ", None).expect_err("a blank title is refused");
        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert_eq!(Todo::list(&db, None).expect("list").len(), 1);
    }

    #[test]
    fn list_puts_open_tasks_first_and_filters_by_completion() {
        let db = migrated();

        let first = Todo::add_with_due_date(&db, "first", None).expect("stored");
        Todo::add_with_due_date(&db, "second", None).expect("stored");
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
        let todo = Todo::add_with_due_date(&db, "draft", None).expect("stored");

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
    fn due_dates_can_be_created_edited_and_cleared_without_changing_other_fields() {
        let db = migrated();
        let due_date = 1_709_164_800; // 2024-02-29, UTC midnight.
        let todo = Todo::add_with_due_date(&db, "dated", Some(due_date)).expect("stored");
        let tag = crate::models::tag::Tag::add(&db, "work").expect("tag");
        Todo::set_tags(&db, todo.id, &[tag.id]).expect("tagged");
        Todo::set_completed(&db, todo.id, true).expect("completed");

        let renamed = Todo::rename(&db, todo.id, "renamed").expect("renamed");
        assert_eq!(renamed.due_date, Some(due_date));

        let changed =
            Todo::update(&db, todo.id, " new title ", Some(due_date + 86_400)).expect("updated");
        assert_eq!(changed.title, "new title");
        assert_eq!(changed.due_date, Some(due_date + 86_400));
        assert_eq!(changed.created_at, todo.created_at);
        assert!(changed.completed);
        assert_eq!(changed.tag_ids, [tag.id]);
        assert_eq!(
            Todo::list(&db, Some(true)).expect("list").as_slice(),
            std::slice::from_ref(&changed)
        );
        assert_eq!(Todo::list_by_tag(&db, tag.id).expect("tag list"), [changed]);

        let cleared = Todo::update(&db, todo.id, "new title", None).expect("cleared");
        assert_eq!(cleared.due_date, None);
        assert_eq!(Todo::find(&db, todo.id).expect("found"), cleared);
    }

    #[test]
    fn invalid_due_dates_and_titles_leave_the_stored_task_unchanged() {
        let db = migrated();
        let todo = Todo::add_with_due_date(&db, "original", Some(0)).expect("stored");

        for invalid in [-86_400, 1, LAST_DUE_DATE + 86_400, i64::MAX] {
            let add =
                Todo::add_with_due_date(&db, "invalid", Some(invalid)).expect_err("invalid date");
            assert_eq!(add.code(), ApiCode::InvalidInput);
            let update =
                Todo::update(&db, todo.id, "changed", Some(invalid)).expect_err("invalid date");
            assert_eq!(update.code(), ApiCode::InvalidInput);
            assert_eq!(Todo::find(&db, todo.id).expect("found"), todo);
        }

        let blank = Todo::update(&db, todo.id, "  ", None).expect_err("blank title");
        assert_eq!(blank.code(), ApiCode::InvalidInput);
        assert_eq!(Todo::list(&db, None).expect("list"), [todo]);
        let last = Todo::add_with_due_date(&db, "last supported date", Some(LAST_DUE_DATE))
            .expect("stored");
        assert_eq!(last.due_date, Some(LAST_DUE_DATE));
    }

    #[test]
    fn due_dates_survive_reopening_the_database() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("todos.db");
        let due_date = 1_709_164_800;
        let todo = {
            let db = Db::open(&path).expect("database opens");
            schema::ensure(&db).expect("schema");
            Todo::add_with_due_date(&db, "persisted", Some(due_date)).expect("stored")
        };

        let db = Db::open(&path).expect("database reopens");
        schema::ensure(&db).expect("schema remains idempotent");
        assert_eq!(Todo::find(&db, todo.id).expect("found"), todo);
    }

    #[test]
    fn unknown_ids_report_not_found() {
        let db = migrated();

        for result in [
            Todo::rename(&db, 404, "x").map(|_| ()),
            Todo::update(&db, 404, "x", None).map(|_| ()),
            Todo::set_completed(&db, 404, true).map(|_| ()),
            Todo::delete(&db, 404),
            Todo::find(&db, 404).map(|_| ()),
        ] {
            assert_eq!(result.expect_err("missing id").code(), ApiCode::NotFound);
        }
    }

    #[test]
    fn date_sorting_is_global_stable_and_keeps_undated_tasks_last_in_both_directions() {
        let db = migrated();
        let undated = Todo::add_with_due_date(&db, "undated", None).expect("stored");
        let early = Todo::add_with_due_date(&db, "early", Some(0)).expect("stored");
        let late = Todo::add_with_due_date(&db, "late", Some(86_400)).expect("stored");
        let tied = Todo::add_with_due_date(&db, "tied", Some(0)).expect("stored");
        let another_undated = Todo::add_with_due_date(&db, "also undated", None).expect("stored");
        Todo::set_completed(&db, early.id, true).expect("completed");

        let ids = |completed, sort| {
            Todo::list_sorted(&db, completed, sort)
                .expect("list")
                .iter()
                .map(|todo| todo.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(None, TodoSort::DueDateAsc),
            [tied.id, early.id, late.id, another_undated.id, undated.id]
        );
        assert_eq!(
            ids(None, TodoSort::DueDateDesc),
            [late.id, tied.id, early.id, another_undated.id, undated.id]
        );
        assert_eq!(
            ids(Some(false), TodoSort::DueDateAsc),
            [tied.id, late.id, another_undated.id, undated.id]
        );
        assert_eq!(ids(Some(true), TodoSort::DueDateDesc), [early.id]);
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

        let first = Todo::add_with_due_date(&db, "first", None).expect("stored");
        Todo::add_with_due_date(&db, "second", None).expect("stored");
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

    /// Stores a task at a chosen instant, so a rate can be measured over a window.
    fn stored_at(db: &Db, title: &str, created_at: i64, completed: bool) {
        repository::insert(
            db,
            "INSERT INTO todos (title, completed, completed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![
                title,
                completed,
                completed.then_some(created_at),
                created_at
            ],
        )
        .expect("the task is stored");
    }

    /// Local midnight of the day the test runs in.
    fn today() -> i64 {
        windows::local_midnight(time::now_seconds()).expect("today has a start")
    }

    #[test]
    fn the_all_scope_counts_every_task() {
        let db = migrated();
        let now = today();

        stored_at(&db, "old", now - 30 * 86_400, true);
        stored_at(&db, "new", now + 60, false);

        assert_eq!(
            TaskCompletion::load(&db, CompletionScope::All, now).expect("rate"),
            TaskCompletion {
                total: 2,
                completed: 1
            }
        );
    }

    #[test]
    fn the_today_scope_starts_at_local_midnight() {
        let db = migrated();
        let now = today() + 3_600;

        stored_at(&db, "yesterday", today() - 60, true);
        stored_at(&db, "done", now + 60, true);
        stored_at(&db, "open", now + 120, false);

        assert_eq!(
            TaskCompletion::load(&db, CompletionScope::Today, now).expect("rate"),
            TaskCompletion {
                total: 2,
                completed: 1
            }
        );
    }

    #[test]
    fn an_empty_table_answers_zero_over_zero() {
        let db = migrated();

        assert_eq!(
            TaskCompletion::load(&db, CompletionScope::All, today()).expect("rate"),
            TaskCompletion {
                total: 0,
                completed: 0
            }
        );
    }

    #[test]
    fn set_tags_sorts_dedups_and_keeps_the_link_table_in_step() {
        let db = migrated();
        let todo = Todo::add_with_due_date(&db, "tagged", None).expect("stored");
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
        let todo = Todo::add_with_due_date(&db, "tagged", None).expect("stored");

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

    fn local(year: u16, month: u16, day: u16) -> i64 {
        windows::calendar_midnight(year, month, day).expect("local date")
    }

    fn daily() -> Recurrence {
        Recurrence {
            unit: crate::models::recurrence::RecurrenceUnit::Day,
            interval: 1,
        }
    }

    #[test]
    fn invalid_schedules_do_not_leave_a_partial_task() {
        let db = migrated();
        for interval in [0, 366] {
            let error = Todo::add_with_recurrence(
                &db,
                "invalid",
                Some(Recurrence {
                    interval,
                    ..daily()
                }),
            )
            .expect_err("invalid interval");
            assert_eq!(error.code(), ApiCode::InvalidInput);
        }
        assert!(Todo::list(&db, None).expect("list").is_empty());
    }

    #[test]
    fn custom_day_week_and_month_schedules_roundtrip_and_advance() {
        use crate::models::recurrence::RecurrenceUnit;
        let start = local(2026, 1, 31) + 3_600;
        for (unit, interval, first, second) in [
            (RecurrenceUnit::Day, 3, local(2026, 2, 3), local(2026, 2, 6)),
            (
                RecurrenceUnit::Week,
                2,
                local(2026, 2, 14),
                local(2026, 2, 28),
            ),
            (
                RecurrenceUnit::Month,
                2,
                local(2026, 3, 31),
                local(2026, 5, 31),
            ),
        ] {
            let db = migrated();
            let recurrence = Recurrence { unit, interval };
            let todo = Todo::add_at(&db, "custom", Some(recurrence), start).expect("stored");
            assert_eq!(todo.recurrence, Some(recurrence));
            assert_eq!(todo.next_occurrence_at, Some(first));
            Todo::set_completed_at(&db, todo.id, true, start + 60).expect("done");
            assert_eq!(Todo::advance_recurring(&db, first).expect("due"), 1);
            let reset = Todo::find(&db, todo.id).expect("found");
            assert!(!reset.completed);
            assert_eq!(reset.recurrence, Some(recurrence));
            assert_eq!(reset.next_occurrence_at, Some(second));
        }
    }

    #[test]
    fn completed_cycles_reset_exactly_once_and_keep_heatmap_history() {
        let db = migrated();
        let start = local(2026, 10, 18) + 3_600;
        let next = local(2026, 10, 19);
        let one_time = Todo::add_at(&db, "ship once", None, start).expect("stored");
        let repeating = Todo::add_at(&db, "daily review", Some(daily()), start).expect("stored");
        let tag = crate::models::tag::Tag::add(&db, "work").expect("tag");
        Todo::set_tags(&db, repeating.id, &[tag.id]).expect("tagged");
        Todo::set_completed_at(&db, one_time.id, true, start + 60).expect("done");
        Todo::set_completed_at(&db, repeating.id, true, start + 60).expect("done");

        assert_eq!(Todo::advance_recurring(&db, next - 1).expect("not due"), 0);
        assert!(Todo::find(&db, repeating.id).expect("found").completed);
        assert_eq!(Todo::advance_recurring(&db, next).expect("due"), 1);
        assert_eq!(Todo::advance_recurring(&db, next).expect("same tick"), 0);

        let reset = Todo::find(&db, repeating.id).expect("found");
        assert!(!reset.completed);
        assert_eq!(reset.next_occurrence_at, Some(local(2026, 10, 20)));
        assert_eq!(reset.tag_ids, [tag.id]);
        assert_eq!(reset.title, "daily review");
        assert_eq!(completed_at(&db, reset.id), None);
        assert!(Todo::find(&db, one_time.id).expect("found").completed);
        assert_eq!(
            TodoCounts::load(&db).expect("counts"),
            TodoCounts {
                total: 2,
                remaining: 1,
                completed: 1
            }
        );
        assert_eq!(Todo::list_by_tag(&db, tag.id).expect("tag lookup"), [reset]);

        let buckets = crate::models::heatmap::load(
            &db,
            local(2026, 10, 18),
            local(2026, 10, 20),
            crate::models::heatmap::Granularity::Day,
        )
        .expect("heatmap");
        assert_eq!(
            buckets
                .iter()
                .map(|bucket| bucket.completed_tasks)
                .collect::<Vec<_>>(),
            [2, 0]
        );
        assert_eq!(
            TaskCompletion::load(&db, CompletionScope::Today, next + 60).expect("rate"),
            TaskCompletion {
                total: 1,
                completed: 0
            }
        );
    }

    #[test]
    fn a_completion_at_the_boundary_belongs_to_the_new_cycle() {
        let db = migrated();
        let start = local(2026, 10, 18) + 3_600;
        let next = local(2026, 10, 19);
        let todo = Todo::add_at(&db, "review", Some(daily()), start).expect("stored");
        Todo::set_completed_at(&db, todo.id, true, start + 60).expect("first completion");
        Todo::set_completed_at(&db, todo.id, true, next).expect("next completion");
        Todo::set_completed_at(&db, todo.id, true, next + 60).expect("idempotent completion");
        assert_eq!(completed_at(&db, todo.id), Some(next));
        assert_eq!(
            Todo::advance_recurring(&db, local(2026, 10, 20)).expect("next day"),
            1
        );
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_completions", []).expect("history"),
            2
        );

        Todo::delete(&db, todo.id).expect("delete series");
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_recurrences", []).expect("schedules"),
            0
        );
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_completions", []).expect("history"),
            0
        );
    }

    #[test]
    fn undone_and_missed_cycles_do_not_create_completions_or_duplicate_tasks() {
        let db = migrated();
        let start = local(2026, 1, 1) + 3_600;
        let todo = Todo::add_at(&db, "review", Some(daily()), start).expect("stored");
        Todo::set_completed_at(&db, todo.id, true, start + 60).expect("done");
        Todo::set_completed_at(&db, todo.id, false, start + 120).expect("undo");

        let now = local(2026, 10, 18) + 3_600;
        assert_eq!(Todo::advance_recurring(&db, now).expect("catch up"), 1);
        assert_eq!(Todo::list(&db, None).expect("list").len(), 1);
        let reset = Todo::find(&db, todo.id).expect("found");
        assert!(!reset.completed);
        assert_eq!(reset.next_occurrence_at, Some(local(2026, 10, 19)));
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_completions", []).expect("history"),
            0
        );
    }

    #[test]
    fn schedules_and_completion_history_survive_reopening_the_database() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("tasks.db");
        let start = local(2026, 10, 18) + 3_600;
        let id = {
            let db = Db::open(&path).expect("file database");
            schema::ensure(&db).expect("schema");
            let todo = Todo::add_at(&db, "review", Some(daily()), start).expect("stored");
            Todo::set_completed_at(&db, todo.id, true, start + 60).expect("done");
            todo.id
        };
        let db = Db::open(&path).expect("reopened");
        schema::ensure(&db).expect("idempotent schema");
        assert_eq!(
            Todo::advance_recurring(&db, local(2026, 10, 25)).expect("catch up"),
            1
        );
        let todo = Todo::find(&db, id).expect("same task");
        assert_eq!(todo.recurrence, Some(daily()));
        assert_eq!(todo.next_occurrence_at, Some(local(2026, 10, 26)));
        assert!(!todo.completed);
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_completions", []).expect("history"),
            1
        );
    }

    #[test]
    fn a_scheduler_tick_and_completion_can_write_the_same_boundary_concurrently() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let db = Db::open(directory.path().join("tasks.db")).expect("file database");
        schema::ensure(&db).expect("schema");
        let start = local(2026, 10, 18) + 3_600;
        let next = local(2026, 10, 19);
        let todo = Todo::add_at(&db, "review", Some(daily()), start).expect("stored");
        Todo::set_completed_at(&db, todo.id, true, start + 60).expect("previous cycle done");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let jobs: Vec<_> = (0..2)
            .map(|job| {
                let db = db.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    if job == 0 {
                        Todo::advance_recurring(&db, next).map(|_| ())
                    } else {
                        Todo::set_completed_at(&db, todo.id, true, next + 1).map(|_| ())
                    }
                })
            })
            .collect();
        for job in jobs {
            job.join().expect("worker").expect("both writes succeed");
        }
        assert!(Todo::find(&db, todo.id).expect("task").completed);
        assert_eq!(completed_at(&db, todo.id), Some(next + 1));
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_completions", []).expect("history"),
            1
        );
    }
}
