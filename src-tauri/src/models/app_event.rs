//! Foreground application event model: one continuous stretch of one app in the foreground.

use std::collections::BTreeMap;

use rusqlite::{params, Row};
use serde::Serialize;

use crate::db::connection::Db;
use crate::db::repository;
use crate::utils::response::{ApiError, ApiResult};

/// Columns every query selects, in the order [`AppEvent::from_row`] reads them.
const COLUMNS: &str = "id, app_name, window_title, started_at, ended_at";

/// Processes that paint the lock screen and the sign-in prompt; time there is not usage.
const LOCK_SHELLS: [&str; 2] = ["LockApp", "LogonUI"];

/// Longest ranking the usage query answers with.
const MAX_RANKING: i64 = 50;

/// Seconds one hour holds, which is also the most a bucket may hold.
pub const HOUR_SECONDS: i64 = 3_600;

/// Longest page the stream answers with.
const MAX_PAGE: i64 = 100;

/// One `app_events` row.
///
/// A row opens when an app reaches the foreground and closes when another one takes over, so
/// `ended_at` stays `None` for as long as the app stays in front. Windows of the application
/// itself are never recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    pub id: i64,
    pub app_name: String,
    pub window_title: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

impl AppEvent {
    /// Maps one `app_events` row selected with [`COLUMNS`].
    pub fn from_row(row: &Row<'_>) -> ApiResult<Self> {
        Ok(Self {
            id: row.get(0)?,
            app_name: row.get(1)?,
            window_title: row.get(2)?,
            started_at: row.get(3)?,
            ended_at: row.get(4)?,
        })
    }

    /// Opens a row at `started_at`; the caller supplies the instant it observed the switch.
    pub fn open(
        db: &Db,
        app_name: &str,
        window_title: Option<&str>,
        started_at: i64,
    ) -> ApiResult<Self> {
        let app_name = app_name.trim();

        if app_name.is_empty() {
            return Err(ApiError::invalid_input("appName must not be empty"));
        }

        let id = repository::insert(
            db,
            "INSERT INTO app_events (app_name, window_title, started_at) VALUES (?1, ?2, ?3)",
            params![app_name, window_title, started_at],
        )?;

        Self::find(db, id)
    }

    /// Closes an open row at `ended_at`; a row that is already closed is `NOT_FOUND`.
    pub fn close(db: &Db, id: i64, ended_at: i64) -> ApiResult<Self> {
        let changed = repository::execute(
            db,
            "UPDATE app_events SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![ended_at, id],
        )?;

        if changed == 0 {
            return Err(AppEvent::missing(id));
        }

        Self::find(db, id)
    }

    /// Replaces the window title of an open row.
    ///
    /// A title change inside the same app — a new browser tab, a document saved under a new
    /// name, a player rewriting its caption every second — updates the row instead of splitting
    /// it, so one row stays one app stretch.
    pub fn retitle(db: &Db, id: i64, window_title: Option<&str>) -> ApiResult<Self> {
        let changed = repository::execute(
            db,
            "UPDATE app_events SET window_title = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![window_title, id],
        )?;

        if changed == 0 {
            return Err(AppEvent::missing(id));
        }

        Self::find(db, id)
    }

    /// One page of the stream, newest first; `before` is the id the previous page ended at.
    ///
    /// Paging on the id rather than an offset keeps the next page stable while the collector
    /// inserts rows: a row that arrives after the first page is newer than every id already
    /// handed out, so it cannot shift the rows of the next page.
    pub fn page(db: &Db, before: Option<i64>, limit: i64) -> ApiResult<AppEventPage> {
        let limit = limit.clamp(1, MAX_PAGE);
        let rows = repository::query_all(
            db,
            &format!(
                "SELECT {COLUMNS} FROM app_events
                 WHERE ?1 IS NULL OR id < ?1
                 ORDER BY started_at DESC, id DESC
                 LIMIT {}",
                limit + 1
            ),
            params![before],
            Self::from_row,
        )?;
        let more = rows.len() as i64 > limit;

        Ok(AppEventPage {
            events: rows.into_iter().take(limit as usize).collect(),
            more,
        })
    }

    /// Returns one row; a missing id is `NOT_FOUND`.
    pub fn find(db: &Db, id: i64) -> ApiResult<Self> {
        repository::query_one(
            db,
            &format!("SELECT {COLUMNS} FROM app_events WHERE id = ?1"),
            [id],
            Self::from_row,
        )
    }

    fn missing(id: i64) -> ApiError {
        ApiError::not_found(format!("no open app event with id {id}"))
    }
}

/// One line of the usage ranking: an application and the seconds it was in front.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    /// Executable file name without its extension, e.g. `chrome`.
    pub app_name: String,
    /// Seconds inside the window, merged over every row of that app.
    pub seconds: i64,
}

impl AppUsage {
    /// The hour `instant` falls in, as UTC epoch seconds.
    #[must_use]
    pub fn hour_of(instant: i64) -> i64 {
        instant - instant.rem_euclid(HOUR_SECONDS)
    }

    /// Adds `seconds` to the bucket of `app_name` in the hour starting at `hour_start`.
    ///
    /// The stored sum is cut at [`HOUR_SECONDS`]: an hour cannot hold more seconds than it has, so a
    /// clock that jumps or a stretch charged twice cannot push a row past its own length.
    pub fn record(db: &Db, app_name: &str, hour_start: i64, seconds: i64) -> ApiResult<()> {
        if seconds <= 0 {
            return Ok(());
        }

        repository::execute(
            db,
            "INSERT INTO app_usage_hours (app_name, hour_start, seconds) VALUES (?1, ?2, MIN(?3, ?4))
             ON CONFLICT (app_name, hour_start) DO UPDATE
                SET seconds = MIN(?4, seconds + excluded.seconds)",
            params![app_name, hour_start, seconds, HOUR_SECONDS],
        )?;

        Ok(())
    }

    /// Ranks applications by the seconds recorded in the buckets inside `[from, to)`.
    ///
    /// A window is counted in whole hours: the hour `from` falls in counts in full. That is exact for
    /// the presets the page asks for, which all start at local midnight, and off by at most the part
    /// of an hour for anything else.
    pub fn ranking(db: &Db, from: i64, to: i64, limit: i64) -> ApiResult<Vec<Self>> {
        if to <= from {
            return Err(ApiError::invalid_input("to must be after from")
                .with_details(format!("received from = {from}, to = {to}")));
        }

        let limit = limit.clamp(1, MAX_RANKING);

        repository::query_all(
            db,
            &format!(
                "SELECT app_name, SUM(seconds) AS seconds
                 FROM app_usage_hours
                 WHERE hour_start >= ?1 AND hour_start < ?2
                   AND app_name NOT IN (?3, ?4)
                 GROUP BY app_name
                 HAVING seconds > 0
                 ORDER BY seconds DESC, app_name ASC
                 LIMIT {limit}"
            ),
            params![Self::hour_of(from), to, LOCK_SHELLS[0], LOCK_SHELLS[1]],
            |row| {
                Ok(Self {
                    app_name: row.get(0)?,
                    seconds: row.get(1)?,
                })
            },
        )
    }

    /// Folds the stored events into buckets, once, for a database that predates them.
    ///
    /// Only a database whose buckets are still empty is folded into: running this again would add the
    /// same seconds twice, so the emptiness is what keeps it a one-time move. Rows without an end are
    /// left out — an unclosed row is what a killed process leaves behind, and guessing it ran until
    /// now is the mistake the buckets exist to stop repeating.
    pub fn backfill(db: &Db, now: i64) -> ApiResult<usize> {
        let recorded: i64 =
            repository::query_one(db, "SELECT COUNT(*) FROM app_usage_hours", [], |row| {
                Ok(row.get(0)?)
            })?;

        if recorded > 0 {
            return Ok(0);
        }

        let events = repository::query_all(
            db,
            "SELECT app_name, started_at, ended_at FROM app_events
             WHERE ended_at IS NOT NULL AND ended_at > started_at",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )?;

        let mut buckets: BTreeMap<(String, i64), i64> = BTreeMap::new();

        for (app_name, started_at, ended_at) in events {
            if LOCK_SHELLS.contains(&app_name.as_str()) {
                continue;
            }

            let end = ended_at.min(now);
            let mut cursor = started_at;

            while cursor < end {
                let hour_start = Self::hour_of(cursor);
                let slice_end = (hour_start + HOUR_SECONDS).min(end);

                *buckets.entry((app_name.clone(), hour_start)).or_insert(0) += slice_end - cursor;
                cursor = slice_end;
            }
        }

        let written = buckets.len();

        for ((app_name, hour_start), seconds) in buckets {
            Self::record(db, &app_name, hour_start, seconds)?;
        }

        Ok(written)
    }
}

/// One page of the stream and whether older rows remain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEventPage {
    /// Newest first.
    pub events: Vec<AppEvent>,
    pub more: bool,
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

    #[test]
    fn an_opened_row_stays_open_until_it_is_closed() {
        let db = created();

        let opened = AppEvent::open(&db, "code", Some("main.rs - SentryNeko"), 1_700_000_000)
            .expect("opened");

        assert_eq!(opened.app_name, "code");
        assert_eq!(opened.window_title.as_deref(), Some("main.rs - SentryNeko"));
        assert_eq!(opened.started_at, 1_700_000_000);
        assert_eq!(opened.ended_at, None);

        let closed = AppEvent::close(&db, opened.id, 1_700_000_600).expect("closed");
        assert_eq!(closed.ended_at, Some(1_700_000_600));
        assert_eq!(AppEvent::find(&db, opened.id).expect("found"), closed);
    }

    #[test]
    fn a_closed_row_cannot_be_closed_or_renamed_again() {
        let db = created();
        let opened = AppEvent::open(&db, "chrome", None, 100).expect("opened");
        AppEvent::close(&db, opened.id, 200).expect("closed");

        assert_eq!(
            AppEvent::close(&db, opened.id, 300)
                .expect_err("already closed")
                .code(),
            ApiCode::NotFound
        );
        assert_eq!(
            AppEvent::retitle(&db, opened.id, Some("late"))
                .expect_err("already closed")
                .code(),
            ApiCode::NotFound
        );
    }

    #[test]
    fn renaming_keeps_the_row_and_its_start() {
        let db = created();
        let opened = AppEvent::open(&db, "chrome", Some("tab one"), 100).expect("opened");

        let renamed = AppEvent::retitle(&db, opened.id, Some("tab two")).expect("renamed");

        assert_eq!(renamed.id, opened.id);
        assert_eq!(renamed.window_title.as_deref(), Some("tab two"));
        assert_eq!(renamed.started_at, 100);
        assert_eq!(renamed.ended_at, None);
    }

    #[test]
    fn a_blank_app_name_is_refused() {
        let db = created();

        for blank in ["", "   ", "\t"] {
            let error = AppEvent::open(&db, blank, None, 100).expect_err("blank name is refused");
            assert_eq!(error.code(), ApiCode::InvalidInput);
        }
    }

    #[test]
    fn an_unknown_row_is_not_found() {
        let db = created();

        let error = AppEvent::find(&db, 404).expect_err("unknown row");
        assert_eq!(error.code(), ApiCode::NotFound);
    }

    /// Stores one episode; `ended_at == None` leaves the row open.
    fn episode(db: &Db, app_name: &str, started_at: i64, ended_at: Option<i64>) {
        let opened = AppEvent::open(db, app_name, None, started_at).expect("opened");

        if let Some(ended_at) = ended_at {
            AppEvent::close(db, opened.id, ended_at).expect("closed");
        }
    }

    /// Stores seconds in the bucket of `app_name` for the hour holding `instant`.
    fn bucket(db: &Db, app_name: &str, instant: i64, seconds: i64) {
        AppUsage::record(db, app_name, AppUsage::hour_of(instant), seconds).expect("recorded");
    }

    #[test]
    fn usage_adds_up_the_hours_inside_the_window() {
        let db = created();
        bucket(&db, "code", 100, 600);
        bucket(&db, "code", 4_000, 300);
        bucket(&db, "chrome", 7_600, 900);

        let usage = AppUsage::ranking(&db, 0, 3_600, 10).expect("ranking");

        assert_eq!(
            usage,
            [AppUsage {
                app_name: "code".to_owned(),
                seconds: 600,
            }],
            "only the hour that starts inside the window counts"
        );
    }

    #[test]
    fn a_revisited_app_is_added_up_across_its_hours() {
        let db = created();
        bucket(&db, "code", 100, 100);
        bucket(&db, "chrome", 4_000, 200);
        bucket(&db, "code", 8_000, 50);

        let usage = AppUsage::ranking(&db, 0, 10_800, 10).expect("ranking");

        assert_eq!(
            usage,
            [
                AppUsage {
                    app_name: "chrome".to_owned(),
                    seconds: 200,
                },
                AppUsage {
                    app_name: "code".to_owned(),
                    seconds: 150,
                },
            ]
        );
    }

    #[test]
    fn an_hour_never_holds_more_than_its_own_seconds() {
        let db = created();
        bucket(&db, "code", 100, 4_000);
        bucket(&db, "code", 100, 4_000);

        let usage = AppUsage::ranking(&db, 0, 3_600, 10).expect("ranking");

        assert_eq!(
            usage[0].seconds, 3_600,
            "an hour cannot answer with more time than it has"
        );
    }

    #[test]
    fn the_lock_and_sign_in_shells_are_dropped() {
        let db = created();
        for shell in LOCK_SHELLS {
            bucket(&db, shell, 100, 600);
        }
        bucket(&db, "code", 100, 400);

        let usage = AppUsage::ranking(&db, 0, 3_600, 10).expect("ranking");

        assert_eq!(
            usage,
            [AppUsage {
                app_name: "code".to_owned(),
                seconds: 400,
            }]
        );
    }

    #[test]
    fn the_ranking_is_ordered_and_cut_at_the_limit() {
        let db = created();
        bucket(&db, "short", 100, 100);
        bucket(&db, "long", 100, 900);
        bucket(&db, "middle", 100, 500);

        let usage = AppUsage::ranking(&db, 0, 3_600, 2).expect("ranking");

        assert_eq!(
            usage
                .iter()
                .map(|entry| entry.app_name.as_str())
                .collect::<Vec<_>>(),
            ["long", "middle"]
        );
    }

    #[test]
    fn backfill_folds_the_events_into_hours_once() {
        let db = created();
        // Two hours of code with a break, and a row a killed process left open.
        episode(&db, "code", 3_500, Some(3_700));
        episode(&db, "chrome", 3_700, Some(4_000));
        episode(&db, "code", 4_000, Some(4_500));
        episode(&db, "ghost", 5_000, None);

        let written = AppUsage::backfill(&db, 10_000).expect("backfilled");

        assert_eq!(written, 3, "one bucket for code in each hour, one for chrome");
        let usage = AppUsage::ranking(&db, 0, 7_200, 10).expect("ranking");

        assert_eq!(
            usage,
            [
                AppUsage {
                    app_name: "code".to_owned(),
                    seconds: 700,
                },
                AppUsage {
                    app_name: "chrome".to_owned(),
                    seconds: 300,
                },
            ],
            "an unclosed row is not guessed into a duration"
        );

        // A second pass has nothing to do: folding the same events again would double them.
        assert_eq!(AppUsage::backfill(&db, 10_000).expect("again"), 0);
        assert_eq!(AppUsage::ranking(&db, 0, 7_200, 10).expect("ranking"), usage);
    }

    #[test]
    fn the_stream_is_newest_first() {
        let db = created();
        episode(&db, "code", 100, Some(200));
        episode(&db, "chrome", 300, Some(400));

        let page = AppEvent::page(&db, None, 10).expect("page");

        assert_eq!(
            page.events
                .iter()
                .map(|event| event.app_name.as_str())
                .collect::<Vec<_>>(),
            ["chrome", "code"]
        );
        assert!(!page.more);
    }

    #[test]
    fn a_page_stops_before_the_last_row_it_answered_with() {
        let db = created();
        for start in [100, 200, 300] {
            episode(&db, "code", start, Some(start + 50));
        }

        let first = AppEvent::page(&db, None, 2).expect("first page");
        assert_eq!(first.events.len(), 2);
        assert_eq!(first.events[0].started_at, 300);
        assert!(first.more);

        let second = AppEvent::page(&db, Some(first.events[1].id), 2).expect("second page");
        assert_eq!(
            second
                .events
                .iter()
                .map(|event| event.started_at)
                .collect::<Vec<_>>(),
            [100]
        );
        assert!(!second.more);
    }

    #[test]
    fn a_window_that_ends_before_it_starts_is_refused() {
        let db = created();

        let error = AppUsage::ranking(&db, 500, 500, 10).expect_err("empty window");
        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
