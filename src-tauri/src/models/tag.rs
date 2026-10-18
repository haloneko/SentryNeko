//! Tag model: the name index, the task links and the reverse lookup.

use rusqlite::{params, Row};
use serde::Serialize;

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiCode, ApiError, ApiResult};
use crate::utils::time;

/// Columns every query selects, in the order [`Tag::from_row`] reads them.
const COLUMNS: &str = "id, name, created_at";

/// A label tasks can carry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

impl Tag {
    /// Maps one `tags` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        })
    }

    /// Lists every tag, alphabetical and case-insensitive.
    pub fn list(db: &Db) -> ApiResult<Vec<Self>> {
        repository::query_all(
            db,
            &format!("SELECT {COLUMNS} FROM tags ORDER BY name COLLATE NOCASE"),
            [],
            Self::from_row,
        )
    }

    /// Returns one tag; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM tags WHERE id = ?1"),
            [id],
            Self::from_row,
        )
    }

    /// Inserts a tag; a blank name is `INVALID_INPUT`, a taken one is `CONFLICT`.
    pub fn add(db: &Db, name: &str) -> ApiResult<Self> {
        let name = validate_name(name)?;
        require_free_name(db, &name, None)?;

        let id = repository::insert(
            db,
            "INSERT INTO tags (name, created_at) VALUES (?1, ?2)",
            params![name, time::now_seconds()],
        )?;

        Self::find(db, id)
    }

    /// Renames a tag; a missing id is `NOT_FOUND`, a taken name is `CONFLICT`.
    pub fn rename(db: &Db, id: i64, name: &str) -> ApiResult<Self> {
        let name = validate_name(name)?;
        require_free_name(db, &name, Some(id))?;

        let changed = repository::execute(
            db,
            "UPDATE tags SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;

        if changed == 0 {
            return Err(ApiError::not_found(format!("no tag with id {id}")));
        }

        Self::find(db, id)
    }

    /// Deletes a tag and forgot its id in the tasks that carried it; the links go with it.
    pub fn delete(db: &Db, id: i64) -> ApiResult<()> {
        repository::transaction(db, |transaction| {
            let removed = transaction.execute("DELETE FROM tags WHERE id = ?1", [id])?;

            if removed == 0 {
                return Err(ApiError::not_found(format!("no tag with id {id}")));
            }

            // The cached id list on `todos` has to follow, or a stale id would outlive the tag.
            transaction.execute(
                "UPDATE todos
                    SET tag_ids = (
                            SELECT COALESCE(json_group_array(value), '[]')
                            FROM json_each(todos.tag_ids)
                            WHERE value <> ?1
                        ),
                        updated_at = ?2
                  WHERE json_valid(tag_ids)
                    AND EXISTS (SELECT 1 FROM json_each(todos.tag_ids) WHERE value = ?1)",
                params![id, time::now_seconds()],
            )?;

            Ok(())
        })
    }

    /// Tags of one task, read through the link table.
    pub fn for_todo(db: &Db, todo_id: i64) -> ApiResult<Vec<Self>> {
        repository::query_all(
            db,
            "SELECT tags.id, tags.name, tags.created_at
               FROM tags
               INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
              WHERE todo_tags.todo_id = ?1
              ORDER BY tags.name COLLATE NOCASE",
            [todo_id],
            Self::from_row,
        )
    }
}

/// Trims the name and rejects an empty result.
fn validate_name(name: &str) -> ApiResult<String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(ApiError::invalid_input("tag name must not be empty"));
    }

    Ok(trimmed.to_owned())
}

/// Rejects a name another tag already uses; `ignore` is the row being renamed.
fn require_free_name(db: &Db, name: &str, ignore: Option<i64>) -> ApiResult<()> {
    let taken = repository::exists(
        db,
        "SELECT 1 FROM tags WHERE name = ?1 AND id <> ?2",
        params![name, ignore.unwrap_or_default()],
    )?;

    if taken {
        return Err(ApiError::new(ApiCode::Conflict)
            .with_message(format!("the tag name {name} is already in use")));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::models::todo::Todo;

    fn migrated() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn add_trims_the_name_and_rejects_blank_or_taken_ones() {
        let db = migrated();

        let tag = Tag::add(&db, "  work  ").expect("the tag is stored");
        assert_eq!(tag.name, "work");
        assert!(tag.created_at > 0);

        let blank = Tag::add(&db, "   ").expect_err("a blank name is refused");
        assert_eq!(blank.code(), ApiCode::InvalidInput);

        let taken = Tag::add(&db, "WORK").expect_err("names are case-insensitive");
        assert_eq!(taken.code(), ApiCode::Conflict);
        assert_eq!(Tag::list(&db).expect("list").len(), 1);
    }

    #[test]
    fn rename_and_delete_touch_the_stored_rows() {
        let db = migrated();
        let tag = Tag::add(&db, "home").expect("stored");
        let other = Tag::add(&db, "work").expect("stored");

        let renamed = Tag::rename(&db, tag.id, " personal ").expect("renamed");
        assert_eq!(renamed.name, "personal");

        let taken = Tag::rename(&db, other.id, "personal").expect_err("the name is in use");
        assert_eq!(taken.code(), ApiCode::Conflict);

        Tag::delete(&db, renamed.id).expect("deleted");
        assert_eq!(Tag::list(&db).expect("list"), [other]);

        let missing = Tag::delete(&db, 404).expect_err("unknown id");
        assert_eq!(missing.code(), ApiCode::NotFound);
    }

    #[test]
    fn tasks_and_tags_are_readable_from_both_sides() {
        let db = migrated();
        let work = Tag::add(&db, "work").expect("stored");
        let home = Tag::add(&db, "home").expect("stored");
        let todo = Todo::add_with_due_date(&db, "write the report", None).expect("stored");

        Todo::set_tags(&db, todo.id, &[home.id, work.id, work.id]).expect("tags are linked");

        assert_eq!(
            Tag::for_todo(&db, todo.id).expect("tags of the task"),
            [home.clone(), work.clone()]
        );
        assert_eq!(
            Todo::list_by_tag(&db, work.id).expect("tasks of the tag"),
            [Todo::find(&db, todo.id).expect("found")]
        );
    }

    #[test]
    fn deleting_a_tag_clears_its_id_from_every_task() {
        let db = migrated();
        let work = Tag::add(&db, "work").expect("stored");
        let home = Tag::add(&db, "home").expect("stored");
        let todo = Todo::add_with_due_date(&db, "plan the week", None).expect("stored");

        Todo::set_tags(&db, todo.id, &[work.id, home.id]).expect("tags are linked");
        Tag::delete(&db, work.id).expect("deleted");

        assert_eq!(Todo::find(&db, todo.id).expect("found").tag_ids, [home.id]);
        assert!(Tag::for_todo(&db, todo.id)
            .expect("tags of the task")
            .iter()
            .all(|tag| tag.id != work.id));
    }
}
