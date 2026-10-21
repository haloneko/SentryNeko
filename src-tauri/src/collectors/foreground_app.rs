//! Foreground application collector built on GetForegroundWindow and GetWindowText.
//!
//! The loop runs on its own thread, one sample every second, and writes through
//! [`crate::models::app_event`]; it never touches the UI. A WinEvent hook wakes the loop the moment
//! the window in front changes, so a switch is settled at once instead of at the next tick. Every
//! sample is settled in one place — the time since the previous report, and whose it was — and only
//! then handed to the two writers: the stream of app stretches, and the hours an application held
//! the foreground.

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

pub const POLL_INTERVAL: Duration = Duration::from_secs(5);

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const MAX_CHARGED_GAP: i64 = 60;

const FLUSH_SECONDS: i64 = 30;

/// What the collector saw, already stripped of the windows it ignores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sample {
    pub app_name: String,
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
    fn settle(&mut self, sample: Option<Sample>, now: i64) -> ApiResult<()> {
        if let (Some(current), Some(sample)) = (self.current.as_mut(), &sample) {
            if current.app_name == sample.app_name {
                current.window_title = sample.window_title.clone();
            }
        }

        let charged = self.current.as_ref().map(|current| current.app_name.clone());

        if let (Some(app_name), Some(from)) = (charged, self.reported_at) {
            let seconds = now - from;

            if seconds > MAX_CHARGED_GAP {
                self.end_current(from)?;
            } else if seconds > 0 {
                self.push_usage(&app_name, from, seconds)?;
                self.touch_current(now)?;
            }
        }

        self.reported_at = Some(now);

        let same = matches!(
            (&self.current, &sample),
            (Some(current), Some(sample)) if current.app_name == sample.app_name
        );

        if same {
            return Ok(());
        }

        // Another app, or nothing in front: the stretch that ends is written out now.
        self.end_current(now)?;

        self.current = sample.map(|sample| Current {
            app_name: sample.app_name,
            window_title: sample.window_title,
            started_at: now,
        });

        // The new stretch reaches the page at once, even if it lasts only one sample.
        self.touch_current(now)
    }

    /// Writes the stretch in progress and pushes that same row again.
    fn touch_current(&mut self, at: i64) -> ApiResult<()> {
        let Some(current) = self.current.as_ref() else {
            return Ok(());
        };

        let event = AppEvent::record_segment(
            &self.db,
            &current.app_name,
            current.window_title.as_deref(),
            current.started_at,
            at,
        )?;

        self.bus.emit_app_switch(&event)
    }

    /// Writes the stretch in progress as one closed row, and the seconds it earned.
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
pub struct RunningCollector {
    stopped: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    watch: Mutex<Option<windows::ForegroundWatch>>,
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
                windows::wake_on_foreground_change(thread::current());

                while !flag.load(Ordering::Relaxed) {
                    let observed = if away() { None } else { sample() };

                    let _ = collector.observe(observed, time::now_seconds());
                    thread::park_timeout(POLL_INTERVAL);
                }

                windows::forget_foreground_waker();

                let _ = collector.close(time::now_seconds());
            })
            .map_err(|error| {
                ApiError::internal("the foreground collector could not start")
                    .with_details(error.to_string())
            })?;

        let watch = windows::ForegroundWatch::install();

        Ok(Self {
            stopped,
            thread: Mutex::new(Some(thread)),
            watch: Mutex::new(watch),
        })
    }

    /// Asks the loop to finish and waits for the last row to be closed.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);

        if let Ok(mut thread) = self.thread.lock() {
            if let Some(handle) = thread.take() {
                handle.thread().unpark();
                let _ = handle.join();
            }
        }

        if let Ok(mut watch) = self.watch.lock() {
            if let Some(hook) = watch.take() {
                drop(hook);
            }
        }
    }
}

/// Whether the user has left the machine: no input for five minutes and nothing playing.
fn away() -> bool {
    let Some(milliseconds) = windows::milliseconds_since_last_input() else {
        return false;
    };

    if !is_idle(milliseconds) {
        return false;
    }

    is_away(Some(milliseconds), windows::media_is_playing())
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
    fn the_stretch_in_progress_is_written_before_it_ends() {
        let db = created();
        let mut collector = new_collector(&db);

        for now in [100, 105, 110] {
            collector
                .observe(seen("code", Some("main.rs")), now)
                .expect("observed");
        }

        let stored = rows(&db);
        assert_eq!(stored.len(), 1, "one line follows the whole stretch");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(
            stored[0].ended_at,
            Some(110),
            "the row carries the last report, never a NULL"
        );
    }

    #[test]
    fn a_switch_closes_the_old_row_and_opens_the_new_one() {
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
        assert_eq!(
            stored.len(),
            2,
            "the stretch that just started owns a row from its first sample"
        );
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(105));
        assert_eq!(stored[1].app_name, "chrome");
        assert_eq!(stored[1].started_at, 105);
        assert_eq!(stored[1].ended_at, Some(105));
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
        assert_eq!(stored.len(), 2, "each stretch owns one row");
        assert_eq!(stored[0].app_name, "code");
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(160));
        assert_eq!(stored[1].app_name, "chrome");
        assert_eq!(stored[1].started_at, 160);
        assert_eq!(stored[1].ended_at, Some(160));
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
        assert_eq!(stored.len(), 2, "the second app opens its own row");
        assert_eq!(stored[0].window_title.as_deref(), Some("tab two"));
        assert_eq!(stored[0].started_at, 100);
        assert_eq!(stored[0].ended_at, Some(150));
        assert_eq!(stored[1].app_name, "code");
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
    fn the_stretch_is_pushed_again_under_the_same_id() {
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
        let code: Vec<&serde_json::Value> = pushed
            .iter()
            .filter(|(name, _)| name == names::APP_SWITCH)
            .map(|(_, payload)| payload)
            .filter(|payload| payload["appName"] == serde_json::json!("code"))
            .collect();

        assert!(code.len() >= 3, "one push per report: {pushed:?}");
        let id = &code[0]["id"];
        assert!(
            code.iter().all(|payload| &payload["id"] == id),
            "the whole stretch keeps one row"
        );

        let last = code.last().expect("code was pushed");
        assert_eq!(last["startedAt"], serde_json::json!(100));
        assert_eq!(last["endedAt"], serde_json::json!(160));
        assert_eq!(last["windowTitle"], serde_json::json!("lib.rs"));
        assert_eq!(rows(&db)[0].ended_at, Some(160));
    }

    #[test]
    fn a_clock_that_steps_back_does_not_write_a_second_row() {
        let db = created();
        let mut collector = new_collector(&db);

        collector
            .observe(seen("code", Some("main.rs")), 500)
            .expect("observed");
        collector.observe(None, 400).expect("clock stepped back");

        let stored = rows(&db);
        assert_eq!(stored.len(), 1, "the first sample already wrote its line");
        assert_eq!(stored[0].ended_at, Some(500), "the step back is ignored");
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
