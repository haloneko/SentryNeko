//! Heatmap commands: focus time and completed tasks per bucket.

use tauri::State;

use crate::db::connection::Db;
use crate::models::focus_usage::{FocusCategoryHour, FocusHour, FocusUsage};
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

/// Answers the focus seconds of every hour in `[from, to)`, for the hourly chart.
#[tauri::command]
pub fn focus_hours(db: State<'_, Db>, from: i64, to: i64) -> ApiResponse<Vec<FocusHour>> {
    FocusUsage::hourly(&db, from, to).into()
}

/// Answers the same hours split by the category their seconds were filed under, so the hourly
/// chart can stack one slice per category.
#[tauri::command]
pub fn focus_category_hours(
    db: State<'_, Db>,
    from: i64,
    to: i64,
) -> ApiResponse<Vec<FocusCategoryHour>> {
    FocusUsage::hours_by_category(&db, from, to).into()
}
