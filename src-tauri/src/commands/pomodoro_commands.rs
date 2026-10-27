//! Pomodoro commands: starting, stopping and reporting the focus clock.
//!
//! Nothing here writes a session row — the stretch lives in [`FocusTicker`] and only its seconds
//! reach `focus_usage_hours`, filed under the category the stretch was started with.

use tauri::State;

use crate::collectors::focus_tick::FocusTicker;
use crate::db::connection::Db;
use crate::models::focus_usage::{FocusCategory, FocusFile, FocusUsage};
use crate::models::pomodoro::{Phase, Running};
use crate::services::event_bus::EventBus;
use crate::utils::response::{ApiResponse, ApiResult};

/// Starts a stretch, stopping the one already running.
///
/// The category is what the stretch's seconds are filed under. It is optional so a window that
/// knows nothing of categories keeps starting stretches; nothing means the work nobody named.
#[tauri::command]
pub fn start_pomodoro_session(
    ticker: State<'_, FocusTicker>,
    phase: Phase,
    planned_seconds: i64,
    category: Option<String>,
) -> ApiResponse<Running> {
    FocusFile::parse(category.as_deref())
        .and_then(|file| ticker.start(phase, planned_seconds, file))
        .into()
}

/// How much of `[from, to)` each category took, busiest first.
#[tauri::command]
pub fn focus_categories(db: State<'_, Db>, from: i64, to: i64) -> ApiResponse<Vec<FocusCategory>> {
    FocusUsage::categories(&db, from, to).into()
}

/// Stops the running stretch, writing the seconds it spent since the last tick.
///
/// A pause and a rest end the same way: the stretch stops, so the minute tick stops counting it,
/// and resuming starts a new one. The stretch that ended is pushed, so another window can tell
/// the phase is over without asking.
#[tauri::command]
pub fn stop_pomodoro_session(
    ticker: State<'_, FocusTicker>,
    bus: State<'_, EventBus>,
) -> ApiResponse<()> {
    stop(&ticker, &bus).into()
}

/// Stops the stretch and pushes it; nothing running pushes nothing.
fn stop(ticker: &FocusTicker, bus: &EventBus) -> ApiResult<()> {
    if let Some(stretch) = ticker.stop()? {
        bus.emit_pomodoro_finished(&stretch)?;
    }

    Ok(())
}

/// Answers the stretch still running, so a window that reloads resumes the same clock.
#[tauri::command]
pub fn get_running_pomodoro_session(
    ticker: State<'_, FocusTicker>,
) -> ApiResponse<Option<Running>> {
    ApiResponse::from(Ok(ticker.running()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::Db;
    use crate::db::schema;
    use crate::services::event_bus::names;
    use crate::services::event_bus::testing::Recorder;
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn a_started_stretch_is_answered_until_it_is_stopped() {
        let db = created();
        let ticker =
            FocusTicker::spawn(db, EventBus::new(Recorder::default())).expect("the tick starts");

        assert!(ticker.running().is_none());

        let started = ticker
            .start(Phase::Focus, 1_500, FocusFile::default())
            .expect("started");
        assert_eq!(ticker.running(), Some(started));

        ticker.stop().expect("stopped");
        assert!(ticker.running().is_none());

        ticker.shutdown();
    }

    #[test]
    fn a_length_no_phase_could_have_is_refused() {
        let db = created();
        let ticker =
            FocusTicker::spawn(db, EventBus::new(Recorder::default())).expect("the tick starts");

        let error = ticker
            .start(Phase::Focus, 0, FocusFile::default())
            .expect_err("a zero length phase is refused");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        ticker.shutdown();
    }

    #[test]
    fn stopping_a_stretch_pushes_what_was_running() {
        let db = created();
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());
        let ticker = FocusTicker::spawn(db, bus.clone()).expect("the tick starts");

        ticker
            .start(Phase::LongBreak, 900, FocusFile::new().under("reading"))
            .expect("started");
        stop(&ticker, &bus).expect("stopped");

        let pushed = recorder.pushed();
        assert_eq!(pushed.len(), 1);
        assert_eq!(pushed[0].0, names::POMODORO_FINISHED);
        assert_eq!(pushed[0].1["phase"], serde_json::json!("longBreak"));
        assert_eq!(pushed[0].1["category"], serde_json::json!("reading"));

        // Nothing running means nothing to tell the other windows about.
        stop(&ticker, &bus).expect("stopped again");
        assert_eq!(recorder.pushed().len(), 1);

        ticker.shutdown();
    }

    #[test]
    fn a_stretch_started_without_a_category_files_under_the_unnamed_work() {
        let db = created();
        let ticker =
            FocusTicker::spawn(db, EventBus::new(Recorder::default())).expect("the tick starts");

        let started = ticker
            .start(Phase::Focus, 1_500, FocusFile::default())
            .expect("started");

        assert_eq!(started.category, "");
        ticker.shutdown();
    }
}
