//! Migration commands: whether this start found a database to run on.

use tauri::{AppHandle, State};

use crate::db::upgrade::{Migration, Stranded};
use crate::utils::response::ApiResponse;

/// Answers what stopped this build from opening a database, or `null` when it opened one.
///
/// A copy that failed changes nothing — the configuration still points at the previous build's
/// file, which was never touched — so all the interface can do is say so and offer the way back to
/// that build.
#[tauri::command]
pub fn get_stranded(migration: State<'_, Migration>) -> ApiResponse<Option<Stranded>> {
    ApiResponse::ok(migration.stranded_reason().cloned())
}

/// Ends the process, which is the whole of rolling back.
///
/// The configuration still names the previous build's file, so that build picks up exactly where it
/// left off once this one is out of the way.
#[tauri::command]
pub fn roll_back(app: AppHandle) {
    app.exit(0);
}
