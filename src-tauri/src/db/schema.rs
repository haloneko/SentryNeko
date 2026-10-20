//! Schema creation: one idempotent script, run at every start.
//!
//! Nothing is versioned — the app has not shipped yet, so a database is created once and a schema
//! change is a local rebuild instead of a migration.

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::ApiResult;

/// Tables owned by the schema, in creation order.
pub const TABLES: [&str; 7] = [
    "todos",
    "pomodoro_sessions",
    "app_events",
    "alarms",
    "settings",
    "tags",
    "todo_tags",
];

const SCHEMA: &str = r"
CREATE TABLE IF NOT EXISTS todos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    completed_at INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    tag_ids      TEXT    NOT NULL DEFAULT '[]',
    -- Optional planning moments, both UTC epoch seconds.
    start_at     INTEGER,
    end_at       INTEGER,
    -- When the task was pinned to the top of its group, UTC epoch seconds; NULL while it is not.
    starred_at   INTEGER,
    notes        TEXT,
    extra        TEXT    NOT NULL DEFAULT '{}'
                 CHECK (json_valid(extra) AND json_type(extra) = 'object')
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    phase           TEXT    NOT NULL CHECK (phase IN ('focus', 'short_break', 'long_break')),
    planned_seconds INTEGER NOT NULL,
    actual_seconds  INTEGER,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    todo_id         INTEGER REFERENCES todos (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name     TEXT    NOT NULL,
    window_title TEXT,
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS alarms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL DEFAULT '',
    hour        INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    minute      INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 59),
    repeat_days INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL,
    category   TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_todos_completed
    ON todos (completed, created_at);

CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_started_at
    ON pomodoro_sessions (started_at);

CREATE INDEX IF NOT EXISTS idx_app_events_started_at
    ON app_events (started_at);

CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id
    ON todo_tags (tag_id);

CREATE INDEX IF NOT EXISTS idx_settings_category
    ON settings (category, key);
";

/// Creates every missing table and index; running it again changes nothing.
pub fn ensure(db: &Db) -> ApiResult<()> {
    repository::transaction(db, |transaction| {
        transaction.execute_batch(SCHEMA)?;

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::Db;
    use crate::utils::response::{ApiCode, ApiError};

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        ensure(&db).expect("schema is created");

        db
    }

    #[test]
    fn ensure_creates_every_table_and_is_idempotent() {
        let db = Db::open_in_memory().expect("in-memory database opens");

        ensure(&db).expect("first run");
        ensure(&db).expect("second run");

        let connection = db.connection().expect("connection");
        for table in TABLES {
            let found: u32 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("sqlite_master is readable");
            assert_eq!(found, 1, "{table} is missing");
        }
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let db = created();

        let error = db
            .connection()
            .expect("connection")
            .execute(
                "INSERT INTO pomodoro_sessions (phase, planned_seconds, started_at, todo_id)
                 VALUES ('focus', 1500, 1, 987654)",
                [],
            )
            .expect_err("an unknown todo_id is rejected");

        assert_eq!(ApiError::from(error).code(), ApiCode::Database);
    }

}
