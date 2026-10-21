//! Foreground application collector built on GetForegroundWindow and GetWindowText.
//!
//! The loop runs on its own thread, one sample every five seconds, and writes through
//! [`crate::models::app_event`]; it never touches the UI. Every sample is settled in one place — the
//! time since the previous report, and whose it was — and only then handed to the two writers: the
//! stream of app stretches, and the hours an application held the foreground.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::db::connection::Db;
use crate::models::app_event::{AppEvent, AppUsage, HOUR_SECONDS};
use crate::services::event_bus::EventBus;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;
use crate::utils::windows;

/// How often the foreground window is sampled.
///
/// Rows are stored with second resolution, so sampling faster would not add detail; a slower
/// loop would blur short switches.
pub const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// How long the user has to be away before the app in front stops counting.
///
/// Five minutes covers a phone call or a read of the printed page without charging that time to
/// whichever window happened to be open.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Longest gap one report may charge.
///
/// A machine that sleeps leaves the same window in front, and the loop resumes an hour later; only
/// the part that could have been watched is claimed, so a nap does not fill the hours it happened
/// in.
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

/// Seconds of one application in one hour, gathered until they are worth writing.
#[derive(Debug)]
struct Pending {
    app_name: String,
    hour_start: i64,
    seconds: i64,
}

/// The stretch in progress: whose foreground time is being counted, and since when.
#[derive(Debug)]
struct Current {
    app_name: String,
    window_title: Option<String>,
    started_at: i64,
}

pub struct ForegroundCollector {
    db: Db,
    bus: EventBus,
    current: Option<Current>,
    reported_at: Option<i64>,
    pending: Option<Pending>,
}

impl ForegroundCollector {
    /// Builds a collector that owns no row yet.
    #[must_use]
    pub fn new(db: Db, bus: EventBus) -> Self {
        Self {
            db,
            bus,
            current: None,
            reported_at: None,
            pending: None,
        }
    }

    /// Applies one observation taken at `now`.
    ///
    /// The loop calls this every few seconds, whether the window changed or not: an unchanged window
    /// still earns its seconds, so time is counted by the clock rather than by the switches.
    pub fn observe(&mut self, sample: Option<Sample>, now: i64) -> ApiResult<()> {
        self.settle(sample, now)
    }

    /// Settles the last stretch and writes it out.
    pub fn close(&mut self, now: i64) -> ApiResult<()> {
        self.settle(None, now)?;
        self.flush()
    }

    /// Settles the time since the last report, then starts or ends the stretch.
    ///
    /// The app name and the seconds are its only business. The seconds are cut at the hour
    /// boundaries and handed to the buckets; when the app in front changes, the stretch that ends is
    /// written to the stream as one row holding both of its ends. A report further apart than
    /// [`MAX_CHARGED_GAP`] means the loop was not running: the stretch that was watched ends where
    /// the last report did, the gap is charged to nobody, and a new stretch starts at `now`.
    fn settle(&mut self, sample: Option<Sample>, now: i64) -> ApiResult<()> {
        let charged = self.current.as_ref().map(|current| current.app_name.clone());

        if let (Some(app_name), Some(from)) = (charged, self.reported_at) {
            let seconds = now - from;

            if seconds > MAX_CHARGED_GAP {
                // The loop was not running: the minutes in the gap were never watched, so the
                // stretch keeps only what was charged and ends where the last report did.
                self.end_current(from)?;
            } else if seconds > 0 {
                self.push_usage(&app_name, from, seconds)?;
            }
        }

        self.reported_at = Some(now);

        let same = matches!(
            (&self.current, &sample),
            (Some(current), Some(sample)) if current.app_name == sample.app_name
        );

        if same {
            if let Some(current) = self.current.as_mut() {
                current.window_title = sample.and_then(|sample| sample.window_title);
            }

            return Ok(());
        }

        // Another app, or nothing in front: the stretch that ends is written out now.
        self.end_current(now)?;

        self.current = sample.map(|sample| Current {
            app_name: sample.app_name,
            window_title: sample.window_title,
            started_at: now,
        });

        Ok(())
    }

    /// Writes the stretch in progress as one closed row, and the seconds it earned.
    ///
    /// `ended_at` is where the stretch stopped being watched: the app in front changed, the
    /// application is quitting, or a gap ended it at the last report that was charged.
    fn end_current(&mut self, ended_at: i64) -> ApiResult<()> {
        let Some(current) = self.current.take() else {
            return Ok(());
        };

        let ended_at = ended_at.max(current.started_at);

        if ended_at <= current.started_at {
            return Ok(());
        }

        let event = AppEvent::record_segment(
            &self.db,
            &current.app_name,
            current.window_title.as_deref(),
            current.started_at,
            ended_at,
        )?;

        self.flush()?;

        // The row is stored before the push, so a window that closed cannot lose it.
        self.bus.emit_app_switch(&event)?;

        Ok(())
    }

    /// Cuts `seconds` that began at `from` at the hour boundaries, handing each piece to the bucket
    /// it belongs to.
    fn push_usage(&mut self, app_name: &str, from: i64, seconds: i64) -> ApiResult<()> {
        let end = from + seconds;
        let mut cursor = from;

        while cursor < end {
            let hour_start = AppUsage::hour_of(cursor);
            let stop = end.min(hour_start + HOUR_SECONDS);

            self.hold(app_name, hour_start, stop - cursor)?;
            cursor = stop;
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

    /// Holds `seconds` for one bucket in memory, writing the previous one out when the bucket changes.
    fn hold(&mut self, app_name: &str, hour_start: i64, seconds: i64) -> ApiResult<()> {
        let same = self.pending.as_ref().is_some_and(|pending| {
            pending.app_name == app_name && pending.hour_start == hour_start
        });

        if !same {
            // Another hour or another app: what was gathered belongs to the bucket it was gathered
            // for, so it goes out before the next one starts.
            self.flush()?;
            self.pending = Some(Pending {
                app_name: app_name.to_owned(),
                hour_start,
                seconds,
            });

            return Ok(());
        }

        if let Some(pending) = self.pending.as_mut() {
            pending.seconds += seconds;
        }

        Ok(())
    }

    /// Writes the gathered seconds; they stay in memory when the write fails, so the next flush
    /// retries them instead of losing them.
    fn flush(&mut self) -> ApiResult<()> {
        let Some(pending) = self.pending.as_ref() else {
            return Ok(());
        };

        AppUsage::record(&self.db, &pending.app_name, pending.hour_start, pending.seconds)?;
        self.pending = None;

        Ok(())
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
                    let observed = if away() { None } else { sample() };

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

/// Whether the user has left the machine: no input for five minutes and nothing playing.
///
/// Watching a video leaves the keyboard untouched, so playback vetoes the idle answer.
fn away() -> bool {
    is_away(
        windows::milliseconds_since_last_input(),
        windows::media_is_playing(),
    )
}

/// Decides from the two facts alone, so the rule is testable without a media session.
fn is_away(milliseconds: Option<u64>, playing: bool) -> bool {
    !playing && milliseconds.is_some_and(is_idle)
}

/// Compares an interval of no input against [`IDLE_TIMEOUT`].
fn is_idle(milliseconds: u64) -> bool {
    milliseconds >= IDLE_TIMEOUT.as_millis() as u64
}

/// Reads the foreground window.
///
/// This application's own window is sampled like any other: the time a user spends reading the
/// dashboard is time in front of this app, and the stream would otherwise show a stretch no app
/// owns.
fn sample() -> Option<Sample> {
    let foreground = windows::foreground_app()?;

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

    /// The seconds the stream holds, added up over every closed row.
    fn streamed(db: &Db) -> i64 {
        rows(db)
            .iter()
            .filter_map(|event| event.ended_at.map(|ended| ended - event.started_at))
            .sum()
    }

    #[test]
    fn nothing_is_written_until_the_stretch_ends() {
        let db = created();
        let mut collector = new_collector(&db);

        for now in [100, 105, 110] {
            collector
                .observe(seen("code", Some("main.rs")), now)
                .expect("observed");
        }

        assert!(
            rows(&db).is_empty(),
            "a stretch that has not ended is not a report"
        );
    }

    #[test]
    fn a_switch_writes_one_closed_row_and_its_seconds() {
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

        let stored = rows(&db);
        assert_eq!(stored.len(), 1, "the app in front has no row yet");
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(105));
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
            [("code".to_owned(), 0, 2), ("code".to_owned(), 3_600, 2)],
            "the seconds on either side of the boundary go to the hour they happened in"
        );

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].started_at, 3_598);
        assert_eq!(stored[0].ended_at, Some(3_602));
    }

    #[test]
    fn a_long_gap_is_dropped_and_the_stretch_restarts() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("observed");
        for now in [105, 110] {
            collector.observe(seen("code", None), now).expect("watched");
        }
        // The machine slept for two hours: the loop was not running, so the gap is charged to
        // nobody, and what was watched before it keeps its own row.
        collector.observe(seen("code", None), 7_300).expect("woke up");
        collector.close(7_301).expect("closed");

        assert_eq!(
            buckets(&db),
            [("code".to_owned(), 0, 10), ("code".to_owned(), 7_200, 1)],
            "the two hours of sleep belong to nobody"
        );

        let stored = rows(&db);
        assert_eq!(stored.len(), 2, "the gap breaks the stretch in two");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(110));
        assert_eq!(stored[1].started_at, 7_300);
        assert_eq!(stored[1].ended_at, Some(7_301));

        let usage: i64 = buckets(&db).iter().map(|(_, _, seconds)| seconds).sum();

        assert_eq!(
            streamed(&db),
            usage,
            "the rows kept before the gap and the buckets describe the same seconds"
        );
    }

    #[test]
    fn the_seconds_are_written_before_the_stretch_ends() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("observed");
        for now in 101..=140 {
            collector.observe(seen("code", None), now).expect("observed");
        }

        assert_eq!(
            buckets(&db),
            [("code".to_owned(), 0, 30)],
            "a process that dies now loses the ten seconds still in memory, not the thirty before"
        );

        collector.close(141).expect("closed");
        assert_eq!(buckets(&db), [("code".to_owned(), 0, 41)]);
    }

    #[test]
    fn a_switch_writes_the_row_holding_both_ends() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("first app");
        collector
            .observe(seen("chrome", Some("docs")), 160)
            .expect("second app");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1, "the app in front has no row yet");
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(160));
    }

    #[test]
    fn a_title_change_does_not_split_the_stretch() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("chrome", Some("tab one")), 100)
            .expect("first tab");
        collector
            .observe(seen("chrome", Some("tab two")), 140)
            .expect("second tab");
        collector
            .observe(seen("code", None), 150)
            .expect("switched away");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].window_title.as_deref(), Some("tab two"));
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(150));
    }

    #[test]
    fn nothing_in_front_ends_the_stretch() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 100)
            .expect("observed");
        collector.observe(None, 150).expect("locked or unknown");
        collector.observe(None, 160).expect("still nothing");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].started_at, 100);
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
    fn playing_media_keeps_the_user_present() {
        let threshold = IDLE_TIMEOUT.as_millis() as u64;

        assert!(is_away(Some(threshold), false));
        assert!(
            !is_away(Some(threshold * 10), true),
            "a video in front is not an empty chair"
        );
        assert!(!is_away(Some(0), false));
        assert!(
            !is_away(None, false),
            "an unreadable input clock is not an absence"
        );
    }

    #[test]
    fn a_switch_is_pushed_once_and_after_the_row_is_stored() {
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
        assert_eq!(pushed.len(), 1, "{pushed:?}");
        assert_eq!(pushed[0].0, names::APP_SWITCH);
        assert_eq!(pushed[0].1["appName"], serde_json::json!("code"));
        assert_eq!(pushed[0].1["startedAt"], serde_json::json!(100));
        assert_eq!(rows(&db)[0].ended_at, Some(160));
    }

    #[test]
    fn a_clock_that_steps_back_does_not_write_a_row() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 500)
            .expect("observed");
        collector.observe(None, 400).expect("clock stepped back");

        assert!(rows(&db).is_empty());
    }

    #[test]
    fn a_repeated_close_does_not_duplicate_the_row() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("observed");
        collector.close(150).expect("closed");
        collector.close(150).expect("closed again");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].ended_at, Some(150));
    }

    #[test]
    fn the_stream_and_the_buckets_hold_the_same_time() {
        let db = created();
        let mut collector = new_collector(&db);

        collector.observe(seen("code", None), 100).expect("observed");
        for now in 101..=140 {
            collector.observe(seen("code", None), now).expect("code");
        }
        for now in 141..=150 {
            collector.observe(seen("chrome", None), now).expect("chrome");
        }
        collector.close(151).expect("closed");

        let usage: i64 = buckets(&db).iter().map(|(_, _, seconds)| seconds).sum();

        assert_eq!(
            streamed(&db),
            usage,
            "every closed row and every bucket describe the same seconds"
        );
    }
}
