//! Event bus forwarding collector and timer events to the frontend.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::models::alarm::Alarm;
use crate::models::app_event::AppEvent;
use crate::models::pomodoro::PomodoroSession;
use crate::services::notification::NotificationKind;
use crate::utils::response::{ApiError, ApiResult};

/// Event names the backend pushes to the frontend; each one is documented in `docs/events.md`.
pub mod names {
    /// Pushed by `emit_test_event` so the wiring can be verified end to end.
    pub const TEST_EVENT: &str = "test-event";
    /// Pushed when the system refused a toast, so the frontend paints one itself.
    pub const NOTIFICATION_FALLBACK: &str = "notification-fallback";
    /// Pushed when another application takes the foreground, carrying the row that just opened.
    pub const APP_SWITCH: &str = "app-switch";
    /// Pushed when a pomodoro session is closed, carrying the stored row.
    pub const POMODORO_FINISHED: &str = "pomodoro-finished";
    /// Pushed when an alarm goes off, carrying the row it belongs to.
    pub const ALARM_TRIGGERED: &str = "alarm-triggered";
    /// Pushed after a task mutation or cycle reset; the list and counts should reload.
    pub const TODOS_CHANGED: &str = "todos-changed";
    /// Pushed when the tray's "start Pomodoro" entry is clicked, with no payload.
    pub const TRAY_START_POMODORO: &str = "tray-start-pomodoro";
}

/// Payload of [`names::TEST_EVENT`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEvent {
    /// Rises with every push, so the UI can tell two of them apart.
    pub sequence: u64,
}

/// Payload of [`names::NOTIFICATION_FALLBACK`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationFallback {
    /// What the missed notification was about; the toast picks its copy from this.
    pub kind: NotificationKind,
    /// Platform message describing why the toast was refused.
    pub reason: String,
}

/// What the bus pushes to: the Tauri handle in the application, a recorder in tests.
pub trait EventSink: Send + Sync + 'static {
    /// Hands one payload to the frontend; fails when it cannot be handed over.
    fn emit(&self, event: &str, payload: serde_json::Value) -> ApiResult<()>;
}

impl EventSink for AppHandle {
    fn emit(&self, event: &str, payload: serde_json::Value) -> ApiResult<()> {
        Emitter::emit(self, event, payload).map_err(|error| {
            ApiError::internal(format!(
                "event `{event}` could not be pushed to the frontend"
            ))
            .with_details(error.to_string())
        })
    }
}

/// Test double shared by the bus, collector and command tests.
#[cfg(test)]
pub(crate) mod testing {
    use std::sync::{Arc, Mutex};

    use crate::services::event_bus::EventSink;
    use crate::utils::response::ApiResult;

    /// Keeps everything pushed through the bus, so a test can read it back.
    #[derive(Clone, Default)]
    pub struct Recorder {
        pushed: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    }

    impl Recorder {
        /// Every push so far, in order.
        #[must_use]
        pub fn pushed(&self) -> Vec<(String, serde_json::Value)> {
            self.pushed
                .lock()
                .expect("the recorder lock is not poisoned")
                .clone()
        }
    }

    impl EventSink for Recorder {
        fn emit(&self, event: &str, payload: serde_json::Value) -> ApiResult<()> {
            self.pushed
                .lock()
                .expect("the recorder lock is not poisoned")
                .push((event.to_owned(), payload));

            Ok(())
        }
    }
}

/// Pushes typed events to the frontend; share it through Tauri managed state.
///
/// Cloning hands out another handle to the same sink and counter, so the collector thread and the
/// command layer push through one bus instead of each keeping its own.
#[derive(Clone)]
pub struct EventBus {
    sink: Arc<dyn EventSink>,
    sequence: Arc<AtomicU64>,
}

impl EventBus {
    /// Pushes [`names::TODOS_CHANGED`] after the task changes are committed.
    pub fn emit_todos_changed(&self) -> ApiResult<()> {
        self.sink
            .emit(names::TODOS_CHANGED, serde_json::Value::Null)
    }

    /// Builds a bus that pushes through `sink`.
    #[must_use]
    pub fn new(sink: impl EventSink) -> Self {
        Self {
            sink: Arc::new(sink),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Pushes [`names::TEST_EVENT`] and answers with what was sent; fails when it cannot be sent.
    pub fn emit_test_event(&self) -> ApiResult<TestEvent> {
        let payload = TestEvent {
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed) + 1,
        };

        self.sink
            .emit(names::TEST_EVENT, serde_json::to_value(payload)?)?;

        Ok(payload)
    }

    /// Pushes [`names::NOTIFICATION_FALLBACK`] when a toast could not be shown.
    pub fn emit_notification_fallback(&self, fallback: NotificationFallback) -> ApiResult<()> {
        self.sink.emit(
            names::NOTIFICATION_FALLBACK,
            serde_json::to_value(fallback)?,
        )
    }

    /// Pushes [`names::APP_SWITCH`] with the row the collector just opened.
    ///
    /// A title change inside the same app updates its row without pushing: one push is one switch.
    pub fn emit_app_switch(&self, event: &AppEvent) -> ApiResult<()> {
        self.sink
            .emit(names::APP_SWITCH, serde_json::to_value(event)?)
    }

    /// Pushes [`names::POMODORO_FINISHED`] with the session that was just closed.
    pub fn emit_pomodoro_finished(&self, session: &PomodoroSession) -> ApiResult<()> {
        self.sink
            .emit(names::POMODORO_FINISHED, serde_json::to_value(session)?)
    }

    /// Pushes [`names::ALARM_TRIGGERED`] with the alarm that just went off.
    pub fn emit_alarm_triggered(&self, alarm: &Alarm) -> ApiResult<()> {
        self.sink
            .emit(names::ALARM_TRIGGERED, serde_json::to_value(alarm)?)
    }

    /// Pushes [`names::TRAY_START_POMODORO`], which carries nothing: the frontend owns the timer.
    pub fn emit_tray_start_pomodoro(&self) -> ApiResult<()> {
        self.sink
            .emit(names::TRAY_START_POMODORO, serde_json::Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::Recorder;
    use super::*;
    use crate::utils::response::ApiCode;

    struct RefusingSink;

    impl EventSink for RefusingSink {
        fn emit(&self, event: &str, _payload: serde_json::Value) -> ApiResult<()> {
            Err(ApiError::internal(format!("`{event}` was refused")))
        }
    }

    #[test]
    fn a_test_event_reaches_the_sink_with_a_rising_sequence() {
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());

        let first = bus.emit_test_event().expect("the first event is pushed");
        let second = bus.emit_test_event().expect("the second event is pushed");

        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);

        let pushed = recorder.pushed();
        assert_eq!(pushed.len(), 2);
        assert_eq!(pushed[0].0, names::TEST_EVENT);
        assert_eq!(pushed[0].1["sequence"], serde_json::json!(1));
        assert_eq!(pushed[1].1["sequence"], serde_json::json!(2));
    }

    #[test]
    fn a_refusing_sink_surfaces_as_an_error() {
        let bus = EventBus::new(RefusingSink);

        let error = bus.emit_test_event().expect_err("the push fails");

        assert_eq!(error.code(), ApiCode::Internal);
        assert!(
            error.message().contains(names::TEST_EVENT),
            "the message names the event: {error:?}"
        );
    }

    #[test]
    fn a_clone_pushes_through_the_same_sink_and_counter() {
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());
        let clone = bus.clone();

        assert_eq!(bus.emit_test_event().expect("first").sequence, 1);
        assert_eq!(clone.emit_test_event().expect("second").sequence, 2);
        assert_eq!(recorder.pushed().len(), 2);
    }

    #[test]
    fn an_app_switch_carries_the_row_that_just_opened() {
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());

        bus.emit_app_switch(&AppEvent {
            id: 7,
            app_name: "code".to_owned(),
            window_title: Some("main.rs".to_owned()),
            started_at: 1_700_000_000,
            ended_at: None,
        })
        .expect("pushed");

        let pushed = recorder.pushed();
        assert_eq!(pushed[0].0, names::APP_SWITCH);
        assert_eq!(pushed[0].1["id"], serde_json::json!(7));
        assert_eq!(pushed[0].1["appName"], serde_json::json!("code"));
        assert_eq!(pushed[0].1["windowTitle"], serde_json::json!("main.rs"));
        assert_eq!(pushed[0].1["endedAt"], serde_json::json!(null));
    }

    #[test]
    fn a_tray_click_pushes_an_empty_start() {
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());

        bus.emit_tray_start_pomodoro().expect("pushed");

        let pushed = recorder.pushed();
        assert_eq!(pushed.len(), 1);
        assert_eq!(pushed[0].0, names::TRAY_START_POMODORO);
        assert!(pushed[0].1.is_null(), "the click carries no payload");
    }

    #[test]
    fn a_triggered_alarm_carries_its_row() {
        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());

        bus.emit_alarm_triggered(&Alarm {
            id: 5,
            label: "stand up".to_owned(),
            hour: 9,
            minute: 30,
            repeat_days: 0b0001_1111,
            enabled: true,
            created_at: 1_700_000_000,
        })
        .expect("pushed");

        let pushed = recorder.pushed();
        assert_eq!(pushed[0].0, names::ALARM_TRIGGERED);
        assert_eq!(pushed[0].1["id"], serde_json::json!(5));
        assert_eq!(pushed[0].1["label"], serde_json::json!("stand up"));
        assert_eq!(pushed[0].1["hour"], serde_json::json!(9));
        assert_eq!(pushed[0].1["minute"], serde_json::json!(30));
        assert_eq!(pushed[0].1["repeatDays"], serde_json::json!(31));
    }

    #[test]
    fn a_finished_pomodoro_carries_its_session() {
        use crate::models::pomodoro::Phase;

        let recorder = Recorder::default();
        let bus = EventBus::new(recorder.clone());

        bus.emit_pomodoro_finished(&PomodoroSession {
            id: 3,
            phase: Phase::Focus,
            planned_seconds: 1_500,
            actual_seconds: Some(1_500),
            started_at: 1_700_000_000,
            ended_at: Some(1_700_001_500),
            todo_id: None,
        })
        .expect("pushed");

        let pushed = recorder.pushed();
        assert_eq!(pushed[0].0, names::POMODORO_FINISHED);
        assert_eq!(pushed[0].1["phase"], serde_json::json!("focus"));
        assert_eq!(pushed[0].1["actualSeconds"], serde_json::json!(1_500));
    }
}
