//! Todo CRUD commands.

use serde_json::{Map, Value};
use tauri::State;

use crate::db::connection::Db;
use crate::models::todo::{Todo, TodoCompletions, TodoCounts};
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

/// Pins a task to the top of its group, or unpins it.
#[tauri::command]
pub fn set_todo_starred(db: State<'_, Db>, id: i64, starred: bool) -> ApiResponse<Todo> {
    Todo::set_starred(&db, id, starred).into()
}

/// Merges attributes into a task's extension bag; a `null` value removes the key it names.
#[tauri::command]
pub fn set_todo_extra(
    db: State<'_, Db>,
    id: i64,
    patch: Map<String, Value>,
) -> ApiResponse<Todo> {
    Todo::set_extra(&db, id, &patch).into()
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

/// Counts the tasks finished today and in total.
#[tauri::command]
pub fn todo_completions(db: State<'_, Db>) -> ApiResponse<TodoCompletions> {
    TodoCompletions::load(&db, time::now_seconds()).into()
}
