//! Todo CRUD commands.

use tauri::State;

use crate::db::connection::Db;
use crate::models::todo::{CompletionScope, TaskCompletion, Todo, TodoCounts};
use crate::utils::response::ApiResponse;
use crate::utils::time;

/// Lists tasks, open ones first; `completed` narrows the result.
#[tauri::command]
pub fn list_todos(db: State<'_, Db>, completed: Option<bool>) -> ApiResponse<Vec<Todo>> {
    Todo::list(&db, completed).into()
}

/// Creates a task from a title and optional planning moments.
#[tauri::command]
pub fn add_todo(
    db: State<'_, Db>,
    title: String,
    start_at: Option<i64>,
    end_at: Option<i64>,
) -> ApiResponse<Todo> {
    Todo::add(&db, &title, start_at, end_at).into()
}

/// Renames a task.
#[tauri::command]
pub fn rename_todo(db: State<'_, Db>, id: i64, title: String) -> ApiResponse<Todo> {
    Todo::rename(&db, id, &title).into()
}

/// Sets or clears when a task is planned to start.
#[tauri::command]
pub fn set_todo_start_at(db: State<'_, Db>, id: i64, start_at: Option<i64>) -> ApiResponse<Todo> {
    Todo::set_start_at(&db, id, start_at).into()
}

/// Sets or clears when a task is planned to end.
#[tauri::command]
pub fn set_todo_end_at(db: State<'_, Db>, id: i64, end_at: Option<i64>) -> ApiResponse<Todo> {
    Todo::set_end_at(&db, id, end_at).into()
}

/// Sets the completion flag of a task.
#[tauri::command]
pub fn set_todo_completed(db: State<'_, Db>, id: i64, completed: bool) -> ApiResponse<Todo> {
    Todo::set_completed(&db, id, completed).into()
}

/// Deletes a task.
#[tauri::command]
pub fn delete_todo(db: State<'_, Db>, id: i64) -> ApiResponse<()> {
    Todo::delete(&db, id).into()
}

/// Counts every task and how many are still open.
#[tauri::command]
pub fn todo_counts(db: State<'_, Db>) -> ApiResponse<TodoCounts> {
    TodoCounts::load(&db).into()
}

/// Counts the tasks of `scope` and how many of them are completed.
#[tauri::command]
pub fn completion_rate(db: State<'_, Db>, scope: CompletionScope) -> ApiResponse<TaskCompletion> {
    TaskCompletion::load(&db, scope, time::now_seconds()).into()
}
