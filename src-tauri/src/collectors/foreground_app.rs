//! Foreground application collector built on GetForegroundWindow and GetWindowText.
//!
//! The loop runs on its own thread, one sample per second, and writes through
//! [`crate::models::app_event::AppEvent`]; it never touches the UI. A sample that matches the
//! row already open writes nothing, so an unchanged window is not recorded twice.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::db::connection::Db;
use crate::models::app_event::{AppEvent, AppUsage};
use crate::services::event_bus::EventBus;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;
use crate::utils::windows;

/// How often the foreground window is sampled.
///
/// Rows are stored with second resolution, so sampling faster would not add detail; a slower
/// loop would blur short switches.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// How long the user has to be away before the app in front stops counting.
///
/// Five minutes covers a phone call or a read of the printed page without charging that time to
/// whichever window happened to be open.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Longest gap one observation may charge to a bucket.
///
/// A machine that sleeps leaves the same window in front, and the loop resumes an hour later; only
/// the part that could have been watched is claimed, so a nap does not fill the hour it happened in.
const MAX_CHARGED_GAP: i64 = 60;

/// How much time may wait in memory before it is written.
///
/// The buckets are the only account of usage, so they are written sooner than a switch would force:
/// a process that dies loses at most this much instead of the whole stretch it was in the middle of.
const FLUSH_SECONDS: i64 = 30;

/// What the collector saw, already stripped of the windows it ignores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sample {
    /// Executable file name without its extension, e.g. `chrome`.
    pub app_name: String,
    /// Caption of the foreground window, trimmed; `None` when it has none.
    pub window_title: Option<String>,
}

/// How a sample relates to the row that is still open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Change {
    /// Same app, same window: nothing to write.
    Nothing,
    /// Same app, new window title: the open row is renamed.
    Retitle { id: i64 },
    /// Another app took over: the open row closes and a new one opens.
    Switch,
}

/// Seconds of one application in one hour, gathered until they are worth writing.
#[derive(Debug)]
struct Pending {
    app_name: String,
    hour_start: i64,
    seconds: i64,
}

/// Keeps exactly one `app_events` row open for the app in front of the user, and adds the time it
/// holds to the bucket of the hour it happened in.
pub struct ForegroundCollector {
    db: Db,
    bus: EventBus,
    open: Option<AppEvent>,
    /// Time seen since the last write, waiting for the bucket it belongs to.
    pending: Option<Pending>,
    /// The instant of the previous observation, so the gap is charged to the app that held it.
    last: Option<i64>,
}

impl ForegroundCollector {
    /// Builds a collector that owns no row yet.
    #[must_use]
    pub fn new(db: Db, bus: EventBus) -> Self {
        Self {
            db,
            bus,
            open: None,
            pending: None,
            last: None,
        }
    }

    /// Applies one observation taken at `now`.
    ///
    /// An unchanged window writes nothing, so polling the same switch every second cannot
    /// duplicate rows; a new app closes the open row exactly on the switch.
    pub fn observe(&mut self, sample: Option<Sample>, now: i64) -> ApiResult<()> {
        self.charge(now)?;
        self.last = Some(now);

        let Some(sample) = sample else {
            return self.close(now);
        };

        match self.change_for(&sample) {
            Change::Nothing => Ok(()),
            Change::Retitle { id } => {
                let renamed = AppEvent::retitle(&self.db, id, sample.window_title.as_deref())?;
                self.open = Some(renamed);

                Ok(())
            }
            Change::Switch => {
                self.close(now)?;
                let opened = AppEvent::open(
                    &self.db,
                    &sample.app_name,
                    sample.window_title.as_deref(),
                    now,
                )?;

                // The row is stored before the push, so a window that closed cannot lose it.
                self.open = Some(opened.clone());
                self.bus.emit_app_switch(&opened)?;

                Ok(())
            }
        }
    }

    /// Ends the open row; nothing is written when no row is open.
    pub fn close(&mut self, now: i64) -> ApiResult<()> {
        let Some(open) = self.open.take() else {
            return self.flush();
        };

        // A clock that steps backwards must not produce an end before the start.
        AppEvent::close(&self.db, open.id, now.max(open.started_at))?;

        // The stretch is over, so what it earned is written now rather than at the next flush.
        self.flush()
    }

    /// Credits the time since the previous observation to the app that was in front of it.
    fn charge(&mut self, now: i64) -> ApiResult<()> {
        let Some(last) = self.last else {
            return Ok(());
        };
        let Some(open) = &self.open else {
            return Ok(());
        };

        let gap = (now - last).clamp(0, MAX_CHARGED_GAP);

        if gap == 0 {
            return Ok(());
        }

        let app_name = open.app_name.clone();
        self.add(&app_name, last, gap)
    }

    /// Adds `seconds` to the bucket of `app_name` for the hour `from` belongs to.
    fn add(&mut self, app_name: &str, from: i64, seconds: i64) -> ApiResult<()> {
        let hour_start = AppUsage::hour_of(from);
        let same = self.pending.as_ref().is_some_and(|pending| {
            pending.app_name == app_name && pending.hour_start == hour_start
        });

        if same {
            if let Some(pending) = self.pending.as_mut() {
                pending.seconds += seconds;
            }
        } else {
            // Another hour or another app: what was gathered belongs to the bucket it was gathered
            // for, so it goes out before the next one starts.
            self.flush()?;
            self.pending = Some(Pending {
                app_name: app_name.to_owned(),
                hour_start,
                seconds,
            });
        }

        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.seconds >= FLUSH_SECONDS)
        {
            self.flush()?;
        }

        Ok(())
    }

    /// Writes the gathered seconds; nothing waits in memory after it.
    fn flush(&mut self) -> ApiResult<()> {
        let Some(pending) = self.pending.take() else {
            return Ok(());
        };

        AppUsage::record(&self.db, &pending.app_name, pending.hour_start, pending.seconds)
    }

    fn change_for(&self, sample: &Sample) -> Change {
        match &self.open {
            Some(open) if open.app_name == sample.app_name => {
                if open.window_title == sample.window_title {
                    Change::Nothing
                } else {
                    Change::Retitle { id: open.id }
                }
            }
            _ => Change::Switch,
        }
    }
}

/// Handle to the running collector.
///
/// Keep it in Tauri managed state: [`Self::stop`] closes the last row and joins the thread, so
/// quitting the app does not leave a row open forever.
pub struct RunningCollector {
    stopped: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl RunningCollector {
    /// Starts the sampling loop on a background thread.
    pub fn spawn(db: Db, bus: EventBus) -> ApiResult<Self> {
        let stopped = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stopped);
        let mut collector = ForegroundCollector::new(db, bus);

        let thread = thread::Builder::new()
            .name("foreground-collector".to_owned())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    // An app kept in front while the user is away must not accrue time.
                    let observed = if idle() { None } else { sample() };

                    // A failed write must not kill the loop: the next sample retries, otherwise
                    // one lock timeout would cost the rest of the day.
                    let _ = collector.observe(observed, time::now_seconds());
                    thread::park_timeout(POLL_INTERVAL);
                }

                let _ = collector.close(time::now_seconds());
            })
            .map_err(|error| {
                ApiError::internal("the foreground collector could not start")
                    .with_details(error.to_string())
            })?;

        Ok(Self {
            stopped,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// Asks the loop to finish and waits for the last row to be closed.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);

        let Ok(mut thread) = self.thread.lock() else {
            return;
        };
        let Some(handle) = thread.take() else {
            return;
        };

        handle.thread().unpark();
        let _ = handle.join();
    }
}

/// Whether the user has been away long enough that the app in front should stop counting.
fn idle() -> bool {
    windows::milliseconds_since_last_input().is_some_and(is_idle)
}

/// Compares an interval of no input against [`IDLE_TIMEOUT`].
fn is_idle(milliseconds: u64) -> bool {
    milliseconds >= IDLE_TIMEOUT.as_millis() as u64
}

/// Reads the foreground window, dropping our own: time spent in SentryNeko is not activity.
fn sample() -> Option<Sample> {
    keep(windows::foreground_app()?, windows::current_process_id())
}

/// Drops the window when it belongs to `own_process_id`.
fn keep(foreground: windows::ForegroundApp, own_process_id: u32) -> Option<Sample> {
    if foreground.process_id == own_process_id {
        return None;
    }

    Some(Sample {
        app_name: foreground.app_name,
        window_title: foreground.window_title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository;
    use crate::db::schema;
    use crate::services::event_bus::names;
    use crate::services::event_bus::testing::Recorder;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    fn rows(db: &Db) -> Vec<AppEvent> {
        repository::query_all(
            db,
            "SELECT id, app_name, window_title, started_at, ended_at FROM app_events ORDER BY id",
            [],
            AppEvent::from_row,
        )
        .expect("the rows are readable")
    }

    fn buckets(db: &Db) -> Vec<(String, i64, i64)> {
        repository::query_all(
            db,
            "SELECT app_name, hour_start, seconds FROM app_usage_hours ORDER BY hour_start, app_name",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
        )
        .expect("the buckets are readable")
    }

    fn seen(app_name: &str, window_title: Option<&str>) -> Option<Sample> {
        Some(Sample {
            app_name: app_name.to_owned(),
            window_title: window_title.map(str::to_owned),
        })
    }

    fn new_collector(db: &Db) -> ForegroundCollector {
        ForegroundCollector::new(db.clone(), EventBus::new(Recorder::default()))
    }

    #[test]
    fn polling_the_same_window_twice_writes_one_row() {
        let db = created();
        let mut collector = new_collector(&db);

        for now in [100, 101, 102] {
            collector
                .observe(seen("code", Some("main.rs")), now)
                .expect("observed");
        }

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, None);
    }

    #[test]
    fn a_switch_writes_the_seconds_of_the_app_it_leaves() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("first app");
        for now in 101..=104 {
            collector
                .observe(seen("code", Some("main.rs")), now)
                .expect("same window");
        }
        collector
            .observe(seen("chrome", Some("docs")), 105)
            .expect("second app");

        assert_eq!(
            buckets(&db),
            [("code".to_owned(), 0, 5)],
            "the five seconds code held belong to code"
        );
    }

    #[test]
    fn an_hour_boundary_splits_the_seconds_into_two_buckets() {
        let db = created();
        let mut collector = new_collector(&db);

        for now in [3_598, 3_599, 3_600, 3_601] {
            collector.observe(seen("code", None), now).expect("observed");
        }
        collector.close(3_602).expect("closed");

        assert_eq!(
            buckets(&db),
            [("code".to_owned(), 0, 2), ("code".to_owned(), 3_600, 1)],
            "the seconds on either side of the boundary go to the hour they happened in"
        );
    }

    #[test]
    fn a_gap_longer_than_a_minute_is_not_charged() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("opened");
        // The machine slept for two hours: the sample is the same window, but only the part the loop
        // could have watched is claimed.
        collector.observe(seen("code", None), 7_300).expect("woke up");
        collector.close(7_301).expect("closed");

        assert_eq!(buckets(&db), [("code".to_owned(), 0, 60)]);
    }

    #[test]
    fn the_seconds_are_written_before_the_stretch_ends() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("opened");
        for now in 101..=140 {
            collector.observe(seen("code", None), now).expect("observed");
        }

        assert_eq!(
            buckets(&db),
            [("code".to_owned(), 0, 30)],
            "a process that dies now loses the ten seconds still in memory, not the thirty before"
        );

        collector.close(141).expect("closed");
        assert_eq!(buckets(&db), [("code".to_owned(), 0, 40)]);
    }

    #[test]
    fn a_switch_closes_the_previous_row_at_the_same_instant() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("first app");
        collector
            .observe(seen("chrome", Some("docs")), 160)
            .expect("second app");

        let stored = rows(&db);
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].ended_at, Some(160));
        assert_eq!(stored[1].app_name, "chrome");
        assert_eq!(stored[1].started_at, 160);
        assert_eq!(stored[1].ended_at, None);
    }

    #[test]
    fn a_title_change_updates_the_open_row_instead_of_splitting_it() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("chrome", Some("tab one")), 100)
            .expect("first tab");
        collector
            .observe(seen("chrome", Some("tab two")), 140)
            .expect("second tab");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].window_title.as_deref(), Some("tab two"));
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, None);
    }

    #[test]
    fn nothing_in_front_closes_the_open_row() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("observed");
        collector.observe(None, 150).expect("locked or unknown");
        collector.observe(None, 160).expect("still nothing");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].ended_at, Some(150));
    }

    #[test]
    fn the_idle_threshold_is_five_minutes() {
        let threshold = IDLE_TIMEOUT.as_millis() as u64;

        assert!(!is_idle(0));
        assert!(
            !is_idle(threshold - 1),
            "a break shorter than the timeout counts"
        );
        assert!(is_idle(threshold));
        assert!(is_idle(threshold * 10));
    }

    #[test]
    fn a_switch_is_pushed_once_and_a_title_change_is_not() {
        let db = created();
        let recorder = Recorder::default();
        let mut collector = ForegroundCollector::new(db.clone(), EventBus::new(recorder.clone()));

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("first app");
        collector
            .observe(seen("code", Some("main.rs")), 110)
            .expect("same window");
        collector
            .observe(seen("code", Some("lib.rs")), 120)
            .expect("same app, new title");
        collector
            .observe(seen("chrome", Some("docs")), 160)
            .expect("second app");

        let pushed = recorder.pushed();
        assert_eq!(pushed.len(), 2, "{pushed:?}");
        assert_eq!(pushed[0].0, names::APP_SWITCH);
        assert_eq!(pushed[0].1["appName"], serde_json::json!("code"));
        assert_eq!(pushed[0].1["startedAt"], serde_json::json!(100));
        assert_eq!(pushed[1].0, names::APP_SWITCH);
        assert_eq!(pushed[1].1["appName"], serde_json::json!("chrome"));
        assert_eq!(pushed[1].1["startedAt"], serde_json::json!(160));
    }

    #[test]
    fn our_own_window_never_becomes_a_sample() {
        let own = windows::ForegroundApp {
            app_name: "SentryNeko".to_owned(),
            window_title: Some("SentryNeko".to_owned()),
            process_id: 4_242,
        };

        assert_eq!(keep(own.clone(), 4_242), None);
        assert_eq!(
            keep(own, 4_243),
            seen("SentryNeko", Some("SentryNeko")),
            "another process is kept"
        );
    }

    #[test]
    fn a_clock_that_steps_back_does_not_end_a_row_before_it_starts() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 500)
            .expect("observed");
        collector.observe(None, 400).expect("clock stepped back");

        assert_eq!(rows(&db)[0].ended_at, Some(500));
    }
}
