//! Todo CRUD commands.

use tauri::State;

use crate::db::connection::Db;
use crate::models::recurrence::Recurrence;
use crate::models::todo::{CompletionScope, TaskCompletion, Todo, TodoCounts, TodoSort};
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
    sort: Option<TodoSort>,
) -> ApiResponse<Vec<Todo>> {
    refresh_todos(&db, &bus, time::now_seconds())
        .and_then(|_| Todo::list_sorted(&db, completed, sort.unwrap_or_default()))
        .into()
}

/// Creates a task with an optional calendar due date (UTC midnight epoch seconds).
#[tauri::command]
pub fn add_todo(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    title: String,
    recurrence: Option<Recurrence>,
    due_date: Option<i64>,
) -> ApiResponse<Todo> {
    changed(
        Todo::add_with_options(&db, &title, recurrence, due_date),
        &bus,
    )
}

/// Updates title and deadline while keeping recurrence, completion and tags.
#[tauri::command]
pub fn update_todo(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    id: i64,
    title: String,
    due_date: Option<i64>,
) -> ApiResponse<Todo> {
    changed(Todo::update(&db, id, &title, due_date), &bus)
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

/// Changes only the date, keeping all other task fields.
#[tauri::command]
pub fn set_todo_due_date(
    db: State<'_, Db>,
    bus: State<'_, EventBus>,
    id: i64,
    due_date: Option<i64>,
) -> ApiResponse<Todo> {
    changed(Todo::set_due_date(&db, id, due_date), &bus)
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
