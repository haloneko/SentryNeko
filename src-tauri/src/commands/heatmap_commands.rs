//! Heatmap commands: focus time and completed tasks per bucket.

use tauri::State;

use crate::db::connection::Db;
use crate::models::focus_usage::{FocusCategoryHour, FocusUsage};
use crate::models::heatmap::{Granularity, HeatmapBucket};
use crate::utils::response::ApiResponse;

/// Aggregates focus time and completed tasks per local day, week or month.
#[tauri::command]
pub fn heatmap(
    db: State<'_, Db>,
    from: i64,
    to: i64,
    granularity: Granularity,
) -> ApiResponse<Vec<HeatmapBucket>> {
    crate::models::heatmap::load(&db, from, to, granularity).into()
}

/// Answers the focus seconds of every hour in `[from, to)`, split by the category they were filed
/// under: the hourly chart stacks one slice per category, and the day's total is their sum.
#[tauri::command]
pub fn focus_category_hours(
    db: State<'_, Db>,
    from: i64,
    to: i64,
) -> ApiResponse<Vec<FocusCategoryHour>> {
    FocusUsage::hours_by_category(&db, from, to).into()
}
