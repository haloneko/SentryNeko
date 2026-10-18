//! Persisted presentation of one-time and recurring tasks.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;

const SETTINGS_KEY: &str = "todo.displayMode";

/// Layout of the task list; existing installations start with separate sections.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TodoDisplayMode {
    #[default]
    Separated,
    Merged,
    TwoColumns,
}

impl TodoDisplayMode {
    /// Reads the preference without changing any task data.
    pub fn load(db: &Db) -> ApiResult<Self> {
        let stored = repository::query_optional(
            db,
            "SELECT value FROM settings WHERE key = ?1",
            [SETTINGS_KEY],
            |row| Ok(row.get::<_, String>(0)?),
        )?;

        match stored {
            Some(raw) => Ok(serde_json::from_str(&raw)?),
            None => Ok(Self::default()),
        }
    }

    /// Validates the command argument before saving the preference.
    pub fn save(db: &Db, code: &str) -> ApiResult<Self> {
        let mode = match code {
            "separated" => Self::Separated,
            "merged" => Self::Merged,
            "twoColumns" => Self::TwoColumns,
            _ => {
                return Err(ApiError::invalid_input(format!(
                    "unknown task display mode: {code}"
                )));
            }
        };

        repository::execute(
            db,
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![SETTINGS_KEY, serde_json::to_string(&mode)?, time::now_seconds()],
        )?;

        Ok(mode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::models::todo::Todo;
    use crate::utils::response::ApiCode;

    #[test]
    fn display_modes_survive_reopening_without_changing_tasks() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("todos.db");

        for code in ["separated", "merged", "twoColumns"] {
            let expected;
            let tasks;
            {
                let db = Db::open(&path).expect("database opens");
                schema::ensure(&db).expect("schema");
                Todo::add(&db, code).expect("task stored");
                tasks = Todo::list(&db, None).expect("tasks");
                expected = TodoDisplayMode::save(&db, code).expect("mode saved");
            }

            let db = Db::open(&path).expect("database reopens");
            assert_eq!(TodoDisplayMode::load(&db).expect("mode loaded"), expected);
            assert_eq!(Todo::list(&db, None).expect("tasks"), tasks);
        }
    }

    #[test]
    fn separated_is_the_default_and_invalid_writes_preserve_the_preference() {
        let db = Db::open_in_memory().expect("database opens");
        schema::ensure(&db).expect("schema");
        assert_eq!(
            TodoDisplayMode::load(&db).expect("default"),
            TodoDisplayMode::Separated
        );
        TodoDisplayMode::save(&db, "merged").expect("mode saved");

        let error = TodoDisplayMode::save(&db, "unknown").expect_err("invalid mode");
        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert_eq!(
            TodoDisplayMode::load(&db).expect("mode"),
            TodoDisplayMode::Merged
        );
    }
}
