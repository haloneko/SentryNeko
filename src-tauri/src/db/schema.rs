//! Schema creation: one idempotent script, run at every start.
//!
//! Missing tables/indexes are created and the optional todo due-date column is added in place.

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::ApiResult;

/// Tables owned by the schema, in creation order.
pub const TABLES: [&str; 9] = [
    "todos",
    "pomodoro_sessions",
    "app_events",
    "alarms",
    "settings",
    "tags",
    "todo_tags",
    "todo_recurrences",
    "todo_completions",
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
    due_date     INTEGER
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
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
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

CREATE TABLE IF NOT EXISTS todo_recurrences (
    todo_id    INTEGER PRIMARY KEY REFERENCES todos (id) ON DELETE CASCADE,
    unit       TEXT    NOT NULL CHECK (unit IN ('day', 'week', 'month')),
    interval   INTEGER NOT NULL CHECK (interval BETWEEN 1 AND 365),
    current_at INTEGER NOT NULL,
    next_at    INTEGER NOT NULL CHECK (next_at > current_at)
);

CREATE INDEX IF NOT EXISTS idx_todo_recurrences_next_at ON todo_recurrences (next_at);

CREATE TABLE IF NOT EXISTS todo_completions (
    todo_id       INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
    occurrence_at INTEGER NOT NULL,
    completed_at  INTEGER NOT NULL,
    PRIMARY KEY (todo_id, occurrence_at)
);

CREATE INDEX IF NOT EXISTS idx_todo_completions_completed_at ON todo_completions (completed_at);
";

/// Creates missing tables/indexes and upgrades old todo rows without losing their data.
pub fn ensure(db: &Db) -> ApiResult<()> {
    repository::transaction(db, |transaction| {
        transaction.execute_batch(SCHEMA)?;

        let has_due_date: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('todos') WHERE name = 'due_date')",
            [],
            |row| row.get(0),
        )?;
        if !has_due_date {
            transaction.execute("ALTER TABLE todos ADD COLUMN due_date INTEGER", [])?;
        }

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
    fn ensure_adds_due_dates_to_existing_tasks_without_losing_data() {
        let db = Db::open_in_memory().expect("in-memory database opens");
        let old_schema = SCHEMA.replace(",\n    due_date     INTEGER", "");
        db.connection()
            .expect("connection")
            .execute_batch(&old_schema)
            .expect("previous schema");
        repository::execute(
            &db,
            "INSERT INTO todos (title, completed, completed_at, created_at, updated_at, tag_ids)
             VALUES ('existing task', 1, 100, 50, 100, '[1]')",
            [],
        )
        .expect("old task");
        repository::execute(
            &db,
            "INSERT INTO tags (id, name, created_at) VALUES (1, 'work', 50)",
            [],
        )
        .expect("old tag");
        repository::execute(
            &db,
            "INSERT INTO todo_tags (todo_id, tag_id) VALUES (1, 1)",
            [],
        )
        .expect("old link");

        ensure(&db).expect("upgraded");
        ensure(&db).expect("upgrade is idempotent");

        let todo = crate::models::todo::Todo::find(&db, 1).expect("old task still exists");
        assert_eq!(todo.title, "existing task");
        assert!(todo.completed);
        assert_eq!(todo.created_at, 50);
        assert_eq!(todo.updated_at, 100);
        assert_eq!(todo.tag_ids, [1]);
        assert_eq!(todo.due_date, None);
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM todo_tags", []).expect("links"),
            1
        );
        crate::models::todo::Todo::update(&db, 1, "existing task", Some(0))
            .expect("upgraded rows can save dates");
    }

    #[test]
    fn adding_recurrence_tables_preserves_existing_one_time_tasks() {
        let db = Db::open_in_memory().expect("database");
        db.connection()
            .expect("connection")
            .execute_batch(
                "CREATE TABLE todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0, completed_at INTEGER,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                tag_ids TEXT NOT NULL DEFAULT '[]'
             );
             INSERT INTO todos (title, completed, completed_at, created_at, updated_at)
             VALUES ('existing task', 1, 1700000060, 1700000000, 1700000060);",
            )
            .expect("previous schema");
        ensure(&db).expect("new tables");
        ensure(&db).expect("second run");
        let tasks = crate::models::todo::Todo::list(&db, None).expect("list");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "existing task");
        assert!(tasks[0].completed);
        assert_eq!(tasks[0].recurrence, None);
        assert_eq!(tasks[0].next_occurrence_at, None);
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

    fn maintenance_script() -> String {
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/init_db.ps1"
        ))
        .expect("the maintenance script exists")
    }

    fn maintenance_script_sql(script: &str) -> String {
        let start = script.find("@'").expect("the script holds a here-string") + 2;
        let end = script[start..]
            .find("'@")
            .expect("the here-string is closed");

        script[start..start + end].to_owned()
    }

    #[test]
    fn maintenance_script_creates_the_same_schema() {
        let script = maintenance_script();

        let db = created();
        let connection = db.connection().expect("connection");
        connection
            .execute_batch(&maintenance_script_sql(&script))
            .expect("the script's statements run against a created database");

        let mut expected = TABLES;
        expected.sort_unstable();

        let mut statement = connection
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name",
            )
            .expect("the query compiles");
        let actual = statement
            .query_map([], |row| row.get::<_, String>(0))
            .expect("the query runs")
            .collect::<Result<Vec<String>, _>>()
            .expect("the rows are readable");

        assert_eq!(actual, expected);

        let scripted = Db::open_in_memory().expect("script database opens");
        scripted
            .connection()
            .expect("connection")
            .execute_batch(&maintenance_script_sql(&script))
            .expect("script creates a fresh database");
        let todo_columns = |database: &Db| {
            repository::query_all(
                database,
                "SELECT name || ':' || type FROM pragma_table_info('todos') ORDER BY cid",
                [],
                |row| Ok(row.get::<_, String>(0)?),
            )
            .expect("todo columns")
        };
        assert_eq!(todo_columns(&scripted), todo_columns(&db));
    }
}
