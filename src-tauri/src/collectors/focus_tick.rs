//! The focus clock: the stretch that is running, and the minute tick that writes it down.
//!
//! No row records the stretch. It lives here while it runs — the backend owns it, not the window —
//! and once a minute its seconds are cut at the hour boundaries and added to
//! `focus_usage_hours`. A window that reloads or crashes leaves the total behind; a process that
//! ends leaves at most the current minute unwritten.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::db::connection::Db;
use crate::models::focus_usage::{FocusFile, FocusUsage};
use crate::models::pomodoro::{Phase, Running, MAX_SECONDS};
use crate::services::event_bus::EventBus;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;

/// How often the running stretch is written into its hour.
pub const TICK: Duration = Duration::from_secs(60);

/// The longest gap one settlement may count.
///
/// A longer gap means the process was frozen or the machine slept, and that time was not spent
/// focusing. The stretch still moves to `now`, so the gap is dropped once instead of being counted
/// by every following tick.
const MAX_GAP: i64 = 90;

/// A running stretch together with the instant it was last written up to.
struct Stretch {
    running: Running,
    /// What its seconds are filed under, kept beside the payload so the file can grow a dimension
    /// without the event a window listens to growing one too.
    file: FocusFile,
    settled_at: i64,
}

/// The focus clock: one stretch at a time, written into its hours once a minute.
pub struct FocusTicker {
    db: Db,
    stopped: Arc<AtomicBool>,
    stretch: Arc<Mutex<Option<Stretch>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl FocusTicker {
    /// Starts the tick on a background thread; `bus` hears about a phase the tick ends by itself.
    pub fn spawn(db: Db, bus: EventBus) -> ApiResult<Self> {
        let stopped = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stopped);
        let stretch = Arc::new(Mutex::new(None));
        let shared = Arc::clone(&stretch);
        let tick_db = db.clone();

        let thread = thread::Builder::new()
            .name("focus-tick".to_owned())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    // A failed write must not kill the loop: the next tick retries from the last
                    // instant that was written.
                    if let Some(finished) = settle(&tick_db, &shared, time::now_seconds()) {
                        // The phase ran out with nobody closing it, so the same push a stop makes
                        // goes out here.
                        let _ = bus.emit_pomodoro_finished(&finished);
                    }

                    thread::park_timeout(TICK);
                }
            })
            .map_err(|error| {
                ApiError::internal("the focus tick could not start").with_details(error.to_string())
            })?;

        Ok(Self {
            db,
            stopped,
            stretch,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// Starts a stretch, stopping the one already running.
    ///
    /// `file` is what the stretch's seconds are filed under. It is kept beside the payload rather
    /// than folded into it, so a dimension it learns later reaches the buckets without changing
    /// what a window is told.
    pub fn start(&self, phase: Phase, planned_seconds: i64, file: FocusFile) -> ApiResult<Running> {
        if !(1..=MAX_SECONDS).contains(&planned_seconds) {
            return Err(ApiError::invalid_input(format!(
                "plannedSeconds must be between 1 and {MAX_SECONDS}"
            ))
            .with_details(format!("received {planned_seconds}")));
        }

        self.stop()?;

        let now = time::now_seconds();
        let running = Running {
            phase,
            started_at: now,
            planned_seconds,
            category: file.category.clone(),
        };

        *self.lock()? = Some(Stretch {
            running: running.clone(),
            file,
            settled_at: now,
        });

        Ok(running)
    }

    /// Stops the stretch, writing what it spent since the last tick.
    ///
    /// Answers the stretch that was stopped, so the caller can tell the other windows it is over;
    /// nothing running answers `None`.
    pub fn stop(&self) -> ApiResult<Option<Running>> {
        let Some(stretch) = self.lock()?.take() else {
            return Ok(None);
        };

        flush(&self.db, &stretch, time::now_seconds())?;

        Ok(Some(stretch.running))
    }

    /// The stretch that is running, if one is.
    pub fn running(&self) -> Option<Running> {
        self.lock()
            .ok()?
            .as_ref()
            .map(|stretch| stretch.running.clone())
    }

    /// Asks the tick to finish and waits for the thread.
    pub fn shutdown(&self) {
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

    fn lock(&self) -> ApiResult<MutexGuard<'_, Option<Stretch>>> {
        self.stretch
            .lock()
            .map_err(|_| ApiError::internal("the focus clock is poisoned"))
    }
}

/// Writes the part a tick could have covered, then moves the stretch to `now`.
///
/// Running out of the planned length stops the stretch, so nobody has to close it for the totals
/// to stop moving; the stretch that ended is answered so the caller can push it.
fn settle(db: &Db, slot: &Mutex<Option<Stretch>>, now: i64) -> Option<Running> {
    let Ok(mut guard) = slot.lock() else {
        return None;
    };
    let stretch = guard.as_mut()?;

    let end = stretch.running.started_at + stretch.running.planned_seconds;
    let to = now.min(end);

    if to > stretch.settled_at {
        let counted_to = to.min(stretch.settled_at + MAX_GAP);

        if stretch.running.phase == Phase::Focus {
            let _ = FocusUsage::record_span(db, stretch.settled_at, counted_to, &stretch.file);
        }

        stretch.settled_at = to;
    }

    if now < end {
        return None;
    }

    let finished = stretch.running.clone();
    *guard = None;

    Some(finished)
}

/// Writes what the stretch spent up to now; used when it is stopped.
fn flush(db: &Db, stretch: &Stretch, now: i64) -> ApiResult<()> {
    let end = stretch.running.started_at + stretch.running.planned_seconds;
    let to = now.min(end);

    if to > stretch.settled_at && stretch.running.phase == Phase::Focus {
        let counted_to = to.min(stretch.settled_at + MAX_GAP);

        FocusUsage::record_span(db, stretch.settled_at, counted_to, &stretch.file)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::models::focus_usage::FocusCategory;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    fn test_bus() -> EventBus {
        EventBus::new(crate::services::event_bus::testing::Recorder::default())
    }

    /// A stretch of the given shape, filed under the unnamed work unless the test says otherwise.
    fn stretch(phase: Phase, started_at: i64, planned_seconds: i64) -> Stretch {
        stretch_of(phase, started_at, planned_seconds, FocusFile::default())
    }

    fn stretch_of(phase: Phase, started_at: i64, planned_seconds: i64, file: FocusFile) -> Stretch {
        Stretch {
            running: Running {
                phase,
                started_at,
                planned_seconds,
                category: file.category.clone(),
            },
            file,
            settled_at: started_at,
        }
    }

    #[test]
    fn a_settlement_writes_the_minute_that_passed() {
        let db = created();
        let slot = Mutex::new(Some(stretch(Phase::Focus, 3_500, 1_500)));

        assert!(settle(&db, &slot, 3_580).is_none(), "the phase still runs");

        assert_eq!(FocusUsage::hours(&db, 0, 7_200).expect("hours"), [(0, 80)]);

        assert!(settle(&db, &slot, 3_660).is_none());

        assert_eq!(
            FocusUsage::hours(&db, 0, 7_200).expect("hours"),
            [(0, 100), (3_600, 60)],
            "the second minute is cut at the hour it crosses"
        );
    }

    #[test]
    fn a_settlement_files_the_minute_under_the_category_it_ran_with() {
        let db = created();
        let slot = Mutex::new(Some(stretch_of(
            Phase::Focus,
            3_500,
            1_500,
            FocusFile::new().under("reading"),
        )));

        assert!(settle(&db, &slot, 3_560).is_none());

        assert_eq!(
            FocusUsage::categories(&db, 0, 7_200).expect("categories"),
            [FocusCategory {
                category: "reading".to_owned(),
                seconds: 60,
            }]
        );
    }

    #[test]
    fn a_break_is_never_written_into_the_hours() {
        let db = created();
        let slot = Mutex::new(Some(stretch(Phase::ShortBreak, 3_500, 300)));

        assert!(settle(&db, &slot, 3_580).is_none());

        assert!(FocusUsage::hours(&db, 0, 7_200).expect("hours").is_empty());
        assert!(
            slot.lock().expect("slot").is_some(),
            "a break keeps running"
        );
    }

    #[test]
    fn a_gap_the_tick_could_not_have_seen_is_dropped() {
        let db = created();
        let slot = Mutex::new(Some(stretch(Phase::Focus, 3_500, 300)));

        // The machine slept for an hour; only one tick's worth is counted.
        let finished = settle(&db, &slot, 7_100).expect("the short phase ran out");

        assert_eq!(finished.planned_seconds, 300);

        assert_eq!(FocusUsage::total(&db, 0, 7_200).expect("total"), MAX_GAP);
    }

    #[test]
    fn a_stretch_stops_itself_when_the_phase_runs_out() {
        let db = created();
        let slot = Mutex::new(Some(stretch(Phase::Focus, 3_500, 60)));

        let finished = settle(&db, &slot, 3_560).expect("the phase ran out");

        assert_eq!(finished.phase, Phase::Focus);
        assert_eq!(FocusUsage::total(&db, 0, 7_200).expect("total"), 60);
        assert!(
            slot.lock().expect("slot").is_none(),
            "nothing keeps running"
        );
    }

    #[test]
    fn stopping_writes_the_last_partial_minute() {
        let db = created();
        let stretch = stretch(Phase::Focus, 3_500, 1_500);

        flush(&db, &stretch, 3_580).expect("flushed");

        assert_eq!(FocusUsage::total(&db, 0, 7_200).expect("total"), 80);
    }

    #[test]
    fn the_ticker_starts_and_stops_a_stretch() {
        let db = created();
        let ticker = FocusTicker::spawn(db, test_bus()).expect("the tick starts");

        assert!(ticker.running().is_none());

        let started = ticker
            .start(Phase::Focus, 1_500, FocusFile::default())
            .expect("started");
        assert_eq!(started.phase, Phase::Focus);
        assert_eq!(
            started.category, "",
            "a stretch without a category starts anyway"
        );
        assert!(ticker.running().is_some());

        ticker.stop().expect("stopped");
        assert!(ticker.running().is_none());

        let broken = ticker
            .start(Phase::Focus, 0, FocusFile::default())
            .expect_err("a zero length phase is refused");
        assert_eq!(broken.code(), crate::utils::response::ApiCode::InvalidInput);

        ticker.shutdown();
    }
}
