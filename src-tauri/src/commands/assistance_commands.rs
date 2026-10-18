//! AI proposal lifecycle; generation cannot call the confirmation endpoint.

use tauri::{Manager, State};

use crate::config::Config;
use crate::db::connection::Db;
use crate::models::assistance::{AiAction, OperationLog, Suggestion};
use crate::services::assistance::{self, AiSettings};
use crate::utils::response::{ApiError, ApiResponse};

#[tauri::command]
pub fn get_ai_settings(db: State<'_, Db>) -> ApiResponse<AiSettings> {
    AiSettings::load(&db).into()
}

#[tauri::command]
pub fn set_ai_settings(db: State<'_, Db>, settings: AiSettings) -> ApiResponse<AiSettings> {
    AiSettings::save(&db, settings).into()
}

#[tauri::command]
pub async fn generate_ai_suggestions(
    app: tauri::AppHandle,
    prompt: String,
) -> ApiResponse<Vec<Suggestion>> {
    let Some(db) = app.try_state::<Db>().map(|state| state.inner().clone()) else {
        return ApiError::internal("database is unavailable").into();
    };
    let Some(config) = app.try_state::<Config>().map(|state| state.inner().clone()) else {
        return ApiError::internal("configuration is unavailable").into();
    };
    let language = match config.language() {
        Ok(value) => value,
        Err(error) => return error.into(),
    };
    match tauri::async_runtime::spawn_blocking(move || assistance::generate(&db, language, &prompt))
        .await
    {
        Ok(result) => result.into(),
        Err(error) => ApiError::internal("inference worker failed")
            .with_details(error.to_string())
            .into(),
    }
}

#[tauri::command]
pub fn list_ai_suggestions(db: State<'_, Db>) -> ApiResponse<Vec<Suggestion>> {
    Suggestion::pending(&db).into()
}

#[tauri::command]
pub fn edit_ai_suggestion(
    db: State<'_, Db>,
    id: i64,
    revision: i64,
    action: AiAction,
) -> ApiResponse<()> {
    Suggestion::edit(&db, id, revision, action).into()
}

#[tauri::command]
pub fn confirm_ai_suggestion(
    db: State<'_, Db>,
    id: i64,
    revision: i64,
    confirmed: bool,
) -> ApiResponse<()> {
    Suggestion::confirm(&db, id, revision, confirmed).into()
}

#[tauri::command]
pub fn reject_ai_suggestion(db: State<'_, Db>, id: i64, revision: i64) -> ApiResponse<()> {
    Suggestion::reject(&db, id, revision).into()
}

#[tauri::command]
pub fn list_ai_operation_log(
    db: State<'_, Db>,
    before: Option<i64>,
) -> ApiResponse<Vec<OperationLog>> {
    OperationLog::list(&db, before).into()
}

#[tauri::command]
pub fn clear_ai_operation_log(db: State<'_, Db>) -> ApiResponse<()> {
    OperationLog::clear(&db).into()
}
