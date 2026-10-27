//! Focus time in hourly buckets: how many seconds of each hour were spent in a focus phase, filed
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

/// One category's focus time inside a window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusCategory {
    /// The category the stretch was started under; empty for the work nobody named.
    pub category: String,
    /// Seconds of focus filed under it.
    pub seconds: i64,
}

/// One category's focus time inside one hour, as the stacked hourly chart draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusCategoryHour {
    /// UTC epoch seconds of the hour's start.
    pub hour_start: i64,
    /// The category the stretch was started under; empty for the work nobody named.
    pub category: String,
    /// Seconds of that hour filed under the category.
    pub seconds: i64,
}
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FocusFile {
    /// The category the seconds belong to; empty for the work nobody named.
    pub category: String,
}

impl FocusFile {
    pub const MAX_CATEGORY_CHARS: usize = 64;

    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Files the seconds under `category`.
    #[must_use]
    pub fn under(mut self, category: impl Into<String>) -> Self {
        self.category = category.into();
        self
    }

    pub fn parse(category: Option<&str>) -> ApiResult<Self> {
        let trimmed = category.unwrap_or_default().trim();
        let length = trimmed.chars().count();

        if length > Self::MAX_CATEGORY_CHARS {
            return Err(ApiError::invalid_input(format!(
                "category must be at most {} characters",
                Self::MAX_CATEGORY_CHARS
            ))
            .with_details(format!("received {length}")));
        }

        Ok(Self::new().under(trimmed))
    }
}

/// The hourly buckets a focus stretch is written into.
pub struct FocusUsage;

impl FocusUsage {
    /// The hour `instant` falls in, as UTC epoch seconds.
    #[must_use]
    pub fn hour_of(instant: i64) -> i64 {
        instant - instant.rem_euclid(HOUR_SECONDS)
    }

    pub fn record(db: &Db, hour_start: i64, seconds: i64, file: &FocusFile) -> ApiResult<()> {
        if seconds <= 0 {
            return Ok(());
        }

        repository::execute(
            db,
            "INSERT INTO focus_usage_hours (hour_start, category, seconds)
             VALUES (?1, ?2, MIN(?3, 3600))
             ON CONFLICT (hour_start, category)
             DO UPDATE SET seconds = MIN(seconds + excluded.seconds, 3600)",
            params![hour_start, file.category, seconds],
        )?;

        Ok(())
    }


    pub fn record_span(db: &Db, from: i64, to: i64, file: &FocusFile) -> ApiResult<()> {
        let mut cursor = from;

        while cursor < to {
            let hour = Self::hour_of(cursor);
            let end = (hour + HOUR_SECONDS).min(to);

            Self::record(db, hour, end - cursor, file)?;
            cursor = end;
        }

        Ok(())
    }

    /// Total focused seconds in `[from, to)`, whatever categories they were filed under.
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

    /// Every non-empty hour in `[from, to)`, oldest first and summed over its categories.
    pub fn hours(db: &Db, from: i64, to: i64) -> ApiResult<Vec<(i64, i64)>> {
        repository::query_all(
            db,
            "SELECT hour_start, SUM(seconds) FROM focus_usage_hours
             WHERE hour_start >= ?1 AND hour_start < ?2 AND seconds > 0
             GROUP BY hour_start
             ORDER BY hour_start",
            params![Self::hour_of(from), to],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    /// How much of `[from, to)` each category took, busiest first; the unnamed category sorts by its
    /// own name like any other.
    pub fn categories(db: &Db, from: i64, to: i64) -> ApiResult<Vec<FocusCategory>> {
        if to <= from {
            return Err(ApiError::invalid_input("to must be after from")
                .with_details(format!("received from = {from}, to = {to}")));
        }

        repository::query_all(
            db,
            "SELECT category, SUM(seconds) AS total FROM focus_usage_hours
             WHERE hour_start >= ?1 AND hour_start < ?2 AND seconds > 0
             GROUP BY category
             ORDER BY total DESC, category",
            params![Self::hour_of(from), to],
            |row| {
                Ok(FocusCategory {
                    category: row.get(0)?,
                    seconds: row.get(1)?,
                })
            },
        )
    }

    /// Every non-empty bucket in `[from, to)`, oldest first; an hour that held more than one
    /// category answers once per category, so the chart can stack them.
    pub fn hours_by_category(db: &Db, from: i64, to: i64) -> ApiResult<Vec<FocusCategoryHour>> {
        repository::query_all(
            db,
            "SELECT hour_start, category, seconds FROM focus_usage_hours
             WHERE hour_start >= ?1 AND hour_start < ?2 AND seconds > 0
             ORDER BY hour_start, category",
            params![Self::hour_of(from), to],
            |row| {
                Ok(FocusCategoryHour {
                    hour_start: row.get(0)?,
                    category: row.get(1)?,
                    seconds: row.get(2)?,
                })
            },
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
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    /// The file a test that says nothing about its focus uses.
    fn unnamed() -> FocusFile {
        FocusFile::default()
    }

    #[test]
    fn a_span_is_split_at_the_hour_it_crosses() {
        let db = created();

        // Ten seconds before the hour, an hour, and a hundred seconds into the next.
        FocusUsage::record_span(&db, 3_590, 7_300, &unnamed()).expect("recorded");

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
        FocusUsage::record_span(&db, 3_590, 3_650, &unnamed()).expect("recorded");

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

        FocusUsage::record(&db, 0, 3_500, &unnamed()).expect("recorded");
        FocusUsage::record(&db, 0, 3_500, &unnamed()).expect("recorded again");

        assert_eq!(
            FocusUsage::hours(&db, 0, 3_600).expect("hours"),
            [(0, 3_600)]
        );
    }

    #[test]
    fn nothing_is_recorded_for_an_empty_or_backwards_span() {
        let db = created();

        FocusUsage::record_span(&db, 100, 100, &unnamed()).expect("an empty span is fine");
        FocusUsage::record_span(&db, 200, 100, &unnamed()).expect("a backwards span is fine");

        assert!(FocusUsage::hours(&db, 0, 3_600).expect("hours").is_empty());
    }

    #[test]
    fn one_hour_holds_each_category_separately_and_reads_back_as_a_total() {
        let db = created();

        FocusUsage::record_span(&db, 3_500, 3_540, &FocusFile::new().under("writing"))
            .expect("recorded");
        FocusUsage::record_span(&db, 3_540, 3_560, &FocusFile::new().under("reading"))
            .expect("recorded");
        FocusUsage::record_span(&db, 3_560, 3_565, &unnamed()).expect("recorded");

        assert_eq!(
            FocusUsage::hours(&db, 0, 3_600).expect("hours"),
            [(0, 65)],
            "the chart draws the hour, not the categories"
        );
        assert_eq!(
            FocusUsage::categories(&db, 0, 3_600).expect("categories"),
            [
                FocusCategory {
                    category: "writing".to_owned(),
                    seconds: 40,
                },
                FocusCategory {
                    category: "reading".to_owned(),
                    seconds: 20,
                },
                FocusCategory {
                    category: String::new(),
                    seconds: 5,
                },
            ],
            "busiest first, the unnamed work among them"
        );
    }

    #[test]
    fn a_category_never_reports_more_than_its_own_hour() {
        let db = created();

        FocusUsage::record(&db, 0, 2_000, &FocusFile::new().under("writing")).expect("recorded");
        FocusUsage::record(&db, 0, 2_000, &FocusFile::new().under("writing"))
            .expect("recorded again");
        FocusUsage::record(&db, 0, 2_000, &FocusFile::new().under("reading")).expect("recorded");

        assert_eq!(
            FocusUsage::categories(&db, 0, 3_600).expect("categories"),
            [
                FocusCategory {
                    category: "writing".to_owned(),
                    seconds: 3_600,
                },
                FocusCategory {
                    category: "reading".to_owned(),
                    seconds: 2_000,
                },
            ],
            "each category is capped by the hour it sits in"
        );
    }

    #[test]
    fn a_window_without_focus_answers_no_categories() {
        let db = created();

        assert!(FocusUsage::categories(&db, 0, 3_600)
            .expect("categories")
            .is_empty());
        assert_eq!(
            FocusUsage::categories(&db, 3_600, 3_600)
                .expect_err("a backwards window is refused")
                .code(),
            ApiCode::InvalidInput
        );
    }

    #[test]
    fn an_hour_answers_once_per_category_it_held() {
        let db = created();

        FocusUsage::record_span(&db, 3_500, 3_540, &FocusFile::new().under("writing"))
            .expect("recorded");
        FocusUsage::record_span(&db, 3_540, 3_560, &FocusFile::new().under("reading"))
            .expect("recorded");
        FocusUsage::record_span(&db, 3_560, 3_565, &unnamed()).expect("recorded");
        FocusUsage::record_span(&db, 3_660, 3_700, &FocusFile::new().under("writing"))
            .expect("recorded");

        assert_eq!(
            FocusUsage::hours_by_category(&db, 0, 7_200).expect("buckets"),
            [
                FocusCategoryHour {
                    hour_start: 0,
                    category: String::new(),
                    seconds: 5,
                },
                FocusCategoryHour {
                    hour_start: 0,
                    category: "reading".to_owned(),
                    seconds: 20,
                },
                FocusCategoryHour {
                    hour_start: 0,
                    category: "writing".to_owned(),
                    seconds: 40,
                },
                FocusCategoryHour {
                    hour_start: 3_600,
                    category: "writing".to_owned(),
                    seconds: 40,
                },
            ],
            "oldest hour first, its categories in name order"
        );
    }

    #[test]
    fn a_file_is_trimmed_and_an_absent_category_is_the_unnamed_work() {
        assert_eq!(FocusFile::parse(None).expect("parsed"), unnamed());
        assert_eq!(FocusFile::parse(Some("   ")).expect("parsed"), unnamed());
        assert_eq!(
            FocusFile::parse(Some("  写文档  ")).expect("parsed"),
            FocusFile::new().under("写文档")
        );
    }

    #[test]
    fn a_category_longer_than_the_column_allows_is_refused() {
        let longest = "写".repeat(FocusFile::MAX_CATEGORY_CHARS);

        assert_eq!(
            FocusFile::parse(Some(longest.as_str())).expect("parsed"),
            FocusFile::new().under(longest)
        );

        let too_long = "写".repeat(FocusFile::MAX_CATEGORY_CHARS + 1);
        let error = FocusFile::parse(Some(too_long.as_str())).expect_err("too long");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
