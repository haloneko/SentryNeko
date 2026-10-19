//! Application settings: one row per key, grouped under a category.
//!
//! The table is a plain key/value store. `get_setting` / `set_setting` serve every key and the
//! backend never looks inside a value, so a new preference needs no code here at all.
//!
//! A payload's shape belongs to the screen that owns the data: the frontend checks a layout or a
//! duration before it writes one and normalizes what it reads back. What is checked here is only
//! what the table itself needs — a key, a category and a value that is JSON and not a document.
//!
//! Backend code that consumes a preference does parse it into its own model and check it there,
//! so storing junk never turns into ringing with junk: see [`crate::models::alarm::AlarmDefaults`].

use rusqlite::{params, Row};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;

/// Longest accepted key, so a stray caller cannot fill the column.
const MAX_KEY_LENGTH: usize = 64;

/// Longest accepted category tag.
const MAX_CATEGORY_LENGTH: usize = 32;

/// Largest accepted value, in bytes: a preference is not a place to park documents.
const MAX_VALUE_LENGTH: usize = 64 * 1024;

/// Columns every query selects, in the order [`Setting::from_row`] reads them.
const COLUMNS: &str = "key, value, category, updated_at";

/// One stored preference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    /// Unique name, dotted by subject (`pomodoro.durations`).
    pub key: String,
    /// JSON text, handed back verbatim.
    pub value: String,
    /// Subject the row is grouped under.
    pub category: String,
    /// Epoch seconds of the last write.
    pub updated_at: i64,
}

impl Setting {
    /// Reads one setting, or `None` when nothing has been stored under `key`.
    pub fn load(db: &Db, key: &str) -> ApiResult<Option<Self>> {
        repository::query_optional(
            db,
            &format!("SELECT {COLUMNS} FROM settings WHERE key = ?1"),
            [key],
            Self::from_row,
        )
    }

    /// Lists settings in key order, narrowed to `category` when one is given.
    pub fn list(db: &Db, category: Option<&str>) -> ApiResult<Vec<Self>> {
        match category {
            Some(category) => repository::query_all(
                db,
                &format!("SELECT {COLUMNS} FROM settings WHERE category = ?1 ORDER BY key"),
                [category],
                Self::from_row,
            ),
            None => repository::query_all(
                db,
                &format!("SELECT {COLUMNS} FROM settings ORDER BY key"),
                [],
                Self::from_row,
            ),
        }
    }

    /// Creates or replaces the row and answers with what is now stored.
    ///
    /// `category` is the caller's: the store does not know which subject a screen files under.
    pub fn set(db: &Db, key: &str, value: &str, category: &str) -> ApiResult<Self> {
        check(key, value, category)?;
        let updated_at = time::now_seconds();

        repository::execute(
            db,
            "INSERT INTO settings (key, value, category, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (key) DO UPDATE SET
                 value = excluded.value,
                 category = excluded.category,
                 updated_at = excluded.updated_at",
            params![key, value, category, updated_at],
        )?;

        Ok(Self {
            key: key.to_owned(),
            value: value.to_owned(),
            category: category.to_owned(),
            updated_at,
        })
    }

    /// Removes the row under `key`; `false` means there was nothing to remove.
    pub fn delete(db: &Db, key: &str) -> ApiResult<bool> {
        Ok(repository::execute(db, "DELETE FROM settings WHERE key = ?1", [key])? > 0)
    }

    /// Reads a typed setting, for the code that consumes one.
    pub fn read_json<T: DeserializeOwned>(db: &Db, key: &str) -> ApiResult<Option<T>> {
        match Self::load(db, key)? {
            Some(setting) => Ok(Some(serde_json::from_str(&setting.value)?)),
            None => Ok(None),
        }
    }

    /// Stores a typed setting under `key`, filed under `category`.
    pub fn write_json<T: Serialize>(
        db: &Db,
        key: &str,
        category: &str,
        value: &T,
    ) -> ApiResult<()> {
        Self::set(db, key, &serde_json::to_string(value)?, category).map(|_| ())
    }

    fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            key: row.get(0)?,
            value: row.get(1)?,
            category: row.get(2)?,
            updated_at: row.get(3)?,
        })
    }
}

/// Rejects a key or category the table cannot identify, and a value that is not JSON.
fn check(key: &str, value: &str, category: &str) -> ApiResult<()> {
    let key = key.trim();

    if key.is_empty() {
        return Err(ApiError::invalid_input("a setting key must not be empty"));
    }

    if key.len() > MAX_KEY_LENGTH {
        return Err(ApiError::invalid_input(format!(
            "a setting key must be at most {MAX_KEY_LENGTH} characters"
        ))
        .with_details(format!("received {}", key.len())));
    }

    if category.trim().is_empty() {
        return Err(ApiError::invalid_input(
            "a setting needs a category to be listed under",
        ));
    }

    if category.len() > MAX_CATEGORY_LENGTH {
        return Err(ApiError::invalid_input(format!(
            "a category must be at most {MAX_CATEGORY_LENGTH} characters"
        ))
        .with_details(format!("received {}", category.len())));
    }

    if value.len() > MAX_VALUE_LENGTH {
        return Err(ApiError::invalid_input(format!(
            "a setting value must be at most {MAX_VALUE_LENGTH} bytes"
        ))
        .with_details(format!("received {}", value.len())));
    }

    serde_json::from_str::<serde_json::Value>(value).map_err(|error| {
        ApiError::invalid_input("a setting value must be JSON").with_details(error.to_string())
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn a_missing_key_reads_as_nothing() {
        assert_eq!(
            Setting::load(&created(), "sidebar.panels").expect("the read succeeds"),
            None
        );
    }

    #[test]
    fn a_setting_is_created_and_then_replaced_in_place() {
        let db = created();

        let first =
            Setting::set(&db, "dashboard.columns", "2", "dashboard").expect("the row is created");
        assert_eq!(first.category, "dashboard");

        let second =
            Setting::set(&db, "dashboard.columns", "4", "pomodoro").expect("the row is replaced");

        assert_eq!(
            Setting::load(&db, "dashboard.columns").expect("the row is read"),
            Some(second.clone())
        );
        assert_eq!(second.category, "pomodoro", "the category is the caller's");
        assert_eq!(
            repository::count(&db, "SELECT COUNT(*) FROM settings", []).expect("count"),
            1,
            "a key owns exactly one row"
        );
    }

    #[test]
    fn listing_narrows_to_a_category_in_key_order() {
        let db = created();

        Setting::set(&db, "dashboard.rows", "[]", "dashboard").expect("dashboard row");
        Setting::set(&db, "pomodoro.sound", "true", "pomodoro").expect("pomodoro row");
        Setting::set(&db, "dashboard.columns", "4", "dashboard").expect("second dashboard row");

        let dashboard = Setting::list(&db, Some("dashboard")).expect("the category is listed");
        assert_eq!(
            dashboard
                .iter()
                .map(|row| row.key.as_str())
                .collect::<Vec<_>>(),
            vec!["dashboard.columns", "dashboard.rows"]
        );

        assert_eq!(Setting::list(&db, None).expect("every row").len(), 3);
        assert!(Setting::list(&db, Some("missing"))
            .expect("an unknown category is empty")
            .is_empty());
    }

    #[test]
    fn deleting_reports_whether_a_row_was_there() {
        let db = created();

        Setting::set(&db, "thermal.unit", r#""celsius""#, "panel").expect("the row is created");
        assert!(Setting::delete(&db, "thermal.unit").expect("the row is removed"));
        assert!(!Setting::delete(&db, "thermal.unit").expect("the second delete is a no-op"));
        assert_eq!(
            Setting::load(&db, "thermal.unit").expect("the read succeeds"),
            None
        );
    }

    #[test]
    fn any_payload_is_stored_verbatim() {
        let db = created();

        // The backend holds no model of these rows, so it hands back exactly what it was given —
        // including a payload whose shape it could not read and one it simply does not know.
        let layout = r#"{"columns":6,"placements":{"alarm":{"x":0,"y":0,"w":3,"h":9}}}"#;
        Setting::set(&db, "dashboard.grid", layout, "dashboard").expect("the layout is stored");

        assert_eq!(
            Setting::load(&db, "dashboard.grid")
                .expect("the row is read")
                .expect("the row exists")
                .value,
            layout
        );

        let unknown = r#"{"focus":25}"#;
        Setting::set(&db, "pomodoro.durations", unknown, "pomodoro").expect("stored as sent");
        assert_eq!(
            Setting::load(&db, "pomodoro.durations")
                .expect("the row is read")
                .expect("the row exists")
                .value,
            unknown
        );
    }

    #[test]
    fn a_value_that_is_not_json_is_rejected() {
        let error = Setting::set(&created(), "thermal.unit", "celsius", "panel")
            .expect_err("the value is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(error.message().contains("JSON"), "{error:?}");
    }

    #[test]
    fn an_empty_key_or_category_is_rejected() {
        let db = created();

        assert_eq!(
            Setting::set(&db, "  ", "[]", "panel")
                .expect_err("the key is rejected")
                .code(),
            ApiCode::InvalidInput
        );
        assert_eq!(
            Setting::set(&db, "thermal.unit", "[]", " ")
                .expect_err("the category is rejected")
                .code(),
            ApiCode::InvalidInput
        );
    }

    #[test]
    fn an_oversized_key_or_value_is_rejected() {
        let db = created();

        assert_eq!(
            Setting::set(&db, &"k".repeat(MAX_KEY_LENGTH + 1), "[]", "panel")
                .expect_err("the key is rejected")
                .code(),
            ApiCode::InvalidInput
        );

        let value = format!(r#""{}""#, "v".repeat(MAX_VALUE_LENGTH));
        assert_eq!(
            Setting::set(&db, "thermal.unit", &value, "panel")
                .expect_err("the value is rejected")
                .code(),
            ApiCode::InvalidInput
        );
    }

    #[test]
    fn typed_settings_round_trip_through_the_row() {
        let db = created();

        let durations = serde_json::json!({
            "focusSeconds": 1500,
            "shortBreakSeconds": 300,
            "longBreakSeconds": 900,
        });
        Setting::write_json(&db, "pomodoro.durations", "pomodoro", &durations)
            .expect("the value is written");

        let stored: Option<serde_json::Value> =
            Setting::read_json(&db, "pomodoro.durations").expect("the value is read");
        assert_eq!(stored, Some(durations));
        assert_eq!(
            Setting::load(&db, "pomodoro.durations")
                .expect("the row is read")
                .expect("the row exists")
                .category,
            "pomodoro"
        );
    }
}
