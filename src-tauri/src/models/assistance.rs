//! Reviewable AI proposals. Business data and its confirmation log commit together.

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::{connection::Db, repository};
use crate::models::{
    tag::Tag,
    todo::{self, Todo},
};
use crate::utils::response::{ApiCode, ApiError, ApiResult};
use crate::utils::time;

const COLUMNS: &str = "id, reason, action, revision, created_at";
pub const MAX_PROPOSALS: usize = 6;

/// This allow-list is the model's entire vocabulary; it has no command or SQL access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AiAction {
    CreateTodo {
        title: String,
    },
    CompleteTodo {
        todo_id: i64,
    },
    SetTodoTags {
        todo_id: i64,
        tag_ids: Vec<i64>,
    },
    RenameTag {
        tag_id: i64,
        name: String,
    },
    CreateAlarm {
        label: String,
        hour: i64,
        minute: i64,
    },
}

impl AiAction {
    pub(crate) fn normalize(mut self) -> ApiResult<Self> {
        match &mut self {
            Self::CreateTodo { title } => *title = text(title, 500)?,
            Self::CompleteTodo { todo_id } => positive(*todo_id)?,
            Self::SetTodoTags { todo_id, tag_ids } => {
                positive(*todo_id)?;
                if tag_ids.len() > 100 {
                    return Err(ApiError::invalid_input("too many tags"));
                }
                for id in tag_ids.iter() {
                    positive(*id)?;
                }
                tag_ids.sort_unstable();
                tag_ids.dedup();
            }
            Self::RenameTag { tag_id, name } => {
                positive(*tag_id)?;
                *name = text(name, 100)?;
            }
            Self::CreateAlarm {
                label,
                hour,
                minute,
            } => {
                *label = label.trim().to_owned();
                if label.chars().count() > 60
                    || !(0..=23).contains(hour)
                    || !(0..=59).contains(minute)
                {
                    return Err(ApiError::invalid_input("invalid alarm fields"));
                }
            }
        }
        Ok(self)
    }

    /// Compare actual values as well as timestamps to catch edits in the same second.
    fn snapshot(&self, connection: &Connection) -> ApiResult<Value> {
        self.snapshot_with(
            |id| todo_snapshot(connection, id),
            |id| tag_snapshot(connection, id),
        )
    }

    /// Retain the inference context: tasks may change while the model is still thinking.
    pub(crate) fn context_snapshot(&self, todos: &[Todo], tags: &[Tag]) -> ApiResult<Value> {
        self.snapshot_with(
            |id| {
                serde_json::to_value(
                    todos.iter().find(|todo| todo.id == id).ok_or_else(|| {
                        ApiError::invalid_input("task was not in the model context")
                    })?,
                )
                .map_err(ApiError::from)
            },
            |id| {
                serde_json::to_value(
                    tags.iter().find(|tag| tag.id == id).ok_or_else(|| {
                        ApiError::invalid_input("tag was not in the model context")
                    })?,
                )
                .map_err(ApiError::from)
            },
        )
    }

    fn snapshot_with(
        &self,
        todo: impl Fn(i64) -> ApiResult<Value>,
        tag: impl Fn(i64) -> ApiResult<Value>,
    ) -> ApiResult<Value> {
        match self {
            Self::CreateTodo { .. } | Self::CreateAlarm { .. } => Ok(Value::Null),
            Self::CompleteTodo { todo_id } => {
                let value = todo(*todo_id)?;
                if value["completed"] == true {
                    return Err(conflict("the task is already complete"));
                }
                Ok(value)
            }
            Self::SetTodoTags { todo_id, tag_ids } => {
                let todo = todo(*todo_id)?;
                let tags = tag_ids
                    .iter()
                    .map(|id| tag(*id))
                    .collect::<ApiResult<Vec<_>>>()?;
                Ok(json!({ "todo": todo, "tags": tags }))
            }
            Self::RenameTag { tag_id, .. } => tag(*tag_id),
        }
    }

    fn apply(&self, tx: &Transaction<'_>, now: i64) -> ApiResult<i64> {
        match self {
            Self::CreateTodo { title } => {
                tx.execute(
                    "INSERT INTO todos (title, created_at, updated_at) VALUES (?1, ?2, ?2)",
                    params![title, now],
                )?;
                Ok(tx.last_insert_rowid())
            }
            Self::CompleteTodo { todo_id } => {
                tx.execute("UPDATE todos SET completed = 1, completed_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, todo_id])?;
                Ok(*todo_id)
            }
            Self::SetTodoTags { todo_id, tag_ids } => {
                tx.execute(
                    "UPDATE todos SET tag_ids = ?1, updated_at = ?2 WHERE id = ?3",
                    params![serde_json::to_string(tag_ids)?, now, todo_id],
                )?;
                tx.execute("DELETE FROM todo_tags WHERE todo_id = ?1", [todo_id])?;
                for id in tag_ids {
                    tx.execute(
                        "INSERT INTO todo_tags (todo_id, tag_id) VALUES (?1, ?2)",
                        params![todo_id, id],
                    )?;
                }
                Ok(*todo_id)
            }
            Self::RenameTag { tag_id, name } => {
                let taken: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tags WHERE name = ?1 AND id <> ?2)",
                    params![name, tag_id],
                    |row| row.get(0),
                )?;
                if taken {
                    return Err(conflict("the tag name is already in use"));
                }
                tx.execute(
                    "UPDATE tags SET name = ?1 WHERE id = ?2",
                    params![name, tag_id],
                )?;
                Ok(*tag_id)
            }
            Self::CreateAlarm {
                label,
                hour,
                minute,
            } => {
                tx.execute("INSERT INTO alarms (label, hour, minute, repeat_days, created_at) VALUES (?1, ?2, ?3, 0, ?4)", params![label, hour, minute, now])?;
                Ok(tx.last_insert_rowid())
            }
        }
    }
}

fn text(value: &str, max: usize) -> ApiResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(ApiError::invalid_input("text is empty or too long"));
    }
    Ok(value.to_owned())
}

fn positive(id: i64) -> ApiResult<()> {
    if id <= 0 {
        return Err(ApiError::invalid_input("id must be positive"));
    }
    Ok(())
}

fn conflict(message: &str) -> ApiError {
    ApiError::new(ApiCode::Conflict).with_message(message)
}

fn todo_snapshot(connection: &Connection, id: i64) -> ApiResult<Value> {
    let mut statement = connection.prepare(&format!(
        "SELECT {} FROM {} WHERE todos.id = ?1",
        todo::COLUMNS,
        todo::SOURCE
    ))?;
    let mut rows = statement.query([id])?;
    let row = rows
        .next()?
        .ok_or_else(|| ApiError::not_found("task no longer exists"))?;
    Ok(serde_json::to_value(Todo::from_row(row)?)?)
}

fn tag_snapshot(connection: &Connection, id: i64) -> ApiResult<Value> {
    connection.query_row("SELECT name, created_at FROM tags WHERE id = ?1", [id], |row| {
        Ok(json!({ "id": id, "name": row.get::<_, String>(0)?, "createdAt": row.get::<_, i64>(1)? }))
    }).optional()?.ok_or_else(|| ApiError::not_found("tag no longer exists"))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub reason: String,
    pub action: AiAction,
    #[serde(skip)]
    pub expected_state: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: i64,
    pub reason: String,
    pub action: AiAction,
    pub revision: i64,
    pub created_at: i64,
}

impl Suggestion {
    fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            reason: row.get(1)?,
            action: serde_json::from_str(&row.get::<_, String>(2)?)?,
            revision: row.get(3)?,
            created_at: row.get(4)?,
        })
    }

    pub fn pending(db: &Db) -> ApiResult<Vec<Self>> {
        repository::query_all(
            db,
            &format!(
                "SELECT {COLUMNS} FROM ai_suggestions WHERE status = 'pending' ORDER BY id DESC"
            ),
            [],
            Self::from_row,
        )
    }

    /// Only writes proposals and audit rows; never modifies business data.
    pub fn propose(db: &Db, proposals: Vec<Proposal>) -> ApiResult<Vec<Self>> {
        if proposals.len() > MAX_PROPOSALS {
            return Err(ApiError::invalid_input("too many proposals"));
        }
        repository::transaction(db, |tx| {
            let count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM ai_suggestions WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )?;
            if count + proposals.len() as i64 > 100 {
                return Err(conflict("review existing proposals first"));
            }
            let now = time::now_seconds();
            let mut stored = Vec::new();
            for proposal in proposals {
                let reason = text(&proposal.reason, 2000)?;
                let action = proposal.action.normalize()?;
                let snapshot = action.snapshot(tx)?;
                if proposal
                    .expected_state
                    .as_ref()
                    .is_some_and(|expected| *expected != snapshot)
                {
                    return Err(conflict("data changed during inference; generate again"));
                }
                tx.execute("INSERT INTO ai_suggestions (reason, action, expected_state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![reason, serde_json::to_string(&action)?, snapshot.to_string(), now])?;
                let id = tx.last_insert_rowid();
                log(tx, id, "proposed", &reason, &action, None, now)?;
                stored.push(Self {
                    id,
                    reason,
                    action,
                    revision: 1,
                    created_at: now,
                });
            }
            Ok(stored)
        })
    }

    /// An edit only revises the preview; a separate confirmation remains mandatory.
    pub fn edit(db: &Db, id: i64, revision: i64, action: AiAction) -> ApiResult<()> {
        let action = action.normalize()?;
        repository::transaction(db, |tx| {
            let (reason, _) = reviewable(tx, id, revision)?;
            let snapshot = action.snapshot(tx)?;
            let now = time::now_seconds();
            tx.execute("UPDATE ai_suggestions SET action = ?1, expected_state = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?4", params![serde_json::to_string(&action)?, snapshot.to_string(), now, id])?;
            log(tx, id, "edited", &reason, &action, None, now)
        })
    }

    /// Read the reviewed action from storage; this endpoint cannot receive an unseen payload.
    pub fn confirm(db: &Db, id: i64, revision: i64, confirmed: bool) -> ApiResult<()> {
        if !confirmed {
            return Err(ApiError::invalid_input("explicit confirmation is required"));
        }
        repository::immediate_transaction(db, |tx| {
            let now = time::now_seconds();
            todo::advance_recurring_in(tx, now)?;
            let (reason, action) = reviewable(tx, id, revision)?;
            let expected: String = tx.query_row(
                "SELECT expected_state FROM ai_suggestions WHERE id = ?1",
                [id],
                |row| row.get(0),
            )?;
            if action.snapshot(tx)? != serde_json::from_str::<Value>(&expected)? {
                return Err(conflict(
                    "the target changed; edit and review the proposal again",
                ));
            }
            let result = action.apply(tx, now)?;
            tx.execute(
                "UPDATE ai_suggestions SET status = 'accepted', updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            log(tx, id, "confirmed", &reason, &action, Some(result), now)
        })
    }

    pub fn reject(db: &Db, id: i64, revision: i64) -> ApiResult<()> {
        repository::transaction(db, |tx| {
            let (reason, action) = reviewable(tx, id, revision)?;
            let now = time::now_seconds();
            tx.execute(
                "UPDATE ai_suggestions SET status = 'rejected', updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            log(tx, id, "rejected", &reason, &action, None, now)
        })
    }
}

fn reviewable(tx: &Transaction<'_>, id: i64, revision: i64) -> ApiResult<(String, AiAction)> {
    positive(id)?;
    let row: Option<(String, String, String, i64)> = tx
        .query_row(
            "SELECT reason, action, status, revision FROM ai_suggestions WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let (reason, action, status, current) =
        row.ok_or_else(|| ApiError::not_found("unknown suggestion"))?;
    if status != "pending" || revision != current {
        return Err(conflict("suggestion was already reviewed or edited"));
    }
    Ok((reason, serde_json::from_str(&action)?))
}

fn log(
    tx: &Transaction<'_>,
    id: i64,
    event: &str,
    reason: &str,
    action: &AiAction,
    result: Option<i64>,
    now: i64,
) -> ApiResult<()> {
    tx.execute("INSERT INTO ai_operation_log (suggestion_id, event, reason, action, result_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![id, event, reason, serde_json::to_string(action)?, result, now])?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLog {
    pub id: i64,
    pub suggestion_id: i64,
    pub event: String,
    pub reason: String,
    pub action: AiAction,
    pub result_id: Option<i64>,
    pub created_at: i64,
}

impl OperationLog {
    pub fn list(db: &Db, before: Option<i64>) -> ApiResult<Vec<Self>> {
        if let Some(id) = before {
            positive(id)?;
        }
        repository::query_all(db, "SELECT id, suggestion_id, event, reason, action, result_id, created_at FROM ai_operation_log WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT 50", [before], |row| {
            Ok(Self { id: row.get(0)?, suggestion_id: row.get(1)?, event: row.get(2)?, reason: row.get(3)?, action: serde_json::from_str(&row.get::<_, String>(4)?)?, result_id: row.get(5)?, created_at: row.get(6)? })
        })
    }

    pub fn clear(db: &Db) -> ApiResult<()> {
        repository::transaction(db, |tx| {
            tx.execute("DELETE FROM ai_operation_log", [])?;
            tx.execute("DELETE FROM ai_suggestions WHERE status <> 'pending'", [])?;
            Ok(())
        })
    }
}

#[cfg(test)]
#[path = "assistance_tests.rs"]
mod tests;
