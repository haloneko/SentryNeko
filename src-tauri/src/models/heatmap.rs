//! Heatmap buckets: focus time and completed tasks per local day, week or month.

use std::collections::HashMap;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::windows::{self, LocalDate};

/// Granularity of one heatmap bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Granularity {
    Day,
    Week,
    Month,
}

/// One bucket: the local instant it starts at and what happened inside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapBucket {
    /// UTC epoch seconds of the local midnight, Monday or first of the month it starts at.
    pub start: i64,
    /// Seconds of focus from phases that started inside the bucket.
    pub focus_seconds: i64,
    /// Tasks whose `completed_at` falls inside the bucket.
    pub completed_tasks: i64,
}

/// A day and its date, the unit every granularity rolls up from.
#[derive(Debug, Clone, Copy)]
struct Day {
    bucket: HeatmapBucket,
    date: LocalDate,
}

/// Aggregates focus time and completed tasks per bucket over `[from, to)`.
///
/// The rules, in one place:
///
/// - Buckets follow the user's calendar, not UTC: a day starts at local midnight, a week on
///   Monday, a month on the first. The boundary is resolved through the Windows time zone rules,
///   so the two days a year whose clocks move keep the right length.
/// - Every day of the window is answered, empty ones included, so a chart can lay the days out
///   without filling gaps itself.
/// - A focus phase counts with its `actual_seconds` and belongs to the day it started in; a phase
///   that is still running counts once it is closed.
/// - A task counts on the day stored in `completed_at`, so renaming it later does not move it.
/// - The first and last bucket are partial when the window does not line up with the calendar.
pub fn load(
    db: &Db,
    from: i64,
    to: i64,
    granularity: Granularity,
) -> ApiResult<Vec<HeatmapBucket>> {
    if to <= from {
        return Err(ApiError::invalid_input("to must be after from")
            .with_details(format!("received from = {from}, to = {to}")));
    }

    let days = days(db, from, to)?;

    Ok(match granularity {
        Granularity::Day => days.into_iter().map(|day| day.bucket).collect(),
        Granularity::Week => roll_up(&days, Granularity::Week),
        Granularity::Month => roll_up(&days, Granularity::Month),
    })
}

/// Builds one empty bucket per local day of the window, then fills it with the two totals.
fn days(db: &Db, from: i64, to: i64) -> ApiResult<Vec<Day>> {
    let first = local_day(from)?;
    let last = local_day((to - 1).max(from))?;

    let mut days = Vec::new();
    let mut cursor = first;

    loop {
        days.push(Day {
            bucket: HeatmapBucket {
                start: cursor,
                focus_seconds: 0,
                completed_tasks: 0,
            },
            date: windows::local_date(cursor).ok_or_else(boundary_error)?,
        });

        if cursor >= last {
            break;
        }

        cursor = next_day(cursor)?;
    }

    add_focus(db, first, to, &mut days)?;
    add_completed(db, first, to, &mut days)?;

    Ok(days)
}

/// Adds the focus seconds of every closed phase that started inside the window.
fn add_focus(db: &Db, first: i64, to: i64, days: &mut [Day]) -> ApiResult<()> {
    let positions = positions(days);

    let sessions = repository::query_all(
        db,
        "SELECT started_at, actual_seconds FROM pomodoro_sessions
         WHERE phase = 'focus' AND actual_seconds IS NOT NULL AND started_at >= ?1 AND started_at < ?2",
        params![first, to],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;

    for (started_at, seconds) in sessions {
        let day = local_day(started_at)?;

        if let Some(position) = positions.get(&day) {
            days[*position].bucket.focus_seconds += seconds;
        }
    }

    Ok(())
}

/// Counts the tasks whose completion falls inside the window.
fn add_completed(db: &Db, first: i64, to: i64, days: &mut [Day]) -> ApiResult<()> {
    let positions = positions(days);

    let completions = repository::query_all(
        db,
        "SELECT completed_at FROM todos
         WHERE completed = 1 AND completed_at IS NOT NULL
           AND completed_at >= ?1 AND completed_at < ?2
         UNION ALL
         SELECT completed_at FROM todo_completions WHERE completed_at >= ?1 AND completed_at < ?2",
        params![first, to],
        |row| Ok(row.get::<_, i64>(0)?),
    )?;

    for completed_at in completions {
        let day = local_day(completed_at)?;

        if let Some(position) = positions.get(&day) {
            days[*position].bucket.completed_tasks += 1;
        }
    }

    Ok(())
}

/// Position of every day in `days`, keyed by its start.
fn positions(days: &[Day]) -> HashMap<i64, usize> {
    days.iter()
        .enumerate()
        .map(|(position, day)| (day.bucket.start, position))
        .collect()
}

/// Groups the days of the window into weeks or months.
fn roll_up(days: &[Day], granularity: Granularity) -> Vec<HeatmapBucket> {
    let mut buckets = Vec::new();
    let mut index = 0;

    // A leading partial week keeps every following bucket aligned to Monday.
    if granularity == Granularity::Week {
        let offset = leading_days(days[0].date.weekday);

        if offset > 0 {
            let end = offset.min(days.len());
            buckets.push(sum(&days[..end]));
            index = end;
        }
    }

    while index < days.len() {
        let end = match granularity {
            Granularity::Week => (index + 7).min(days.len()),
            Granularity::Month => month_end(days, index),
            Granularity::Day => index + 1,
        };

        buckets.push(sum(&days[index..end]));
        index = end;
    }

    buckets
}

/// Days left before the next Monday, `weekday` being `0` for Sunday as Windows counts it.
fn leading_days(weekday: u16) -> usize {
    usize::from((8 - weekday) % 7)
}

/// One past the last day sharing the month of `days[index]`.
fn month_end(days: &[Day], index: usize) -> usize {
    let year = days[index].date.year;
    let month = days[index].date.month;
    let mut end = index + 1;

    while end < days.len() && days[end].date.year == year && days[end].date.month == month {
        end += 1;
    }

    end
}

/// Merges the days of one bucket, keeping the start of the first.
fn sum(days: &[Day]) -> HeatmapBucket {
    HeatmapBucket {
        start: days[0].bucket.start,
        focus_seconds: days.iter().map(|day| day.bucket.focus_seconds).sum(),
        completed_tasks: days.iter().map(|day| day.bucket.completed_tasks).sum(),
    }
}

/// Local midnight of the day after `day_start`.
fn next_day(day_start: i64) -> ApiResult<i64> {
    // A day can be 25 hours long when its clock falls back, so probing exactly 24 hours ahead can
    // land inside the same day; the probe then walks on until it crosses the boundary.
    for hours in 24..=48 {
        if let Some(candidate) = windows::local_midnight(day_start + hours * 3_600) {
            if candidate > day_start {
                return Ok(candidate);
            }
        }
    }

    Err(boundary_error())
}

/// Local midnight of the day `seconds` falls in.
fn local_day(seconds: i64) -> ApiResult<i64> {
    windows::local_midnight(seconds).ok_or_else(boundary_error)
}

fn boundary_error() -> ApiError {
    ApiError::internal("the local day boundary could not be resolved")
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

    fn today() -> i64 {
        local_day(crate::utils::time::now_seconds()).expect("today has a start")
    }

    fn date(month: u16, day: u16, weekday: u16) -> LocalDate {
        LocalDate {
            year: 2026,
            month,
            day,
            weekday,
        }
    }

    /// A day carrying only what a roll-up looks at.
    fn day(start: i64, weekday: u16, focus_seconds: i64, completed_tasks: i64) -> Day {
        Day {
            bucket: HeatmapBucket {
                start,
                focus_seconds,
                completed_tasks,
            },
            date: date(10, 1, weekday),
        }
    }

    fn store_focus(db: &Db, started_at: i64, actual_seconds: Option<i64>) {
        repository::insert(
            db,
            "INSERT INTO pomodoro_sessions (phase, planned_seconds, actual_seconds, started_at, ended_at)
             VALUES ('focus', 1500, ?1, ?2, ?2)",
            params![actual_seconds, started_at],
        )
        .expect("session is stored");
    }

    fn store_completion(db: &Db, completed_at: i64) {
        repository::insert(
            db,
            "INSERT INTO todos (title, completed, completed_at, created_at, updated_at)
             VALUES ('done', 1, ?1, ?1, ?1)",
            params![completed_at],
        )
        .expect("todo is stored");
    }

    #[test]
    fn a_day_bucket_carries_the_focus_and_the_tasks_of_its_day() {
        let db = created();
        let today = today();

        store_focus(&db, today + 60, Some(600));
        store_focus(&db, today + 600, Some(300));
        store_focus(&db, today + 900, None);
        store_completion(&db, today + 120);
        // Outside the window: yesterday's rows must not leak into today.
        store_focus(&db, today - 60, Some(1_500));
        store_completion(&db, today - 60);

        let buckets = load(&db, today, today + 1_000, Granularity::Day).expect("heatmap");

        assert_eq!(
            buckets,
            [HeatmapBucket {
                start: today,
                focus_seconds: 900,
                completed_tasks: 1,
            }]
        );
    }

    #[test]
    fn the_window_covers_every_day_in_between() {
        let db = created();
        let today = today();
        let yesterday = local_day(today - 60).expect("yesterday has a start");

        let buckets = load(&db, yesterday, today + 1_000, Granularity::Day).expect("heatmap");

        assert_eq!(buckets.len(), 2, "an empty day is still answered");
        assert_eq!(buckets[0].start, yesterday);
        assert_eq!(buckets[1].start, today);
    }

    #[test]
    fn weeks_roll_up_to_monday_and_months_to_the_first() {
        let db = created();
        let today = today();
        let days = days(&db, today - 3 * 86_400, today + 3_600).expect("days");

        for granularity in [Granularity::Week, Granularity::Month] {
            let buckets =
                load(&db, today - 3 * 86_400, today + 3_600, granularity).expect("heatmap");
            let summed: i64 = buckets.iter().map(|bucket| bucket.focus_seconds).sum();

            assert!(!buckets.is_empty(), "{granularity:?}");
            assert_eq!(summed, 0, "{granularity:?} keeps the totals");
            assert!(
                buckets.windows(2).all(|pair| pair[0].start < pair[1].start),
                "{granularity:?} is ordered"
            );
            assert!(
                days.len() >= buckets.len(),
                "{granularity:?} only merges days"
            );
        }
    }

    #[test]
    fn a_leading_partial_week_is_kept_apart() {
        // Wednesday first: it and the four days up to Sunday are partial, Monday starts a week.
        let days = [
            day(0, 3, 10, 0),
            day(1, 4, 20, 1),
            day(2, 5, 30, 0),
            day(3, 6, 40, 0),
            day(4, 0, 50, 0),
            day(5, 1, 60, 0),
            day(6, 2, 70, 0),
            day(7, 3, 80, 0),
            day(8, 4, 90, 0),
        ];

        let buckets = roll_up(&days, Granularity::Week);

        assert_eq!(buckets.len(), 2);
        assert_eq!(
            buckets[0],
            HeatmapBucket {
                start: 0,
                focus_seconds: 150,
                completed_tasks: 1,
            }
        );
        assert_eq!(
            buckets[1],
            HeatmapBucket {
                start: 5,
                focus_seconds: 300,
                completed_tasks: 0,
            }
        );
    }

    #[test]
    fn every_week_after_the_lead_starts_on_a_monday() {
        // A Monday first means no leading bucket at all.
        let days: Vec<Day> = (0..14)
            .map(|index| day(index, (1 + index as u16 % 7) % 7, 0, 0))
            .collect();

        let buckets = roll_up(&days, Granularity::Week);

        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].start, 0);
        assert_eq!(buckets[1].start, 7);
    }

    #[test]
    fn a_month_break_starts_a_new_bucket() {
        let mut days = vec![day(0, 4, 10, 1), day(1, 5, 20, 0), day(2, 6, 30, 0)];
        days[1].date = date(10, 31, 5);
        days[2].date = date(11, 1, 6);

        let buckets = roll_up(&days, Granularity::Month);

        assert_eq!(buckets.len(), 2);
        assert_eq!(buckets[0].focus_seconds, 30);
        assert_eq!(buckets[0].completed_tasks, 1);
        assert_eq!(buckets[1].start, 2);
        assert_eq!(buckets[1].focus_seconds, 30);
    }

    #[test]
    fn an_empty_window_is_refused() {
        let db = created();

        let error = load(&db, 500, 500, Granularity::Day).expect_err("empty window");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
