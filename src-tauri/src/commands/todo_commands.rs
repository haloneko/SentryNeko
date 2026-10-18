//! Todo CRUD commands.

use tauri::State;

use crate::db::connection::Db;
use crate::models::recurrence::Recurrence;
use crate::models::todo::{CompletionScope, TaskCompletion, Todo, TodoCounts};
use crate::services::event_bus::EventBus;
use crate::services::scheduler::refresh_todos;
use crate::utils::response::{ApiResponse, ApiResult};
use crate::utils::time;

/// Lists tasks, open ones first; `completed` narrows the result.
#[tauri::command]
pub fn list_todos(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    completed: Option<bool>,
) -> ApiResponse<Vec<Todo>> {
    refresh_todos(&db, &bus, time::now_seconds())
        .and_then(|_| Todo::list(&db, completed))
        .into()
}

/// Creates a task from a title.
#[tauri::command]
pub fn add_todo(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    title: String,
    recurrence: Option<Recurrence>,
) -> ApiResponse<Todo> {
    changed(Todo::add_with_recurrence(&db, &title, recurrence), &bus)
}

/// Renames a task.
#[tauri::command]
pub fn rename_todo(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    id: i64,
    title: String,
) -> ApiResponse<Todo> {
    changed(Todo::rename(&db, id, &title), &bus)
}

/// Sets the completion flag of a task.
#[tauri::command]
pub fn set_todo_completed(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    id: i64,
    completed: bool,
) -> ApiResponse<Todo> {
    changed(Todo::set_completed(&db, id, completed), &bus)
}

/// Deletes a task.
#[tauri::command]
pub fn delete_todo(db: State<'_, Db>, bus: State<'_, EventBus>, id: i64) -> ApiResponse<()> {
    changed(Todo::delete(&db, id), &bus)
}

fn changed<T>(result: ApiResult<T>, bus: &EventBus) -> ApiResponse<T> {
    if result.is_ok() {
        let _ = bus.emit_todos_changed();
    }
    result.into()
}

/// Counts every task and how many are still open.
#[tauri::command]
pub fn todo_counts(db: State<'_, Db>, bus: State<'_, EventBus>) -> ApiResponse<TodoCounts> {
    refresh_todos(&db, &bus, time::now_seconds())
        .and_then(|_| TodoCounts::load(&db))
        .into()
}

/// Counts the tasks of `scope` and how many of them are completed.
#[tauri::command]
pub fn completion_rate(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    scope: CompletionScope,
) -> ApiResponse<TaskCompletion> {
    let now = time::now_seconds();
    refresh_todos(&db, &bus, now)
        .and_then(|_| TaskCompletion::load(&db, scope, now))
        .into()
}
