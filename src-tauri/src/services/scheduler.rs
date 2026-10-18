//! Timed task scheduler responsible for firing alarms.
//!
//! The loop runs on its own thread and compares the clock with the stored alarms once a second.
//! Each alarm keeps the instant it is next due at, so a week of idle ticking costs one comparison
//! per alarm, and the instant is recomputed whenever the row changed — editing an alarm takes
//! effect on the next tick, without the window telling the loop.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::AppHandle;

use crate::config::Config;
use crate::db::connection::Db;
use crate::models::alarm::{Alarm, AlarmDefaults, Method};
use crate::services::event_bus::EventBus;
use crate::services::i18n::Language;
use crate::services::notification::{Chime, Notification, Notifier, ToastSink};
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;

/// How often the clock is compared with the alarms.
///
/// A second is the resolution the alarms are stored at, so a slower loop would ring late and a
/// faster one would only read the same second twice.
pub const TICK: Duration = Duration::from_secs(1);

/// How late an alarm may still ring when the loop first sees it, in seconds.
///
/// The loop computes an instant when it reads a row, so a row read a moment after its time would
/// otherwise be skipped until the next day. One tick of slack covers that, and still refuses to
/// replay an alarm that was due while the app was closed.
const GRACE_SECONDS: i64 = 1;

/// Seconds between two tones while an alarm is ringing.
///
/// The system chime lasts about a second, so two seconds leave a pause instead of a solid hum.
const BEEP_INTERVAL: i64 = 2;

/// One alarm and the instant it is next due at.
struct Due {
    alarm: Alarm,
    next_fire: Option<i64>,
}

/// The tones still owed to an alarm that has just gone off.
struct Ringing {
    /// Tones after the one that opened the ring.
    remaining: i64,
    /// When the next of them is due.
    next_at: i64,
    /// When the ring is over, whether or not every tone of it could still be played.
    ends_at: i64,
}

impl Ringing {
    /// Schedules the tones that follow the first one for `seconds` of ringing.
    fn after(now: i64, seconds: i64) -> Option<Self> {
        let beeps = (seconds + BEEP_INTERVAL - 1) / BEEP_INTERVAL;

        (beeps > 1).then(|| Self {
            remaining: beeps - 1,
            next_at: now + BEEP_INTERVAL,
            ends_at: now + seconds,
        })
    }
}

/// Rings alarms when their local time comes.
pub struct AlarmScheduler<T: ToastSink, C: Chime> {
    db: Db,
    bus: EventBus,
    config: Config,
    notifier: Notifier<T>,
    chime: C,
    due: HashMap<i64, Due>,
    ringing: Option<Ringing>,
}

impl<T: ToastSink, C: Chime> AlarmScheduler<T, C> {
    /// Builds a scheduler that has not looked at any alarm yet.
    #[must_use]
    pub fn new(db: Db, bus: EventBus, config: Config, notifier: Notifier<T>, chime: C) -> Self {
        Self {
            db,
            bus,
            config,
            notifier,
            chime,
            due: HashMap::new(),
            ringing: None,
        }
    }

    /// Compares the alarms with `now`, rings the ones that are due and answers what rang.
    ///
    /// The rows are read again on every tick, so an alarm added, edited or removed in the window
    /// is picked up without a notification. Failing to read them is the only error: an alarm that
    /// cannot ring, because the tone or the toast was refused, still counts as rung — the other
    /// channel covers for it.
    pub fn tick(&mut self, now: i64) -> ApiResult<Vec<Alarm>> {
        self.beep_if_due(now);

        let alarms = Alarm::list(&self.db)?;
        let known: Vec<i64> = alarms.iter().map(|alarm| alarm.id).collect();
        self.due.retain(|id, _| known.contains(id));

        let mut fired = Vec::new();

        for alarm in alarms {
            let next_fire = match self.due.get(&alarm.id) {
                Some(due) if due.alarm == alarm => due.next_fire,
                // A row read a moment after its time still rings, within [`GRACE_SECONDS`].
                _ => alarm.next_fire(now - GRACE_SECONDS),
            };

            self.due.insert(
                alarm.id,
                Due {
                    alarm: alarm.clone(),
                    next_fire,
                },
            );

            if next_fire.is_some_and(|at| at <= now) {
                fired.push(self.ring(&alarm, now));
            }
        }

        Ok(fired)
    }

    /// Rings one alarm and answers the row the push carries.
    fn ring(&mut self, alarm: &Alarm, now: i64) -> Alarm {
        // A one-off rings once, so it is switched off first: a crash in the middle of the ring
        // must not leave it armed for tomorrow.
        let rung = if alarm.is_one_off() {
            Alarm::set_enabled(&self.db, alarm.id, false).unwrap_or_else(|_| alarm.clone())
        } else {
            alarm.clone()
        };

        // The defaults are read here rather than copied into the row, so the settings page moves
        // every alarm the moment it is saved. A missing or unreadable row rings the plain default.
        let defaults = AlarmDefaults::load(&self.db).unwrap_or_default();
        let language = self.config.language().unwrap_or(Language::DEFAULT);
        let notification = Notification::alarm(language, &rung.label);

        // Both channels are best effort and independent: a machine without a sound device must
        // still show the message, and a system that blocks toasts must not silence the alarm.
        let _ = self.chime.play();
        self.ringing = Ringing::after(now, defaults.ring_seconds);

        if defaults.method == Method::Toast {
            let _ = self.notifier.send(&self.bus, &notification);
        }

        let _ = self.bus.emit_alarm_triggered(&rung);

        self.due.insert(
            rung.id,
            Due {
                next_fire: rung.next_fire(now),
                alarm: rung.clone(),
            },
        );

        rung
    }

    /// Plays the next tone of a ring that is still running, if it is due.
    ///
    /// Only one tone per tick: a loop that fell behind must not fire a burst of them at once.
    fn beep_if_due(&mut self, now: i64) {
        let Some(ringing) = self.ringing.as_mut() else {
            return;
        };

        // A loop that slept through the whole ring must not replay it at wake-up.
        if now > ringing.ends_at {
            self.ringing = None;
            return;
        }

        if now < ringing.next_at {
            return;
        }

        let _ = self.chime.play();
        ringing.remaining -= 1;
        ringing.next_at = now + BEEP_INTERVAL;

        if ringing.remaining == 0 {
            self.ringing = None;
        }
    }
}

/// Handle to the running scheduler.
///
/// Keep it in Tauri managed state: [`Self::stop`] asks the loop to finish and joins the thread, so
/// quitting the app does not wait for it to notice.
pub struct RunningScheduler {
    stopped: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl RunningScheduler {
    /// Starts the alarm loop on a background thread.
    pub fn spawn(db: Db, bus: EventBus, config: Config, app: AppHandle) -> ApiResult<Self> {
        let stopped = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stopped);
        let mut scheduler =
            AlarmScheduler::new(db, bus, config, Notifier::new(app.clone()), app.clone());

        let thread = thread::Builder::new()
            .name("alarm-scheduler".to_owned())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    // A failed read must not kill the loop: the next tick retries.
                    let _ = scheduler.tick(time::now_seconds());
                    thread::park_timeout(TICK);
                }
            })
            .map_err(|error| {
                ApiError::internal("the alarm scheduler could not start")
                    .with_details(error.to_string())
            })?;

        Ok(Self {
            stopped,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// Asks the loop to finish and waits for the thread.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::services::event_bus::names;
    use crate::services::event_bus::testing::Recorder;
    use crate::utils::windows;
    use std::sync::Mutex as StdMutex;
    use tempfile::TempDir;

    /// A toast sink that records what it was asked to show; `Err` refuses the toast.
    #[derive(Clone)]
    struct FakeToast {
        outcome: Result<(), String>,
        shown: Arc<StdMutex<Vec<(String, String)>>>,
    }

    impl FakeToast {
        fn accepting() -> Self {
            Self {
                outcome: Ok(()),
                shown: Arc::new(StdMutex::new(Vec::new())),
            }
        }

        fn refusing() -> Self {
            Self {
                outcome: Err("toasts are disabled".to_owned()),
                shown: Arc::new(StdMutex::new(Vec::new())),
            }
        }

        fn shown(&self) -> Vec<(String, String)> {
            self.shown
                .lock()
                .expect("the recorder lock is not poisoned")
                .clone()
        }
    }

    impl ToastSink for FakeToast {
        fn show(&self, title: &str, body: &str) -> Result<(), String> {
            self.shown
                .lock()
                .expect("the recorder lock is not poisoned")
                .push((title.to_owned(), body.to_owned()));

            self.outcome.clone()
        }
    }

    /// A tone that counts how often it was played.
    #[derive(Clone, Default)]
    struct FakeChime {
        plays: Arc<StdMutex<usize>>,
    }

    impl FakeChime {
        fn plays(&self) -> usize {
            *self.plays.lock().expect("the counter lock is not poisoned")
        }
    }

    impl Chime for FakeChime {
        fn play(&self) -> Result<(), String> {
            *self.plays.lock().expect("the counter lock is not poisoned") += 1;

            Ok(())
        }
    }

    struct Fixture {
        db: Db,
        bus: EventBus,
        recorder: Recorder,
        config: Config,
        _directory: TempDir,
    }

    impl Fixture {
        fn new() -> Self {
            let db = Db::open_in_memory().expect("in-memory database opens");
            schema::ensure(&db).expect("schema is created");
            let recorder = Recorder::default();
            let directory = tempfile::tempdir().expect("a temporary directory is created");
            let config = Config::open(directory.path()).expect("the configuration is created");
            config
                .set_language(crate::services::i18n::Language::EnUs)
                .expect("the fixture uses a deterministic notification language");

            Self {
                bus: EventBus::new(recorder.clone()),
                db,
                recorder,
                config,
                _directory: directory,
            }
        }

        fn scheduler(
            &self,
            toast: FakeToast,
            chime: FakeChime,
        ) -> AlarmScheduler<FakeToast, FakeChime> {
            AlarmScheduler::new(
                self.db.clone(),
                self.bus.clone(),
                self.config.clone(),
                Notifier::new(toast),
                chime,
            )
        }
    }

    fn now() -> i64 {
        time::now_seconds()
    }

    /// Hour and minute the local clock reads `seconds` from now.
    fn clock_in(seconds: i64) -> (i64, i64) {
        let minutes = windows::local_minutes(now() + seconds).expect("the clock is readable");

        (minutes / 60, minutes % 60)
    }

    #[test]
    fn a_due_alarm_rings_once_with_the_tone_the_toast_and_the_push() {
        let fixture = Fixture::new();
        let toast = FakeToast::accepting();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(toast.clone(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "stand up", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        assert!(scheduler.tick(now()).expect("tick").is_empty());
        assert_eq!(chime.plays(), 0);

        let rung = scheduler.tick(fire).expect("tick");

        assert_eq!(rung.len(), 1);
        assert!(!rung[0].enabled, "a one-off is switched off once it rang");
        assert_eq!(chime.plays(), 1);
        assert_eq!(
            toast.shown(),
            [("Alarm".to_owned(), "stand up".to_owned())],
            "the toast carries the label"
        );

        let pushed = fixture.recorder.pushed();
        assert_eq!(pushed.len(), 1, "{pushed:?}");
        assert_eq!(pushed[0].0, names::ALARM_TRIGGERED);
        assert_eq!(pushed[0].1["label"], serde_json::json!("stand up"));
        assert!(
            !Alarm::find(&fixture.db, alarm.id).expect("stored").enabled,
            "the stored row was switched off"
        );

        // A second tick at the same instant must not ring again.
        assert!(scheduler.tick(fire).expect("tick").is_empty());
        assert_eq!(chime.plays(), 1);
    }

    #[test]
    fn a_repeating_alarm_rings_again_on_its_next_occurrence() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(
            &fixture.db,
            "walk",
            hour,
            minute,
            i64::from(crate::models::alarm::ALL_DAYS),
        )
        .expect("stored");
        let first = alarm.next_fire(now()).expect("it has a next occurrence");

        let rung = scheduler.tick(first).expect("tick");
        assert_eq!(rung.len(), 1);
        assert!(rung[0].enabled, "a repeating alarm stays on");
        assert_eq!(chime.plays(), 1);

        assert!(scheduler.tick(first + 1).expect("tick").is_empty());
        assert_eq!(chime.plays(), 1);

        let next = rung[0].next_fire(first).expect("the next occurrence");
        assert_eq!(scheduler.tick(next).expect("tick").len(), 1);
        assert_eq!(chime.plays(), 2);
    }

    #[test]
    fn a_refused_toast_falls_back_without_swallowing_the_ring() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::refusing(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        let rung = scheduler.tick(fire).expect("tick");

        assert_eq!(rung.len(), 1);
        assert_eq!(chime.plays(), 1, "the tone still played");

        let pushed = fixture.recorder.pushed();
        let events: Vec<&str> = pushed.iter().map(|(event, _)| event.as_str()).collect();
        assert_eq!(
            events,
            [names::NOTIFICATION_FALLBACK, names::ALARM_TRIGGERED],
            "the toast fallback and the trigger both reach the window"
        );
        assert_eq!(pushed[0].1["kind"], serde_json::json!("alarm"));
    }

    #[test]
    fn a_disabled_alarm_never_rings() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "off", hour, minute, 0).expect("stored");
        Alarm::set_enabled(&fixture.db, alarm.id, false).expect("switched off");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        assert!(scheduler.tick(fire).expect("tick").is_empty());
        assert_eq!(chime.plays(), 0);
        assert!(fixture.recorder.pushed().is_empty());
    }

    #[test]
    fn an_alarm_removed_from_the_list_stops_ringing() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "gone", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        scheduler.tick(now()).expect("tick");
        Alarm::delete(&fixture.db, alarm.id).expect("removed");

        assert!(scheduler.tick(fire).expect("tick").is_empty());
        assert_eq!(chime.plays(), 0);
    }

    #[test]
    fn moving_an_alarm_moves_the_instant_it_rings_at() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "later", hour, minute, 0).expect("stored");
        let before = alarm.next_fire(now()).expect("it has a next occurrence");
        scheduler.tick(now()).expect("tick");

        let (later_hour, later_minute) = clock_in(240);
        let moved = Alarm::update(&fixture.db, alarm.id, "later", later_hour, later_minute, 0)
            .expect("updated");
        let after = moved.next_fire(now()).expect("it still has an occurrence");

        assert!(
            scheduler.tick(before).expect("tick").is_empty(),
            "the old instant is no longer armed"
        );
        assert_eq!(scheduler.tick(after).expect("tick").len(), 1);
        assert_eq!(chime.plays(), 1);
    }

    #[test]
    fn an_alarm_added_while_the_scheduler_runs_is_picked_up() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());

        assert!(scheduler.tick(now()).expect("tick").is_empty());

        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "new", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        assert_eq!(scheduler.tick(fire).expect("tick").len(), 1);
        assert_eq!(chime.plays(), 1);
    }

    #[test]
    fn the_tone_repeats_until_the_configured_duration_is_over() {
        let fixture = Fixture::new();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(FakeToast::accepting(), chime.clone());
        AlarmDefaults::save(
            &fixture.db,
            AlarmDefaults {
                ring_seconds: 4,
                method: Method::Toast,
            },
        )
        .expect("stored");
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "ring", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        assert_eq!(scheduler.tick(fire).expect("tick").len(), 1);
        assert_eq!(chime.plays(), 1, "the first tone plays with the alarm");

        assert!(scheduler.tick(fire + 1).expect("tick").is_empty());
        assert_eq!(chime.plays(), 1, "two tones are two seconds apart");

        scheduler.tick(fire + 2).expect("tick");
        assert_eq!(chime.plays(), 2, "the second tone is due two seconds in");

        for offset in 3..=20 {
            scheduler.tick(fire + offset).expect("tick");
        }
        assert_eq!(chime.plays(), 2, "four seconds of ringing are over");
    }

    #[test]
    fn the_in_app_method_leaves_the_system_toast_quiet() {
        let fixture = Fixture::new();
        let toast = FakeToast::accepting();
        let chime = FakeChime::default();
        let mut scheduler = fixture.scheduler(toast.clone(), chime.clone());
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&fixture.db, "quiet", hour, minute, 0).expect("stored");
        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        // Saved after the alarm exists: the defaults are read when it rings, not when it is added.
        AlarmDefaults::save(
            &fixture.db,
            AlarmDefaults {
                ring_seconds: 2,
                method: Method::InApp,
            },
        )
        .expect("stored");

        let rung = scheduler.tick(fire).expect("tick");

        assert_eq!(rung.len(), 1);
        assert_eq!(chime.plays(), 1, "the tone still plays");
        assert!(
            toast.shown().is_empty(),
            "the system was never asked to show a toast"
        );

        let pushed = fixture.recorder.pushed();
        assert_eq!(pushed.len(), 1, "{pushed:?}");
        assert_eq!(pushed[0].0, names::ALARM_TRIGGERED);
    }
}
