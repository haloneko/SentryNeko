//! Foreground application event query commands.

use tauri::State;

use crate::db::connection::Db;
use crate::models::app_event::{AppEvent, AppEventPage, AppUsage, HourlyUsage};
use crate::utils::response::{ApiResponse, ApiResult};
use crate::utils::time;

/// Ranks the applications by the seconds they held the foreground inside `[from, to)`.
#[tauri::command]
pub fn app_usage(db: State<'_, Db>, from: i64, to: i64, limit: i64) -> ApiResponse<Vec<AppUsage>> {
    usage(&db, from, to, limit).into()
}

/// Answers every hour of `[from, to)` that holds usage, one row per app, so a chart can stack them.
#[tauri::command]
pub fn app_usage_hours(db: State<'_, Db>, from: i64, to: i64) -> ApiResponse<Vec<HourlyUsage>> {
    AppUsage::hourly(&db, from, to).into()
}

/// Returns one page of foreground events, newest first; `before` pages towards older rows.
#[tauri::command]
pub fn list_app_events(
    db: State<'_, Db>,
    before: Option<i64>,
    limit: i64,
) -> ApiResponse<AppEventPage> {
    AppEvent::page(&db, before, limit).into()
}

fn usage(db: &Db, from: i64, to: i64, limit: i64) -> ApiResult<Vec<AppUsage>> {
    // A window reaching into the future would count hours that have not happened yet, so the end is
    // cut at the present.
    AppUsage::ranking(db, from, to.min(time::now_seconds()), limit)
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
    fn the_window_is_cut_at_the_present() {
        let db = created();
        let now = time::now_seconds();
        let next_hour = AppUsage::hour_of(now) + crate::models::app_event::HOUR_SECONDS;
        AppUsage::record(&db, "code", next_hour, 600).expect("recorded");

        let usage = usage(&db, now - 3_600, next_hour + 3_600, 10).expect("ranking");

        // Without the cut the bucket of the hour still to come would be answered as usage.
        assert!(usage.is_empty(), "{usage:?}");
    }

    #[test]
    fn an_empty_window_is_refused() {
        let db = created();

        let error = usage(&db, 100, 100, 10).expect_err("empty window");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
