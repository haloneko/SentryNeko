//! Calendar schedules for recurring tasks, anchored to the original creation date.

use serde::{Deserialize, Serialize};

use crate::utils::response::{ApiError, ApiResult};
use crate::utils::windows;

/// Calendar unit of a repeat interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecurrenceUnit {
    Day,
    Week,
    Month,
}

impl RecurrenceUnit {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }
}

/// Every `interval` calendar units; `None` on a task means it never repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recurrence {
    pub unit: RecurrenceUnit,
    pub interval: u16,
}

impl Recurrence {
    /// Bounds custom intervals before they reach calendar arithmetic or storage.
    pub fn validate(self) -> ApiResult<Self> {
        if !(1..=365).contains(&self.interval) {
            return Err(ApiError::invalid_input(
                "recurrence interval must be between 1 and 365",
            ));
        }

        Ok(self)
    }

    /// Reads the normalized database representation.
    pub fn from_storage(unit: &str, interval: u16) -> ApiResult<Self> {
        let unit = match unit {
            "day" => RecurrenceUnit::Day,
            "week" => RecurrenceUnit::Week,
            "month" => RecurrenceUnit::Month,
            _ => return Err(ApiError::internal("unknown stored recurrence unit")),
        };

        Self { unit, interval }.validate()
    }

    /// Current cycle start and next boundary at `now`, without replaying missed cycles.
    ///
    /// All boundaries are computed from `anchor`: January 31 therefore leads to February's last
    /// day and then March 31. Binary search also keeps a long absence cheap.
    pub fn cycle_at(self, anchor: i64, now: i64) -> ApiResult<(i64, i64)> {
        self.validate()?;
        let mut high = 1i64;

        while self.boundary(anchor, high)? <= now {
            high = high.checked_mul(2).ok_or_else(calendar_error)?;
        }

        let mut low = 0;
        while low + 1 < high {
            let middle = low + (high - low) / 2;
            if self.boundary(anchor, middle)? <= now {
                low = middle;
            } else {
                high = middle;
            }
        }

        let start = if low == 0 {
            anchor
        } else {
            self.boundary(anchor, low)?
        };
        Ok((start, self.boundary(anchor, high)?))
    }

    fn boundary(self, anchor: i64, cycle: i64) -> ApiResult<i64> {
        let amount = cycle
            .checked_mul(i64::from(self.interval))
            .ok_or_else(calendar_error)?;
        let (days, months) = match self.unit {
            RecurrenceUnit::Day => (amount, 0),
            RecurrenceUnit::Week => (amount.checked_mul(7).ok_or_else(calendar_error)?, 0),
            RecurrenceUnit::Month => (0, amount),
        };

        windows::shift_local_midnight(anchor, days, months).ok_or_else(calendar_error)
    }
}

fn calendar_error() -> ApiError {
    ApiError::internal("the recurring task's calendar boundary could not be resolved")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(year: u16, month: u16, day: u16) -> i64 {
        windows::calendar_midnight(year, month, day).expect("a local date")
    }

    fn rule(unit: RecurrenceUnit, interval: u16) -> Recurrence {
        Recurrence { unit, interval }
    }

    #[test]
    fn daily_and_weekly_boundaries_follow_the_local_calendar() {
        let anchor = local(2026, 10, 18) + 3_600;
        for (unit, interval, next) in [
            (RecurrenceUnit::Day, 1, local(2026, 10, 19)),
            (RecurrenceUnit::Week, 1, local(2026, 10, 25)),
            (RecurrenceUnit::Day, 3, local(2026, 10, 21)),
            (RecurrenceUnit::Week, 2, local(2026, 11, 1)),
        ] {
            assert_eq!(
                rule(unit, interval)
                    .cycle_at(anchor, anchor)
                    .expect("cycle"),
                (anchor, next)
            );
        }
    }

    #[test]
    fn monthly_boundaries_clamp_without_losing_the_original_day() {
        for (year, february_day) in [(2024, 29), (2025, 28)] {
            let anchor = local(year, 1, 31);
            let schedule = rule(RecurrenceUnit::Month, 1);
            assert_eq!(
                schedule.cycle_at(anchor, anchor).expect("cycle").1,
                local(year, 2, february_day)
            );
            assert_eq!(
                schedule
                    .cycle_at(anchor, local(year, 2, february_day))
                    .expect("cycle"),
                (local(year, 2, february_day), local(year, 3, 31))
            );
        }
        let anchor = local(2025, 12, 31);
        assert_eq!(
            rule(RecurrenceUnit::Month, 2)
                .cycle_at(anchor, anchor)
                .expect("cycle")
                .1,
            local(2026, 2, 28)
        );
    }

    #[test]
    fn a_long_absence_skips_to_the_current_cycle_and_respects_exact_boundaries() {
        let anchor = local(2020, 1, 1);
        let now = local(2026, 10, 18);
        assert_eq!(
            rule(RecurrenceUnit::Day, 1)
                .cycle_at(anchor, now)
                .expect("cycle"),
            (now, local(2026, 10, 19))
        );
        assert_eq!(
            rule(RecurrenceUnit::Month, 1)
                .cycle_at(anchor, now)
                .expect("cycle"),
            (local(2026, 10, 1), local(2026, 11, 1))
        );
    }

    #[test]
    fn zero_and_excessive_intervals_are_rejected() {
        assert!(rule(RecurrenceUnit::Day, 0).validate().is_err());
        assert!(rule(RecurrenceUnit::Month, 366).validate().is_err());
    }

    #[test]
    fn daily_boundaries_stay_at_midnight_around_daylight_saving_dates() {
        for (month, day, next_day) in [(3, 8, 9), (11, 1, 2)] {
            let boundary = local(2026, month, day);
            let anchor = boundary - 3_600;
            let (start, next) = rule(RecurrenceUnit::Day, 1)
                .cycle_at(anchor, boundary)
                .expect("cycle");
            assert_eq!(start, boundary);
            assert_eq!(next, local(2026, month, next_day));
            assert_eq!(windows::local_minutes(next), Some(0));
        }
    }
}
