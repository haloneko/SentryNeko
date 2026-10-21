//! Focus time in hourly buckets: how many seconds of each hour were spent in a focus phase.
//!
//! The shape matches `app_usage_hours` and for the same reason: the minute tick adds to the
//! bucket as the phase runs, so reading a day is one sum, and a crash costs at most the current
//! minute instead of a whole session.

use rusqlite::params;
use serde::Serialize;

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};

/// Seconds in one hour.
const HOUR_SECONDS: i64 = 3_600;

/// One hour of focus as the hourly chart draws it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusHour {
    /// UTC epoch seconds of the hour's start.
    pub hour_start: i64,
    /// Seconds of that hour spent in a focus phase.
    pub seconds: i64,
}

/// The hourly buckets a focus stretch is written into.
pub struct FocusUsage;

impl FocusUsage {
    /// The hour `instant` falls in, as UTC epoch seconds.
    #[must_use]
    pub fn hour_of(instant: i64) -> i64 {
        instant - instant.rem_euclid(HOUR_SECONDS)
    }

    /// Adds `seconds` to one hour's bucket, never past the hour itself.
    pub fn record(db: &Db, hour_start: i64, seconds: i64) -> ApiResult<()> {
        if seconds <= 0 {
            return Ok(());
        }

        let stored = repository::query_optional(
            db,
            "SELECT seconds FROM focus_usage_hours WHERE hour_start = ?1",
            [hour_start],
            |row| Ok(row.get::<_, i64>(0)?),
        )?;

        match stored {
            Some(current) => {
                repository::execute(
                    db,
                    "UPDATE focus_usage_hours SET seconds = ?1 WHERE hour_start = ?2",
                    params![(current + seconds).min(HOUR_SECONDS), hour_start],
                )?;
            }
            None => {
                repository::execute(
                    db,
                    "INSERT INTO focus_usage_hours (hour_start, seconds) VALUES (?1, ?2)",
                    params![hour_start, seconds.min(HOUR_SECONDS)],
                )?;
            }
        }

        Ok(())
    }

    /// Splits `[from, to)` at every hour boundary and records each piece.
    ///
    /// A stretch that crosses an hour contributes to both buckets, so an hour never reports more
    /// time than it has.
    pub fn record_span(db: &Db, from: i64, to: i64) -> ApiResult<()> {
        let mut cursor = from;

        while cursor < to {
            let hour = Self::hour_of(cursor);
            let end = (hour + HOUR_SECONDS).min(to);

            Self::record(db, hour, end - cursor)?;
            cursor = end;
        }

        Ok(())
    }

    /// Total focused seconds in `[from, to)`.
    pub fn total(db: &Db, from: i64, to: i64) -> ApiResult<i64> {
        if to <= from {
            return Err(ApiError::invalid_input("to must be after from")
                .with_details(format!("received from = {from}, to = {to}")));
        }

        repository::query_one(
            db,
            "SELECT COALESCE(SUM(seconds), 0) FROM focus_usage_hours
             WHERE hour_start >= ?1 AND hour_start < ?2",
            params![Self::hour_of(from), to],
            |row| Ok(row.get(0)?),
        )
    }

    /// Every non-empty bucket in `[from, to)`, oldest first.
    pub fn hours(db: &Db, from: i64, to: i64) -> ApiResult<Vec<(i64, i64)>> {
        repository::query_all(
            db,
            "SELECT hour_start, seconds FROM focus_usage_hours
             WHERE hour_start >= ?1 AND hour_start < ?2 AND seconds > 0
             ORDER BY hour_start",
            params![Self::hour_of(from), to],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    /// The same buckets, named for the JSON the hourly chart reads.
    pub fn hourly(db: &Db, from: i64, to: i64) -> ApiResult<Vec<FocusHour>> {
        Ok(Self::hours(db, from, to)?
            .into_iter()
            .map(|(hour_start, seconds)| FocusHour {
                hour_start,
                seconds,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn a_span_is_split_at_the_hour_it_crosses() {
        let db = created();

        // Ten seconds before the hour, an hour, and a hundred seconds into the next.
        FocusUsage::record_span(&db, 3_590, 7_300).expect("recorded");

        assert_eq!(
            FocusUsage::hours(&db, 0, 10_800).expect("hours"),
            [(0, 10), (3_600, 3_600), (7_200, 100)]
        );
        assert_eq!(
            FocusUsage::total(&db, 0, 7_300).expect("total"),
            3_710,
            "ten, a full hour and a hundred seconds all count"
        );
    }

    #[test]
    fn the_hourly_rows_name_the_buckets_the_chart_draws() {
        let db = created();
        FocusUsage::record_span(&db, 3_590, 3_650).expect("recorded");

        assert_eq!(
            FocusUsage::hourly(&db, 0, 7_200).expect("hours"),
            [
                FocusHour {
                    hour_start: 0,
                    seconds: 10,
                },
                FocusHour {
                    hour_start: 3_600,
                    seconds: 50,
                },
            ]
        );
    }

    #[test]
    fn an_hour_never_reports_more_than_it_has() {
        let db = created();

        FocusUsage::record(&db, 0, 3_500).expect("recorded");
        FocusUsage::record(&db, 0, 3_500).expect("recorded again");

        assert_eq!(
            FocusUsage::hours(&db, 0, 3_600).expect("hours"),
            [(0, 3_600)]
        );
    }

    #[test]
    fn nothing_is_recorded_for_an_empty_or_backwards_span() {
        let db = created();

        FocusUsage::record_span(&db, 100, 100).expect("an empty span is fine");
        FocusUsage::record_span(&db, 200, 100).expect("a backwards span is fine");

        assert!(FocusUsage::hours(&db, 0, 3_600).expect("hours").is_empty());
    }
}
