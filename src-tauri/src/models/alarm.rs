//! Alarm model: one-off or weekly reminders that ring at a local wall-clock time.
//!
//! An alarm stores the time of day the user reads on their own clock, never an instant, so the
//! same row keeps its meaning across a time zone change. [`Alarm::next_fire`] turns it into the
//! next epoch second it has to ring at, resolving the local time through the Windows rules.

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::models::setting::Setting;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;
use crate::utils::windows;

/// Columns every query selects, in the order [`Alarm::from_row`] reads them.
const COLUMNS: &str = "id, label, hour, minute, repeat_days, enabled, created_at";

/// Key of the defaults row in the `settings` table.
pub(crate) const DEFAULTS_KEY: &str = "alarm.defaults";

/// Longest accepted label, in characters.
const MAX_LABEL_CHARS: usize = 60;

/// Longest accepted ring duration, in seconds.
const MAX_RING_SECONDS: i64 = 60;

/// Every weekday bit set: the weekday mask has no other bit.
pub const ALL_DAYS: u8 = 0b0111_1111;

/// How far a time zone change can move a wall-clock time, in minutes.
///
/// Two hours covers every offset in use and the one-hour shifts of a daylight-saving change; the
/// search in [`wall_clock`] only accepts an exact match, so a wider window costs nothing but time.
const CLOCK_CHANGE_MINUTES: i64 = 120;

/// Seconds in one nominal day; the local day can be an hour longer or shorter.
const DAY_SECONDS: i64 = 86_400;

/// How many days ahead a repeating alarm is looked for: a full week plus the day a clock change
/// can remove.
const REPEAT_LOOKAHEAD_DAYS: i64 = 8;

/// How many days ahead a one-off alarm is looked for: today, or tomorrow when its time has passed.
const ONE_OFF_LOOKAHEAD_DAYS: i64 = 2;

/// How an alarm announces itself when it goes off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    /// Ask the system for a Toast; when it refuses, the frontend shows one in the app instead.
    Toast,
    /// Leave the message to the window, which paints it from the push.
    InApp,
}

/// What an alarm rings with: how long the tone repeats and how the message travels.
///
/// The defaults live in one `settings` row and are read when an alarm goes off, so changing them
/// moves every alarm at once instead of leaving old rows on values nobody remembers choosing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlarmDefaults {
    /// How long the tone keeps repeating, in seconds.
    pub ring_seconds: i64,
    pub method: Method,
}

impl Default for AlarmDefaults {
    fn default() -> Self {
        Self {
            ring_seconds: 10,
            method: Method::Toast,
        }
    }
}

impl AlarmDefaults {
    /// Reads the stored defaults, falling back on a fresh database.
    ///
    /// Kept on the model because the scheduler reads it when an alarm rings.
    pub fn load(db: &Db) -> ApiResult<Self> {
        Ok(Setting::read_json(db, DEFAULTS_KEY)?.unwrap_or_default())
    }

    /// Validates and stores the defaults; a duration outside `1..=MAX_RING_SECONDS` is
    /// `INVALID_INPUT`.
    pub fn save(db: &Db, defaults: Self) -> ApiResult<Self> {
        defaults.validate()?;
        Setting::write_json(db, DEFAULTS_KEY, &defaults)?;

        Ok(defaults)
    }

    pub(crate) fn validate(&self) -> ApiResult<()> {
        if !(1..=MAX_RING_SECONDS).contains(&self.ring_seconds) {
            return Err(ApiError::invalid_input(format!(
                "ringSeconds must be between 1 and {MAX_RING_SECONDS}"
            ))
            .with_details(format!("received {}", self.ring_seconds)));
        }

        Ok(())
    }
}

/// A reminder at a local time of day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alarm {
    pub id: i64,
    pub label: String,
    /// Local hour, `0..=23`.
    pub hour: u8,
    /// Local minute, `0..=59`.
    pub minute: u8,
    /// Weekday mask: bit 0 is Monday and bit 6 is Sunday; `0` rings once at the next occurrence.
    pub repeat_days: u8,
    pub enabled: bool,
    pub created_at: i64,
}

impl Alarm {
    /// Maps one `alarms` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            label: row.get(1)?,
            hour: row.get(2)?,
            minute: row.get(3)?,
            repeat_days: row.get(4)?,
            enabled: row.get(5)?,
            created_at: row.get(6)?,
        })
    }

    /// Whether the alarm rings once instead of every selected weekday.
    #[must_use]
    pub const fn is_one_off(&self) -> bool {
        self.repeat_days == 0
    }

    /// The first instant strictly after `after` when the alarm rings, in UTC epoch seconds.
    ///
    /// Answers `None` while the alarm is disabled. The wall-clock time is resolved through the
    /// Windows time zone rules: a day whose clocks move keeps the right instant, a time the clock
    /// skips that day is skipped with it, and a time the clock repeats rings on its first pass.
    #[must_use]
    pub fn next_fire(&self, after: i64) -> Option<i64> {
        if !self.enabled || self.repeat_days & !ALL_DAYS != 0 {
            return None;
        }

        let days = if self.is_one_off() {
            ONE_OFF_LOOKAHEAD_DAYS
        } else {
            REPEAT_LOOKAHEAD_DAYS
        };
        let today = windows::local_midnight(after)?;

        (0..days).find_map(|offset| {
            let day = windows::local_midnight(today + offset * DAY_SECONDS)?;

            if !self.is_one_off() && self.repeat_days & weekday_bit(day)? == 0 {
                return None;
            }

            let at = wall_clock(day, self.hour, self.minute)?;

            (at > after).then_some(at)
        })
    }

    /// Lists the alarms, earliest time of day first.
    pub fn list(db: &Db) -> ApiResult<Vec<Self>> {
        repository::query_all(
            db,
            &format!("SELECT {COLUMNS} FROM alarms ORDER BY hour, minute, id"),
            [],
            Self::from_row,
        )
    }

    /// Returns one alarm; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM alarms WHERE id = ?1"),
            [id],
            Self::from_row,
        )
    }

    /// Stores an enabled alarm; a time or a label outside the accepted range is `INVALID_INPUT`.
    pub fn add(db: &Db, label: &str, hour: i64, minute: i64, repeat_days: i64) -> ApiResult<Self> {
        let fields = Fields::validate(label, hour, minute, repeat_days)?;

        let id = repository::insert(
            db,
            "INSERT INTO alarms (label, hour, minute, repeat_days, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params![
                fields.label,
                fields.hour,
                fields.minute,
                fields.repeat_days,
                time::now_seconds()
            ],
        )?;

        Self::find(db, id)
    }

    /// Replaces the label, the time and the repeat days, keeping the enabled flag; a missing id is
    /// `NOT_FOUND`.
    pub fn update(
        db: &Db,
        id: i64,
        label: &str,
        hour: i64,
        minute: i64,
        repeat_days: i64,
    ) -> ApiResult<Self> {
        let fields = Fields::validate(label, hour, minute, repeat_days)?;

        let changed = repository::execute(
            db,
            "UPDATE alarms SET label = ?1, hour = ?2, minute = ?3, repeat_days = ?4 WHERE id = ?5",
            params![
                fields.label,
                fields.hour,
                fields.minute,
                fields.repeat_days,
                id
            ],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Turns an alarm on or off; a missing id is `NOT_FOUND`.
    pub fn set_enabled(db: &Db, id: i64, enabled: bool) -> ApiResult<Self> {
        let changed = repository::execute(
            db,
            "UPDATE alarms SET enabled = ?1 WHERE id = ?2",
            params![enabled, id],
        )?;

        require_changed(changed, id)?;
        Self::find(db, id)
    }

    /// Deletes an alarm; a missing id is `NOT_FOUND`.
    pub fn delete(db: &Db, id: i64) -> ApiResult<()> {
        let changed = repository::execute(db, "DELETE FROM alarms WHERE id = ?1", [id])?;

        require_changed(changed, id)
    }
}

/// The validated form of the columns a caller may set.
struct Fields {
    label: String,
    hour: u8,
    minute: u8,
    repeat_days: u8,
}

impl Fields {
    fn validate(label: &str, hour: i64, minute: i64, repeat_days: i64) -> ApiResult<Self> {
        if !(0..=23).contains(&hour) {
            return Err(field_error("hour", "0 and 23", hour));
        }

        if !(0..=59).contains(&minute) {
            return Err(field_error("minute", "0 and 59", minute));
        }

        if !(0..=i64::from(ALL_DAYS)).contains(&repeat_days) {
            return Err(field_error("repeatDays", "0 and 127", repeat_days));
        }

        let label = label.trim();

        if label.chars().count() > MAX_LABEL_CHARS {
            return Err(ApiError::invalid_input(format!(
                "label must not be longer than {MAX_LABEL_CHARS} characters"
            ))
            .with_details(format!("received {} characters", label.chars().count())));
        }

        Ok(Self {
            label: label.to_owned(),
            hour: hour as u8,
            minute: minute as u8,
            repeat_days: repeat_days as u8,
        })
    }
}

/// The weekday bit of `day` in `repeat_days`, or `None` when Windows cannot date it.
///
/// Windows numbers the days from Sunday; the mask starts at Monday, so both sides agree on the
/// week the user sees.
fn weekday_bit(day: i64) -> Option<u8> {
    let date = windows::local_date(day)?;

    Some(1 << ((date.weekday + 6) % 7))
}

/// The instant the local clock of the day starting at `day` reads `hour`:`minute`.
///
/// A clock change moves the wall clock by up to [`CLOCK_CHANGE_MINUTES`], so the nominal instant is
/// corrected around and verified against the local clock. The search walks forward, so a time the
/// clock shows twice answers its first pass; a time the clock skips answers `None`, and the caller
/// moves on to the next day.
fn wall_clock(day: i64, hour: u8, minute: u8) -> Option<i64> {
    let target = i64::from(hour) * 60 + i64::from(minute);
    let nominal = day + target * 60;

    (-CLOCK_CHANGE_MINUTES..=CLOCK_CHANGE_MINUTES)
        .map(|shift| nominal + shift * 60)
        .find(|candidate| windows::local_minutes(*candidate) == Some(target))
}

fn field_error(name: &str, range: &str, value: i64) -> ApiError {
    ApiError::invalid_input(format!("{name} must be between {range}"))
        .with_details(format!("received {value}"))
}

fn require_changed(changed: usize, id: i64) -> ApiResult<()> {
    if changed == 0 {
        return Err(ApiError::not_found(format!("no alarm with id {id}")));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    fn now() -> i64 {
        time::now_seconds()
    }

    /// Hour and minute the local clock reads `seconds` from now.
    fn clock_in(seconds: i64) -> (i64, i64) {
        let at = now() + seconds;
        let minutes = windows::local_minutes(at).expect("the local clock is readable");

        (minutes / 60, minutes % 60)
    }

    #[test]
    fn an_alarm_round_trips_through_the_database() {
        let db = created();

        let alarm = Alarm::add(&db, "  wake up  ", 7, 30, 0b0000_0101).expect("stored");

        assert_eq!(alarm.label, "wake up");
        assert_eq!((alarm.hour, alarm.minute), (7, 30));
        assert_eq!(alarm.repeat_days, 0b0000_0101);
        assert!(alarm.enabled);
        assert!(alarm.created_at > 0);
        assert_eq!(Alarm::list(&db).expect("list"), [alarm]);
    }

    #[test]
    fn the_list_is_ordered_by_the_time_of_day() {
        let db = created();

        let late = Alarm::add(&db, "late", 21, 0, 0).expect("stored");
        let early = Alarm::add(&db, "early", 6, 45, 0).expect("stored");

        assert_eq!(Alarm::list(&db).expect("list"), [early, late]);
    }

    #[test]
    fn editing_keeps_the_enabled_flag_and_renames_the_row() {
        let db = created();
        let alarm = Alarm::add(&db, "draft", 8, 0, 0).expect("stored");

        let updated =
            Alarm::update(&db, alarm.id, " updated ", 9, 15, i64::from(ALL_DAYS)).expect("updated");

        assert_eq!(updated.label, "updated");
        assert_eq!((updated.hour, updated.minute), (9, 15));
        assert_eq!(updated.repeat_days, ALL_DAYS);
        assert!(updated.enabled);
    }

    #[test]
    fn alarms_can_be_switched_off_and_removed() {
        let db = created();
        let alarm = Alarm::add(&db, "gym", 18, 30, 0).expect("stored");

        let disabled = Alarm::set_enabled(&db, alarm.id, false).expect("switched off");
        assert!(!disabled.enabled);
        assert_eq!(Alarm::list(&db).expect("list"), [disabled]);

        Alarm::delete(&db, alarm.id).expect("removed");
        assert!(Alarm::list(&db).expect("list").is_empty());
    }

    #[test]
    fn unknown_ids_report_not_found() {
        let db = created();

        for outcome in [
            Alarm::update(&db, 404, "x", 7, 0, 0).map(|_| ()),
            Alarm::set_enabled(&db, 404, true).map(|_| ()),
            Alarm::delete(&db, 404),
        ] {
            assert_eq!(
                outcome.expect_err("unknown alarm").code(),
                ApiCode::NotFound
            );
        }
    }

    #[test]
    fn times_and_masks_outside_the_accepted_range_are_refused() {
        let db = created();

        for (hour, minute, repeat_days) in [
            (-1, 0, 0),
            (24, 0, 0),
            (7, -1, 0),
            (7, 60, 0),
            (7, 0, -1),
            (7, 0, i64::from(ALL_DAYS) + 1),
        ] {
            let error = Alarm::add(&db, "broken", hour, minute, repeat_days)
                .expect_err("the fields are refused");
            assert_eq!(
                error.code(),
                ApiCode::InvalidInput,
                "{hour}:{minute}/{repeat_days}"
            );
        }

        assert!(Alarm::list(&db).expect("list").is_empty());
    }

    #[test]
    fn a_label_longer_than_the_limit_is_refused() {
        let db = created();
        let label = "a".repeat(MAX_LABEL_CHARS + 1);

        let error = Alarm::add(&db, &label, 7, 0, 0).expect_err("the label is too long");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert_eq!(
            Alarm::add(&db, &"a".repeat(MAX_LABEL_CHARS), 7, 0, 0)
                .expect("the limit itself is accepted")
                .label
                .chars()
                .count(),
            MAX_LABEL_CHARS
        );
    }

    #[test]
    fn a_disabled_alarm_never_fires() {
        let db = created();
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&db, "nap", hour, minute, 0).expect("stored");

        assert!(alarm.next_fire(now()).is_some());

        let disabled = Alarm::set_enabled(&db, alarm.id, false).expect("switched off");
        assert_eq!(disabled.next_fire(now()), None);
    }

    #[test]
    fn a_one_off_alarm_fires_at_its_next_occurrence_and_only_once() {
        let db = created();
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&db, "tea", hour, minute, 0).expect("stored");

        let fire = alarm.next_fire(now()).expect("it has a next occurrence");
        assert!(fire > now(), "the answer is in the future");
        assert!(
            fire - now() <= 2 * DAY_SECONDS,
            "a one-off waits at most a day: {} seconds",
            fire - now()
        );
        assert_eq!(
            windows::local_minutes(fire),
            Some(i64::from(alarm.hour) * 60 + i64::from(alarm.minute)),
            "it rings on the time of day it stores"
        );

        // Two minutes later its own instant is behind us; the next occurrence is a day away.
        assert!(alarm.next_fire(fire).expect("the next one") >= fire + DAY_SECONDS);
    }

    #[test]
    fn a_repeating_alarm_fires_on_a_selected_weekday() {
        let db = created();
        let (hour, minute) = clock_in(120);
        let alarm = Alarm::add(&db, "standup", hour, minute, i64::from(ALL_DAYS)).expect("stored");

        let fire = alarm.next_fire(now()).expect("it has a next occurrence");
        assert!(fire > now());
        assert!(
            fire - now() <= DAY_SECONDS,
            "a daily alarm rings within a day"
        );
        assert_eq!(
            windows::local_minutes(fire),
            Some(i64::from(alarm.hour) * 60 + i64::from(alarm.minute))
        );

        let date = windows::local_date(fire).expect("the day has a date");
        assert_ne!(weekday_bit(fire), Some(0));
        assert_eq!(
            alarm.repeat_days & weekday_bit(fire).expect("bit"),
            weekday_bit(fire).expect("bit"),
            "the day it picks is one it repeats on: {date:?}"
        );
    }

    #[test]
    fn an_alarm_repeating_on_another_day_skips_today() {
        let db = created();
        let (hour, minute) = clock_in(120);
        let tomorrow = windows::local_date(now() + DAY_SECONDS).expect("the day has a date");
        let bit = 1 << ((tomorrow.weekday + 6) % 7);
        let alarm = Alarm::add(&db, "weekday", hour, minute, bit).expect("stored");

        let fire = alarm.next_fire(now()).expect("it has a next occurrence");

        assert!(fire > now());
        assert!(
            fire - now() > 0,
            "the alarm does not ring before its weekday"
        );
        assert_eq!(
            windows::local_date(fire).map(|date| date.day),
            Some(tomorrow.day)
        );
    }

    #[test]
    fn every_repeating_alarm_answers_an_instant_it_can_ring_at() {
        let db = created();

        for repeat_days in 0..=i64::from(ALL_DAYS) {
            for hour in [0, 7, 23] {
                let alarm = Alarm::add(&db, "probe", hour, 30, repeat_days).expect("stored");
                let fire = alarm.next_fire(now()).expect("a next occurrence");
                let minutes = windows::local_minutes(fire).expect("the clock is readable");

                assert!(fire > now(), "{repeat_days}/{hour} answered the past");
                assert_eq!(
                    minutes,
                    i64::from(alarm.hour) * 60 + 30,
                    "{repeat_days}/{hour}"
                );
            }
        }
    }

    #[test]
    fn the_defaults_are_ten_seconds_of_toast() {
        assert_eq!(
            AlarmDefaults::default(),
            AlarmDefaults {
                ring_seconds: 10,
                method: Method::Toast,
            }
        );
    }

    #[test]
    fn the_defaults_survive_a_save() {
        let db = created();
        let chosen = AlarmDefaults {
            ring_seconds: 30,
            method: Method::InApp,
        };

        Setting::write_json(&db, DEFAULTS_KEY, &chosen).expect("stored");

        assert_eq!(
            Setting::read_json::<AlarmDefaults>(&db, DEFAULTS_KEY).expect("read back"),
            Some(chosen)
        );
    }

    #[test]
    fn a_ring_duration_outside_the_accepted_range_is_refused() {
        let db = created();

        for ring_seconds in [0, -1, MAX_RING_SECONDS + 1] {
            let error = Setting::write_json(
                &db,
                DEFAULTS_KEY,
                &AlarmDefaults {
                    ring_seconds,
                    method: Method::Toast,
                },
            )
            .expect_err("the duration is refused");

            assert_eq!(error.code(), ApiCode::InvalidInput, "{ring_seconds}");
        }

        assert_eq!(
            Setting::read_json::<AlarmDefaults>(&db, DEFAULTS_KEY).expect("read"),
            None,
            "a refused write leaves no row behind"
        );
    }

    #[test]
    fn the_defaults_serialize_the_way_the_frontend_reads_them() {
        let json = serde_json::to_value(AlarmDefaults {
            ring_seconds: 30,
            method: Method::InApp,
        })
        .expect("serializes");

        assert_eq!(json["ringSeconds"], serde_json::json!(30));
        assert_eq!(json["method"], serde_json::json!("inApp"));
        assert_eq!(
            serde_json::to_value(AlarmDefaults::default()).expect("serializes")["method"],
            serde_json::json!("toast")
        );
    }
}
