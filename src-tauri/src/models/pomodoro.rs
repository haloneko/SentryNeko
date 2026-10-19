//! Pomodoro phases and the sessions they leave behind.

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;

/// Columns every query selects, in the order [`PomodoroSession::from_row`] reads them.
const COLUMNS: &str = "id, phase, planned_seconds, actual_seconds, started_at, ended_at, todo_id";

/// Longest accepted phase length: four hours.
const MAX_SECONDS: i64 = 4 * 60 * 60;

/// The three kinds of interval a cycle walks through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

impl Phase {
    /// Every phase, in the order a cycle visits them.
    pub const ALL: [Self; 3] = [Self::Focus, Self::ShortBreak, Self::LongBreak];

    /// The value stored in `pomodoro_sessions.phase`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Focus => "focus",
            Self::ShortBreak => "short_break",
            Self::LongBreak => "long_break",
        }
    }

    /// Reads the stored value; anything else means the row was edited outside the app.
    pub fn from_stored(value: &str) -> ApiResult<Self> {
        Self::ALL
            .iter()
            .copied()
            .find(|phase| phase.as_str() == value)
            .ok_or_else(|| {
                ApiError::internal("the stored pomodoro phase is unknown").with_details(value)
            })
    }
}

/// One focus or break interval the user actually ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSession {
    pub id: i64,
    pub phase: Phase,
    pub planned_seconds: i64,
    pub actual_seconds: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub todo_id: Option<i64>,
}

impl PomodoroSession {
    /// Maps one `pomodoro_sessions` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            phase: Phase::from_stored(&row.get::<_, String>(1)?)?,
            planned_seconds: row.get(2)?,
            actual_seconds: row.get(3)?,
            started_at: row.get(4)?,
            ended_at: row.get(5)?,
            todo_id: row.get(6)?,
        })
    }

    /// Opens a session; the elapsed time is what the timestamp difference says, not a tick count.
    pub fn start(
        db: &Db,
        phase: Phase,
        planned_seconds: i64,
        todo_id: Option<i64>,
    ) -> ApiResult<Self> {
        if !(1..=MAX_SECONDS).contains(&planned_seconds) {
            return Err(ApiError::invalid_input(format!(
                "plannedSeconds must be between 1 and {MAX_SECONDS}"
            ))
            .with_details(format!("received {planned_seconds}")));
        }

        let id = repository::insert(
            db,
            "INSERT INTO pomodoro_sessions (phase, planned_seconds, started_at, todo_id)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                phase.as_str(),
                planned_seconds,
                time::now_seconds(),
                todo_id
            ],
        )?;

        Self::find(db, id)
    }

    /// Closes a session with the seconds actually spent; a missing id is `NOT_FOUND`.
    pub fn finish(db: &Db, id: i64, actual_seconds: i64) -> ApiResult<Self> {
        if !(0..=MAX_SECONDS * 2).contains(&actual_seconds) {
            return Err(ApiError::invalid_input("actualSeconds is out of range")
                .with_details(format!("received {actual_seconds}")));
        }

        let changed = repository::execute(
            db,
            "UPDATE pomodoro_sessions SET actual_seconds = ?1, ended_at = ?2 WHERE id = ?3",
            params![actual_seconds, time::now_seconds(), id],
        )?;

        if changed == 0 {
            return Err(ApiError::not_found(format!(
                "no pomodoro session with id {id}"
            )));
        }

        Self::find(db, id)
    }

    /// Returns one session; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM pomodoro_sessions WHERE id = ?1"),
            [id],
            Self::from_row,
        )
    }

    /// Lists finished and running sessions, newest first.
    pub fn list(db: &Db, limit: i64) -> ApiResult<Vec<Self>> {
        let limit = limit.clamp(1, 500);

        repository::query_all(
            db,
            &format!("SELECT {COLUMNS} FROM pomodoro_sessions ORDER BY started_at DESC, id DESC LIMIT {limit}"),
            [],
            Self::from_row,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::models::todo::Todo;
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn phases_round_trip_through_their_stored_values() {
        for phase in Phase::ALL {
            assert_eq!(
                Phase::from_stored(phase.as_str()).expect("the stored value is known"),
                phase
            );
        }

        let error = Phase::from_stored("siesta").expect_err("an unknown phase is refused");
        assert_eq!(error.code(), ApiCode::Internal);
    }

    #[test]
    fn sessions_start_open_and_close_with_the_spent_time() {
        let db = created();

        let started = PomodoroSession::start(&db, Phase::Focus, 1500, None).expect("started");
        assert_eq!(started.phase, Phase::Focus);
        assert_eq!(started.planned_seconds, 1500);
        assert_eq!(started.actual_seconds, None);
        assert_eq!(started.ended_at, None);
        assert!(started.started_at > 0);

        let finished = PomodoroSession::finish(&db, started.id, 1493).expect("finished");
        assert_eq!(finished.actual_seconds, Some(1493));
        assert!(finished.ended_at.is_some());

        assert_eq!(PomodoroSession::list(&db, 10).expect("list"), [finished]);
    }

    #[test]
    fn sessions_reject_unknown_ids_and_link_to_a_task() {
        let db = created();
        let todo = Todo::add(&db, "write the report", None, None).expect("stored");

        let linked = PomodoroSession::start(&db, Phase::ShortBreak, 300, Some(todo.id))
            .expect("started against the task");
        assert_eq!(linked.todo_id, Some(todo.id));

        let missing = PomodoroSession::finish(&db, 404, 10).expect_err("unknown session");
        assert_eq!(missing.code(), ApiCode::NotFound);

        let unknown_todo = PomodoroSession::start(&db, Phase::Focus, 1500, Some(404))
            .expect_err("the foreign key is enforced");
        assert_eq!(unknown_todo.code(), ApiCode::Database);

        let broken_plan = PomodoroSession::start(&db, Phase::Focus, 0, None)
            .expect_err("a zero length phase is refused");
        assert_eq!(broken_plan.code(), ApiCode::InvalidInput);
    }
}
