//! Generic data access layer (CRUD helpers shared by all models).

use rusqlite::{Params, Row, Transaction, TransactionBehavior};

use crate::db::connection::Db;
use crate::utils::response::{ApiCode, ApiError, ApiResult};

/// Maps the current row into a domain value.
pub type RowMapper<T> = fn(&Row<'_>) -> ApiResult<T>;

/// Runs an `INSERT` and returns the new row id.
pub fn insert(db: &Db, sql: &str, params: impl Params) -> ApiResult<i64> {
    let connection = db.connection()?;
    let mut statement = connection.prepare_cached(sql)?;
    statement.execute(params)?;

    Ok(connection.last_insert_rowid())
}

/// Runs an `UPDATE` / `DELETE` and returns the number of affected rows.
pub fn execute(db: &Db, sql: &str, params: impl Params) -> ApiResult<usize> {
    let connection = db.connection()?;
    let mut statement = connection.prepare_cached(sql)?;

    Ok(statement.execute(params)?)
}

/// Returns the first row, or `None` when the query matches nothing.
pub fn query_optional<T>(
    db: &Db,
    sql: &str,
    params: impl Params,
    map: RowMapper<T>,
) -> ApiResult<Option<T>> {
    let connection = db.connection()?;
    let mut statement = connection.prepare_cached(sql)?;
    let mut rows = statement.query(params)?;

    match rows.next()? {
        Some(row) => Ok(Some(map(row)?)),
        None => Ok(None),
    }
}

/// Returns the first row, or `NOT_FOUND` when the query matches nothing.
pub fn query_one<T>(db: &Db, sql: &str, params: impl Params, map: RowMapper<T>) -> ApiResult<T> {
    query_optional(db, sql, params, map)?
        .ok_or_else(|| ApiError::new(ApiCode::NotFound).with_details(sql))
}

/// Maps every row of a query.
pub fn query_all<T>(
    db: &Db,
    sql: &str,
    params: impl Params,
    map: RowMapper<T>,
) -> ApiResult<Vec<T>> {
    let connection = db.connection()?;
    let mut statement = connection.prepare_cached(sql)?;
    let rows = statement.query_and_then(params, map)?;

    rows.collect::<ApiResult<Vec<T>>>()
}

/// Returns the value of the first column of the first row.
pub fn count(db: &Db, sql: &str, params: impl Params) -> ApiResult<i64> {
    query_one(db, sql, params, |row| {
        row.get::<_, i64>(0).map_err(ApiError::from)
    })
}

/// Whether the query matches at least one row.
pub fn exists(db: &Db, sql: &str, params: impl Params) -> ApiResult<bool> {
    let connection = db.connection()?;
    let mut statement = connection.prepare_cached(sql)?;
    let mut rows = statement.query(params)?;

    Ok(rows.next()?.is_some())
}

/// Runs `work` inside a transaction, rolling back when it returns an error.
pub fn transaction<T>(
    db: &Db,
    work: impl FnOnce(&Transaction<'_>) -> ApiResult<T>,
) -> ApiResult<T> {
    with_transaction(db, TransactionBehavior::Deferred, work)
}

/// Reserves the writer before reading, so concurrent read/modify/write operations wait rather
/// than failing to upgrade an outdated SQLite snapshot.
pub fn immediate_transaction<T>(
    db: &Db,
    work: impl FnOnce(&Transaction<'_>) -> ApiResult<T>,
) -> ApiResult<T> {
    with_transaction(db, TransactionBehavior::Immediate, work)
}

fn with_transaction<T>(
    db: &Db,
    behavior: TransactionBehavior,
    work: impl FnOnce(&Transaction<'_>) -> ApiResult<T>,
) -> ApiResult<T> {
    let mut connection = db.connection()?;
    let transaction = connection.transaction_with_behavior(behavior)?;
    let value = work(&transaction)?;
    transaction.commit()?;

    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::Db;
    use crate::db::schema;
    use crate::utils::response::ApiCode;

    fn todo_row(row: &Row<'_>) -> ApiResult<(i64, String, bool)> {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    }

    fn migrated() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn insert_returns_the_new_row_id() {
        let db = migrated();

        let first = insert(
            &db,
            "INSERT INTO todos (title, created_at, updated_at) VALUES (?1, 1, 1)",
            ["write the docs"],
        )
        .expect("todo is inserted");

        assert_eq!(first, 1);
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM todos", []).expect("count"),
            1
        );
    }

    #[test]
    fn query_helpers_map_rows_and_report_missing_ones() {
        let db = migrated();

        insert(
            &db,
            "INSERT INTO todos (title, completed, created_at, updated_at) VALUES (?1, 1, 1, 1)",
            ["shipped"],
        )
        .expect("todo is inserted");

        let found = query_one(&db, "SELECT id, title, completed FROM todos", [], todo_row)
            .expect("the row exists");
        assert_eq!(found, (1, "shipped".to_owned(), true));

        assert!(query_optional(
            &db,
            "SELECT id, title, completed FROM todos WHERE id = ?1",
            [404],
            todo_row
        )
        .expect("query runs")
        .is_none());

        let error = query_one(
            &db,
            "SELECT id, title, completed FROM todos WHERE id = ?1",
            [404],
            todo_row,
        )
        .expect_err("a missing row is NOT_FOUND");
        assert_eq!(error.code(), ApiCode::NotFound);
    }

    #[test]
    fn execute_reports_affected_rows_and_exists_follows() {
        let db = migrated();

        insert(
            &db,
            "INSERT INTO todos (title, created_at, updated_at) VALUES (?1, 1, 1)",
            ["pending"],
        )
        .expect("todo is inserted");

        assert!(exists(&db, "SELECT 1 FROM todos WHERE completed = 0", []).expect("exists"));

        let affected = execute(&db, "UPDATE todos SET completed = 1 WHERE id = ?1", [1])
            .expect("todo is updated");
        assert_eq!(affected, 1);
        assert!(!exists(&db, "SELECT 1 FROM todos WHERE completed = 0", []).expect("exists"));
    }

    #[test]
    fn constraint_violations_surface_as_database_errors() {
        let db = migrated();

        let error = insert(
            &db,
            "INSERT INTO todos (title, completed, created_at, updated_at) VALUES (?1, 7, 1, 1)",
            ["impossible"],
        )
        .expect_err("completed is constrained to 0 or 1");

        assert_eq!(error.code(), ApiCode::Database);
        assert!(error.details().is_some(), "the SQLite message is kept");
    }

    #[test]
    fn transaction_rolls_back_when_the_work_fails() {
        let db = migrated();

        let result: ApiResult<()> = transaction(&db, |transaction| {
            transaction.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('theme', 'dark', 1)",
                [],
            )?;
            Err(ApiError::internal("the caller changed its mind"))
        });

        assert_eq!(
            result.expect_err("the work failed").code(),
            ApiCode::Internal
        );
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM settings", []).expect("count"),
            0
        );
    }

    #[test]
    fn transaction_commits_the_work_it_completes() {
        let db = migrated();

        let stored = transaction(&db, |transaction| {
            transaction.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, 1)",
                rusqlite::params!["language", "zh-CN"],
            )?;

            transaction
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    ["language"],
                    |row| row.get::<_, String>(0),
                )
                .map_err(ApiError::from)
        })
        .expect("the transaction commits");

        assert_eq!(stored, "zh-CN");
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM settings", []).expect("count"),
            1
        );
    }
}
