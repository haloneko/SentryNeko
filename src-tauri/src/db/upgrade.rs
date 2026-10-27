//! Opens the database this build reads, carrying an older file forward when it finds one.
//!
//! The version a database belongs to is written into its file name — `sentryneko-0.2.0.db` — and
//! `config.json` records the path. Every start compares the name with
//! [`crate::version::PROGRAM_VERSION`]: a match opens the file as it stands, and anything else — an
//! older build, a newer one, or a name that carries no version at all — is carried into a fresh
//! file named for this build before anything else touches the data.
//!
//! The copy is all or nothing. Every table both files know is copied column by column inside one
//! transaction: rows keep their ids, so the references between them survive, and a column this
//! build added is simply left out of the insert — the schema's own default fills it in. The
//! configuration is rewritten only once that transaction has committed, so a failed copy leaves
//! the previous build's file exactly where it was, still the one on record, and the half-made file
//! is removed rather than left to be mistaken for this build's own.

use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;

use crate::config::Config;
use crate::db::connection::{database_file_name, Db};
use crate::db::schema::{self, TABLES};
use crate::utils::response::{ApiError, ApiResult};
use crate::version::PROGRAM_VERSION;

/// What a start found when it went to open this build's database.
pub enum Opened {
    /// This build's database, ready for the rest of the application to use.
    Current(Db),
    /// The recorded file could not be carried forward, and nothing was changed because of it.
    Stranded(Stranded),
}

/// Why a start could not open a database, and which file it left on record.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stranded {
    /// The file the configuration still points at: the one the previous build left behind.
    pub from: String,
    /// What went wrong, in the words the database gave.
    pub reason: String,
}

/// What this start found, for the interface to ask about once it is up.
#[derive(Debug, Clone, Default)]
pub struct Migration {
    stranded: Option<Stranded>,
}

impl Migration {
    /// A start that found this build's database.
    pub const fn current() -> Self {
        Self { stranded: None }
    }

    /// A start that could not carry the recorded file forward.
    pub const fn stranded(stranded: Stranded) -> Self {
        Self {
            stranded: Some(stranded),
        }
    }

    /// Why no database could be opened, when that is what happened.
    pub const fn stranded_reason(&self) -> Option<&Stranded> {
        self.stranded.as_ref()
    }
}

/// Opens the database this build reads, carrying the recorded file forward when it is not this
/// build's.
pub fn open(config: &Config) -> ApiResult<Opened> {
    let path = config.database_path()?;

    if version_of(&path).as_deref() == Some(PROGRAM_VERSION) {
        return Ok(Opened::Current(current(&path)?));
    }

    carry_forward(config, &path)
}

/// Opens `path` as this build's database, creating whatever its schema still lacks.
fn current(path: &Path) -> ApiResult<Db> {
    let db = Db::open(path)?;
    schema::ensure(&db)?;

    Ok(db)
}

/// Creates this build's database file beside the old one and copies what the old one holds.
///
/// The configuration is rewritten only once the data has committed, so a start that dies halfway
/// leaves the old file recorded and the copy half-made — never the other way round, where the
/// configuration would point at a database that was never filled.
fn carry_forward(config: &Config, from: &Path) -> ApiResult<Opened> {
    let to = from.with_file_name(database_file_name());

    // A file named for this build is already there: an earlier start got this far. What it holds
    // was written by this build's own schema, so opening it beats copying over it.
    if to.exists() {
        config.set_database_path(&to)?;

        return Ok(Opened::Current(current(&to)?));
    }

    // Nothing is on disk where the configuration points, so there is nothing to carry: this is a
    // first run whose configuration was written by a build whose file has since been removed.
    if !from.exists() {
        config.set_database_path(&to)?;

        return Ok(Opened::Current(current(&to)?));
    }

    let db = Db::open(&to)?;
    schema::ensure(&db)?;

    match copy_tables(from, &db) {
        Ok(()) => {
            // The data is in place; only now does the configuration move.
            config.set_database_path(&to)?;

            Ok(Opened::Current(db))
        }
        Err(error) => {
            // The transaction rolled back, so the file holds an empty schema and nothing else. It
            // is removed rather than left behind: a file named for this build would otherwise be
            // opened as it stands by the next start, and an empty database is worse than none. The
            // old file was never touched, and the configuration still names it.
            drop(db);
            remove_database(&to);

            Ok(Opened::Stranded(Stranded {
                from: from.display().to_string(),
                reason: error.to_string(),
            }))
        }
    }
}

/// The version written into a database file name, or `None` when it carries none.
///
/// Only the tail of the stem is read — `sentryneko-1.2.3.db` answers `1.2.3` — so a file renamed by
/// hand keeps whatever version its name ends with, and a name without one answers `None`.
fn version_of(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let (_, version) = stem.split_once('-')?;

    is_version(version).then(|| version.to_owned())
}

/// Whether `text` is a version this scheme would have written: three numbers, then an optional
/// prerelease or build suffix.
fn is_version(text: &str) -> bool {
    let core = text.split(['-', '+']).next();

    matches!(core, Some(core) if {
        let mut parts = core.split('.');

        parts.next().is_some_and(is_number)
            && parts.next().is_some_and(is_number)
            && parts.next().is_some_and(is_number)
            && parts.next().is_none()
    })
}

fn is_number(part: &str) -> bool {
    !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
}

/// Copies every table both databases know, keeping the ids the rows refer to each other by.
///
/// A table the old file lacks is one this build added, and an empty one is exactly what a fresh
/// install would have. Anything else that goes wrong — a shape too far from this build's, a
/// constraint the shared columns cannot satisfy — fails the whole copy, because a database that is
/// quietly missing a table is worse than one that was never opened.
fn copy_tables(from: &Path, to: &Db) -> ApiResult<()> {
    // Opened read-write on purpose: a database left with a hot journal needs to recover before it
    // can be read, and a read-only handle cannot do that. Nothing here ever writes to it.
    let old = Connection::open(from)?;

    let mut connection = to.connection()?;
    let transaction = connection.transaction()?;

    for table in TABLES {
        copy_table(&old, &transaction, table)?;
    }

    advance_sequences(&transaction)?;
    transaction.commit()?;

    Ok(())
}

/// Copies one table, answering how many rows made it across.
fn copy_table(from: &Connection, to: &Connection, table: &str) -> ApiResult<usize> {
    if !has_table(from, table)? {
        return Ok(0);
    }

    let shared = shared_columns(from, to, table)?;
    if shared.is_empty() {
        // The old file has a table of that name with nothing at all in common with this build's:
        // not a table this build added, but one it cannot read.
        return Err(ApiError::unsupported(format!(
            "the table {table} in the previous database shares no column with this build"
        )));
    }

    let columns = shared.join(", ");
    let values = vec!["?"; shared.len()].join(", ");
    let mut statement = from.prepare(&format!("SELECT {columns} FROM {table}"))?;
    let mut rows = statement.query([])?;
    let mut insert = to.prepare(&format!(
        "INSERT INTO {table} ({columns}) VALUES ({values})"
    ))?;

    let mut copied = 0;
    while let Some(row) = rows.next()? {
        let values: Vec<rusqlite::types::Value> = (0..shared.len())
            .map(|index| row.get::<_, rusqlite::types::Value>(index))
            .collect::<Result<_, _>>()?;
        insert.execute(rusqlite::params_from_iter(values))?;
        copied += 1;
    }

    Ok(copied)
}

/// The columns both files have, in the order the new table declares them.
fn shared_columns(from: &Connection, to: &Connection, table: &str) -> ApiResult<Vec<String>> {
    let old = columns(from, table)?;
    let new = columns(to, table)?;

    Ok(new
        .into_iter()
        .filter(|column| old.contains(column))
        .collect())
}

/// The columns of `table`, in the order they are declared.
fn columns(connection: &Connection, table: &str) -> ApiResult<Vec<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;

    let mut names = Vec::new();
    while let Some(row) = rows.next()? {
        names.push(row.get::<_, String>(1)?);
    }

    Ok(names)
}

/// Whether `connection` holds a table of that name.
fn has_table(connection: &Connection, table: &str) -> ApiResult<bool> {
    let found: u32 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;

    Ok(found == 1)
}

/// Removes a database file and the journals that sit beside it.
fn remove_database(path: &Path) {
    for extension in ["db-wal", "db-shm", "db-journal"] {
        let _ = std::fs::remove_file(path.with_extension(extension));
    }

    let _ = std::fs::remove_file(path);
}

/// Keeps the next automatic id above every id that was copied in.
///
/// SQLite moves `sqlite_sequence` on its own inserts, not on rows that arrive with an id of their
/// own, so a copied row with a high id would otherwise be handed out again to the next new row.
fn advance_sequences(connection: &Connection) -> ApiResult<()> {
    for table in TABLES {
        let columns = columns(connection, table)?;
        if !columns.iter().any(|column| column == "id") {
            continue;
        }

        // The table has no constraint to conflict on, so the row is written outright — and the
        // value written is the larger of what the copy left and what the file already said.
        connection.execute(
            &format!(
                "INSERT OR REPLACE INTO sqlite_sequence (name, seq)
                 VALUES (?1, MAX(
                     (SELECT COALESCE(MAX(id), 0) FROM {table}),
                     COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?1), 0)
                 ))"
            ),
            [table],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn directory() -> TempDir {
        tempfile::tempdir().expect("a temporary directory is created")
    }

    fn config_in(directory: &TempDir) -> Config {
        Config::open(directory.path()).expect("the configuration is created")
    }

    /// A database of another build: the same schema, filed under an older version's name.
    fn older_file(directory: &TempDir, name: &str) -> PathBuf {
        let path = directory.path().join(name);
        let db = Db::open(&path).expect("the old database is created");
        schema::ensure(&db).expect("the old schema is created");

        db.connection()
            .expect("connection")
            .execute_batch(
                "INSERT INTO todos (title, created_at, updated_at) VALUES ('carry me', 10, 10);
                 INSERT INTO tags (name, created_at) VALUES ('work', 10);
                 INSERT INTO todo_tags (todo_id, tag_id) VALUES (1, 1);
                 INSERT INTO settings (key, value, category, updated_at)
                     VALUES ('alarm.defaults', '{}', 'alarm', 10);",
            )
            .expect("the old rows are written");

        path
    }

    fn count(db: &Db, table: &str) -> i64 {
        db.connection()
            .expect("connection")
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("the table is counted")
    }

    fn scalar(db: &Db, sql: &str) -> rusqlite::types::Value {
        db.connection()
            .expect("connection")
            .query_row(sql, [], |row| row.get(0))
            .expect("the value is read")
    }

    /// Opens through the upgrade path, answering the database when the start found one.
    fn opened(config: &Config) -> Db {
        match open(config).expect("the start is answered") {
            Opened::Current(db) => db,
            Opened::Stranded(stranded) => panic!("the start was stranded: {}", stranded.reason),
        }
    }

    /// Opens through the upgrade path, answering what stranded the start.
    fn stranded(config: &Config) -> Stranded {
        match open(config).expect("the start is answered") {
            Opened::Current(_) => panic!("the start found a database"),
            Opened::Stranded(stranded) => stranded,
        }
    }

    /// A database of another build holding a row this build's schema would refuse: the old file
    /// was written before the constraint existed, so nothing stopped it going in.
    fn refusing_file(directory: &TempDir) -> PathBuf {
        let path = directory.path().join("sentryneko-0.0.0.db");
        Db::open(&path)
            .expect("the old database is created")
            .connection()
            .expect("connection")
            .execute_batch(
                "CREATE TABLE todos (
                     id         INTEGER PRIMARY KEY AUTOINCREMENT,
                     title      TEXT    NOT NULL,
                     completed  INTEGER NOT NULL DEFAULT 0,
                     created_at INTEGER NOT NULL,
                     updated_at INTEGER NOT NULL
                 );
                 INSERT INTO todos (title, completed, created_at, updated_at)
                     VALUES ('bad', 2, 1, 1);",
            )
            .expect("the old shape is written");

        path
    }

    #[test]
    fn the_version_is_read_from_the_end_of_the_file_name() {
        assert_eq!(
            version_of(Path::new("sentryneko-1.2.3.db")).as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            version_of(Path::new("sentryneko-1.2.3-beta.1.db")).as_deref(),
            Some("1.2.3-beta.1")
        );
        assert_eq!(
            version_of(Path::new("D:\\data\\sentryneko-1.2.3.db")).as_deref(),
            Some("1.2.3")
        );
        assert_eq!(version_of(Path::new("sentryneko.db")).as_deref(), None);
        assert_eq!(version_of(Path::new("my-library.db")).as_deref(), None);
        assert_eq!(version_of(Path::new("sentryneko-1.2.db")).as_deref(), None);
    }

    #[test]
    fn a_file_named_for_this_build_is_opened_as_it_is() {
        let directory = directory();
        let config = config_in(&directory);
        let path = directory.path().join(database_file_name());
        config
            .set_database_path(&path)
            .expect("the path is recorded");

        {
            let db = Db::open(&path).expect("the database is created");
            schema::ensure(&db).expect("the schema is created");
            db.connection()
                .expect("connection")
                .execute(
                    "INSERT INTO todos (title, created_at, updated_at) VALUES ('kept', 1, 1)",
                    [],
                )
                .expect("the row is written");
        }

        let db = opened(&config);

        assert_eq!(count(&db, "todos"), 1);
        let databases = std::fs::read_dir(directory.path())
            .expect("the directory is readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "db")
            })
            .count();
        assert_eq!(
            databases, 1,
            "only this build's file is there: nothing was carried forward"
        );
    }

    #[test]
    fn an_older_file_is_carried_into_this_build_s_file() {
        let directory = directory();
        let config = config_in(&directory);
        let old = older_file(&directory, "sentryneko-0.0.0.db");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);

        let current = directory.path().join(database_file_name());
        assert!(current.exists(), "this build's file was created beside it");
        assert!(old.exists(), "the old file is left where it was");
        assert_eq!(
            config.database_path().expect("the recorded path"),
            current,
            "the configuration now points at this build's file"
        );

        assert_eq!(count(&db, "todos"), 1);
        assert_eq!(count(&db, "tags"), 1);
        assert_eq!(count(&db, "todo_tags"), 1, "the link kept its meaning");
        assert_eq!(count(&db, "settings"), 1);
        assert_eq!(
            scalar(&db, "SELECT title FROM todos WHERE id = 1"),
            rusqlite::types::Value::Text("carry me".to_owned()),
            "the row kept its id, so the link beside it still points at it"
        );
    }

    #[test]
    fn a_name_without_a_version_is_carried_forward_too() {
        let directory = directory();
        let config = config_in(&directory);
        let old = older_file(&directory, "sentryneko.db");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);

        assert_eq!(count(&db, "todos"), 1);
        assert_eq!(
            config.database_path().expect("the recorded path"),
            directory.path().join(database_file_name())
        );
    }

    #[test]
    fn a_table_the_old_file_lacks_is_created_empty() {
        let directory = directory();
        let config = config_in(&directory);

        let old = directory.path().join("sentryneko-0.0.0.db");
        Db::open(&old)
            .expect("the old database is created")
            .connection()
            .expect("connection")
            .execute_batch(
                "CREATE TABLE todos (
                     id         INTEGER PRIMARY KEY AUTOINCREMENT,
                     title      TEXT    NOT NULL,
                     completed  INTEGER NOT NULL DEFAULT 0,
                     created_at INTEGER NOT NULL,
                     updated_at INTEGER NOT NULL
                 );
                 INSERT INTO todos (title, created_at, updated_at) VALUES ('old', 1, 1);",
            )
            .expect("the old shape is written");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);

        assert_eq!(count(&db, "todos"), 1);
        assert_eq!(
            count(&db, "alarms"),
            0,
            "a table this build added starts empty"
        );
    }

    #[test]
    fn a_column_this_build_added_takes_its_default() {
        let directory = directory();
        let config = config_in(&directory);

        let old = directory.path().join("sentryneko-0.0.0.db");
        Db::open(&old)
            .expect("the old database is created")
            .connection()
            .expect("connection")
            .execute_batch(
                "CREATE TABLE todos (
                     id         INTEGER PRIMARY KEY AUTOINCREMENT,
                     title      TEXT    NOT NULL,
                     completed  INTEGER NOT NULL DEFAULT 0,
                     created_at INTEGER NOT NULL,
                     updated_at INTEGER NOT NULL
                 );
                 INSERT INTO todos (title, created_at, updated_at) VALUES ('old', 1, 1);",
            )
            .expect("the old shape is written");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);

        assert_eq!(
            scalar(&db, "SELECT tag_ids FROM todos WHERE id = 1"),
            rusqlite::types::Value::Text("[]".to_owned()),
            "the column this build added took the schema's default"
        );
        assert_eq!(
            scalar(&db, "SELECT start_at FROM todos WHERE id = 1"),
            rusqlite::types::Value::Null,
            "a column with no default stays empty"
        );
        assert_eq!(
            scalar(&db, "SELECT extra FROM todos WHERE id = 1"),
            rusqlite::types::Value::Text("{}".to_owned()),
            "an older file gets an empty bag rather than a missing one"
        );
    }

    #[test]
    fn the_next_new_row_does_not_reuse_a_copied_id() {
        let directory = directory();
        let config = config_in(&directory);
        let old = older_file(&directory, "sentryneko-0.0.0.db");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);
        db.connection()
            .expect("connection")
            .execute(
                "INSERT INTO todos (title, created_at, updated_at) VALUES ('next', 1, 1)",
                [],
            )
            .expect("the new row is written");

        assert_eq!(
            scalar(&db, "SELECT MAX(id) FROM todos"),
            rusqlite::types::Value::Integer(2),
            "the copied row keeps id 1, so the new one takes 2"
        );
    }

    #[test]
    fn a_file_this_build_already_made_is_used_rather_than_copied_over() {
        let directory = directory();
        let config = config_in(&directory);
        let current = directory.path().join(database_file_name());

        {
            let db = Db::open(&current).expect("this build's file is created");
            schema::ensure(&db).expect("the schema is created");
            db.connection()
                .expect("connection")
                .execute(
                    "INSERT INTO todos (title, created_at, updated_at)
                     VALUES ('already here', 1, 1)",
                    [],
                )
                .expect("the row is written");
        }

        let old = older_file(&directory, "sentryneko-0.0.0.db");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let db = opened(&config);

        assert_eq!(
            scalar(&db, "SELECT title FROM todos WHERE id = 1"),
            rusqlite::types::Value::Text("already here".to_owned()),
            "an earlier start already filled this build's file, so the old one is left alone"
        );
        assert_eq!(count(&db, "todos"), 1);
        assert_eq!(config.database_path().expect("the recorded path"), current);
    }

    #[test]
    fn a_row_the_new_schema_refuses_strands_the_start() {
        let directory = directory();
        let config = config_in(&directory);
        let old = refusing_file(&directory);
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let stranded = stranded(&config);

        assert_eq!(
            stranded.from,
            old.display().to_string(),
            "the file on record is named, so the interface can point at it"
        );
        assert!(
            stranded.reason.contains("CHECK"),
            "the reason says what the database refused: {}",
            stranded.reason
        );
        assert_eq!(
            config.database_path().expect("the recorded path"),
            old,
            "a failed copy changes nothing: the configuration still points at the old file"
        );
        assert!(
            !directory.path().join(database_file_name()).exists(),
            "the half-made file is removed, so no start mistakes it for this build's own"
        );

        let kept = Connection::open(&old).expect("the old file still opens");
        assert_eq!(
            kept.query_row("SELECT COUNT(*) FROM todos", [], |row| row.get::<_, i64>(0))
                .expect("the old file is counted"),
            1,
            "the old file was never written to"
        );
    }

    #[test]
    fn a_table_that_shares_nothing_strands_the_start() {
        let directory = directory();
        let config = config_in(&directory);

        let old = directory.path().join("sentryneko-0.0.0.db");
        Db::open(&old)
            .expect("the old database is created")
            .connection()
            .expect("connection")
            .execute_batch(
                "CREATE TABLE todos (name TEXT);
                 INSERT INTO todos (name) VALUES ('something else entirely');",
            )
            .expect("the old shape is written");
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        let stranded = stranded(&config);

        assert!(
            stranded.reason.contains("shares no column"),
            "the reason names what could not be read: {}",
            stranded.reason
        );
        assert_eq!(
            config.database_path().expect("the recorded path"),
            old,
            "the configuration is untouched"
        );
    }

    #[test]
    fn a_stranded_start_is_tried_again_on_the_next_launch() {
        let directory = directory();
        let config = config_in(&directory);
        let old = refusing_file(&directory);
        config
            .set_database_path(&old)
            .expect("the path is recorded");

        stranded(&config);

        // Whatever the user does about it — rolling back, repairing the file by hand — the next
        // start finds nothing left over from the failed one and tries the same road again.
        {
            let repair = Connection::open(&old).expect("the old file is opened for repair");
            repair
                .execute("UPDATE todos SET completed = 0 WHERE id = 1", [])
                .expect("the row is brought inside the new constraint");
        }

        let db = opened(&config);

        assert_eq!(count(&db, "todos"), 1);
        assert_eq!(
            config.database_path().expect("the recorded path"),
            directory.path().join(database_file_name()),
            "the retry carried the file and moved the configuration"
        );
    }
}
