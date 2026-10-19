# Database

**English** | [简体中文](database.zh-CN.md)

SQLite through `rusqlite` with an `r2d2` connection pool. One idempotent script creates the
schema — nothing creates tables by hand.

## What lives where

State lives in three places, and only one of them is this database. Inside it, the split is
preferences against records:

| Store | Holds | Why there |
| --- | --- | --- |
| `config.json` | `databasePath`, `language`, `colorMode` | Known before the database opens, and readable when it cannot |
| `settings` table | The preferences: `alarm.defaults`, `pomodoro.durations`, `dashboard.grid`, `sidebar.panels` | Written and read whole, never queried by field |
| The rest of the schema | Tasks, tags, focus sessions, foreground events, alarms | One row per record, filtered and joined |
| Browser `localStorage` | Mirrors of the two layouts and the colour mode | First paint only; the two stores above win |

A row in `settings` is a key, a category and JSON as sent — the backend keeps no model of a payload
(see [Schema](#schema)). The screen that owns a preference names the category, checks what it
writes and normalizes what it reads; a backend consumer parses the value into its own model and
checks it there.

Clearing, exporting or importing data covers `config.json` and the database alike: emptying
`settings` restores the preferences, not the language or the appearance.

## Layers

| File | Responsibility |
| --- | --- |
| `db/connection.rs` | `Db` handle, pool settings, connection pragmas, `ApiError` mapping |
| `db/schema.rs` | The whole DDL, applied idempotently on every start |
| `db/repository.rs` | Generic CRUD helpers every model builds on |

`Db` is cloned into Tauri managed state at startup, so commands receive it through `State<Db>`:

```rust
let directory = app.path().app_data_dir()?;
let db = Db::open(directory.join(DATABASE_FILE_NAME))?;
schema::ensure(&db)?;
app.manage(db);
```

## Connection

| Setting | Value |
| --- | --- |
| File | `<app data dir>/sentryneko.db` (i.e. `%APPDATA%\com.sentryneko.desktop\sentryneko.db`) unless `config.json` points elsewhere |
| Pool | 4 connections, 5 s checkout timeout |
| Per connection | `foreign_keys = ON`, `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000 ms` |
| Timestamps | UTC epoch seconds |
| Failures | `ApiCode::DATABASE`, with the SQLite message in `details` |

## Configuration

`config.rs` keeps a small JSON file beside the database and creates it on first run:

```json
{
  "databasePath": "C:\\Users\\you\\AppData\\Roaming\\com.sentryneko.desktop\\sentryneko.db",
  "language": "en-US",
  "colorMode": "system"
}
```

| Field | Meaning | Default |
| --- | --- | --- |
| `databasePath` | SQLite file the application opens | `<app data dir>/sentryneko.db` |
| `language` | Language tag, listed in `docs/i18n.md` | Detected system language, falling back to `en-US` |
| `colorMode` | `dark`, `light` or `system`; `system` follows the operating system | `system` |

Rules:

- A relative `databasePath` resolves against the directory holding `config.json`; an absent
  field falls back to its default.
- A missing, `null` or blank `language` triggers system-locale detection and an immediate
  attempt to save the supported tag (or `en-US` if detection fails or is unsupported).
  For an existing file, only `language` is patched: relative paths, unknown keys and other
  stored values are preserved, and absent fields remain absent. If saving fails, startup
  continues with the resolved language in memory and retries detection on the next launch.
  Creating a new configuration still requires a successful write. A saved choice takes
  precedence on subsequent launches; settings can override it.
- An unknown `language` tag falls back to `Language::DEFAULT` and leaves the file as it is.
- An unknown `colorMode` falls back to `ColorMode::DEFAULT` (`system`) the same way.
- A file that does not parse is reported as `IO` with the parser message in `details` and is
  never overwritten — fix or delete it by hand to recover.
- Writes land in `config.json.tmp` and are renamed into place, so a crash cannot truncate the file.
- `settings` (the table below) holds user preferences; `config.json` holds what has to be known
  before the database can be opened.

## Schema

The schema holds seven tables:

| Table | Holds | Key columns |
| --- | --- | --- |
| `todos` | Tasks the user maintains | `title`, `completed`, `completed_at`, `created_at`, `updated_at`, `tag_ids` |
| `pomodoro_sessions` | One focus or break interval | `phase`, `planned_seconds`, `actual_seconds`, `started_at`, `ended_at`, `todo_id` |
| `app_events` | Foreground application activity | `app_name`, `window_title`, `started_at`, `ended_at` |
| `alarms` | One-off or weekly reminders | `label`, `hour`, `minute`, `repeat_days`, `enabled`, `created_at` |
| `settings` | Application settings, one row per key and grouped by category | `id`, `key` (unique), `value`, `category`, `updated_at` |
| `tags` | Tag names a task can carry | `name` (unique, case-insensitive), `created_at` |
| `todo_tags` | Link between a task and a tag | `todo_id`, `tag_id` |

Tags are stored twice on purpose: `todos.tag_ids` is a JSON array of tag ids, so one task row
answers "which tags" without a join, while `todo_tags` is the index the other direction reads —
`idx_todo_tags_tag_id` finds every task carrying a tag. `Todo::set_tags` writes both sides in one
transaction, and `Tag::delete` removes its id from the cache of every task that listed it.

`settings` is where runtime preferences live, kept apart from the data the app tracks so that a new
screen adds a row instead of a table. A row is a unique `key`, a JSON `value`, the `category` it is
grouped under and `updated_at` (epoch seconds, like every other timestamp here); `id` is the
surrogate key, so a row can be addressed by something other than its name. `key` is unique across
the whole table, which means a read or a write never needs the category, while
`idx_settings_category` turns "everything about one subject" into one indexed scan. Categories in
use are `pomodoro`, `alarm`, `dashboard` and `sidebar`; a category nobody knows yet is stored as
given, so a future screen needs no schema change.

Every row is written through `Setting`, which rejects a blank or over-long key, a blank category, an
oversized value and a value that is not JSON — that is all it asks of a payload, so
`get_setting`/`set_setting` serve any preference and a new one costs no Rust at all. What the value
means is decided elsewhere; see [What lives where](#what-lives-where).

The pomodoro durations are the row `pomodoro.durations` (category `pomodoro`), whose value is
`{ "focusSeconds": 1500, "shortBreakSeconds": 300, "longBreakSeconds": 900 }`. A missing row means
the defaults apply. The alarm defaults are `alarm.defaults` (category `alarm`),
`{ "ringSeconds": 10, "method": "toast" }` — how long the tone repeats and how the message travels
(`toast`, or `inApp` for the window alone).

The dashboard layout is `dashboard.grid` (category `dashboard`), whose value is
`{ "columns": 4, "placements": { "focus": { "x": 0, "y": 0, "w": 2, "h": 2 } }, "hidden": ["todos"] }`
— the columns the grid has, one rectangle per panel keyed by the panel id, and the panels parked in
the library, which keep their rectangles so putting one back where it was costs nothing. A missing
row means the dashboard was never customised and the page falls back to its built-in layout.

The sidebar layout is `sidebar.panels` (category `sidebar`), whose value is
`{ "panels": [{ "id": "todos", "visible": true }] }` — every panel the rail can show, in draw order,
each with the flag that decides whether it is drawn. A missing row means the rail was never
customised and the built-in order applies; a panel written without `visible` counts as shown, which
is what the rail did before hiding existed.

`app_events` is written by the foreground collector (`collectors/foreground_app.rs`), which samples
the foreground window once a second:

- A row opens on the sample where an app reaches the foreground (`started_at`) and closes on the
  sample where another app takes over (`ended_at`). `ended_at IS NULL` means the row is still
  running — normally only until the application quits, which closes it.
- `app_name` is the executable file name without its extension (`chrome`, `Code`), so one app keeps
  one value across versions and install paths.
- A window title that changes while the same app stays in front updates `window_title` in place.
  One row is one continuous app stretch, so a window that rewrites its caption every second cannot
  flood the table.
- Windows owned by SentryNeko itself are skipped and the row before them is closed: time spent in
  this app is not activity worth recording.
- Five minutes without keyboard or mouse input count as being away: the open row is closed at that
  sample and a new one opens when input returns, so an app left in front does not accrue time.
- A sample that finds nothing to attribute — no foreground window, a locked screen, a process that
  cannot be opened — closes the open row the same way.

`AppEvent::usage` reads that table for the ranking: it clips every row to the window it was asked
about, sums the rows of one app (an app revisited later in the window is merged with its earlier
stretch instead of appearing twice), counts a row without `ended_at` up to the end of the window,
and drops `LockApp` / `LogonUI` so locked time is not attributed to anybody.

The heatmap (`models/heatmap.rs`) rolls `pomodoro_sessions` and `todos` up into buckets:

- A bucket is a local day, a Monday-based week or a calendar month. The boundary is resolved
  through the Windows time zone rules, so the two days a year whose clocks move keep the right
  length instead of drifting by an hour.
- Every day of the window is answered, empty ones included, so the chart can lay the days out
  without filling the gaps itself.
- A focus phase counts with its `actual_seconds` and belongs to the day it *started* in; a phase
  that is still open counts once it is closed. Sessions from other phases are ignored.
- A task counts on the day `completed_at` names. `set_completed` stamps it when the box is ticked
  and clears it when the task is reopened, so renaming a finished task never moves it to another
  day.

The completion rate (`models/todo.rs`) reads `todos` from two angles: `all` counts every stored
task, `today` only those whose `created_at` falls after local midnight. The numerator is the tasks
of that scope with `completed` set, so reopening a task moves the rate back, and a deleted task
leaves both sides — the rate follows the list the user sees.

`alarms` is maintained by `commands/alarm_commands.rs` and read by `services/scheduler.rs`:

- `hour` and `minute` are the local wall clock, never an instant, so a row keeps its meaning when
  the time zone changes. `repeat_days` is a weekday mask: bit 0 is Monday and bit 6 is Sunday, so
  `127` is every day and `0` is a one-off.
- A one-off rings at the next occurrence of its time and is switched off once it has rung; turning
  it back on arms it again. A repeating alarm stays on and waits for its next selected weekday.
- Every row persists, so an alarm that has not expired keeps working after a restart: the
  scheduler resolves the next instant from the clock at startup instead of storing one. By the
  same rule an instant that passed while the app was closed is not replayed.
- The instant is resolved through the Windows time zone rules, so a day whose clocks move keeps
  its real length. A wall-clock time the clock skips that day (spring forward) is skipped with it —
  a repeating alarm waits for its next selected day; a time the clock repeats (fall back) rings on
  its first pass and never twice.
- The scheduler keeps one instant per alarm and reads the table once a second, so adding, editing,
  deleting or switching a row takes effect within a second. An instant that arrived while the row
  was being read still rings, up to one tick late.
- How an alarm rings comes from `alarm.defaults`, read when it fires rather than copied into the
  row: the tone repeats every two seconds until `ringSeconds` has passed, and `method` decides
  whether the system is asked for a Toast. `inApp` leaves it to the `alarm-triggered` push, so the
  window is the only channel; saving the defaults therefore moves every alarm at once.

## Schema creation

`ensure` runs the script in a transaction on every start: a missing table or index is created, an
existing one is left alone. Nothing is versioned, because the app has not shipped — a schema
change is a local rebuild rather than a migration.

## Repository helpers

| Helper | Returns |
| --- | --- |
| `insert` | The new row id |
| `execute` | Number of affected rows |
| `query_one` | One mapped row, or `NOT_FOUND` |
| `query_optional` | One mapped row, or `None` |
| `query_all` | Every mapped row |
| `count` | The first column of the first row as `i64` |
| `exists` | Whether the query matches at least one row |
| `transaction` | The value of `work`, rolled back when `work` fails |

Row mappers are plain `fn(&Row<'_>) -> ApiResult<T>` values (`RowMapper<T>`), so a model
exposes its mapper as an associated function and every helper stays generic.

## scripts/init_db.ps1

Creates the same schema without starting the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1 [-DatabasePath <file>]
```

It needs `sqlite3` on `PATH`; without it the script stops with a message pointing at the app,
which creates the schema on first run either way. Every statement uses `IF NOT EXISTS`, so
running it repeatedly is safe.

A test extracts the SQL from the script and runs it against a created database, asserting that
both sides end up with the same tables.

## Adding a table or a column

1. Add the DDL to `db/schema.rs`.
2. Mirror it in `scripts/init_db.ps1`, with the same `IF NOT EXISTS` guards.
3. Run `cargo test` — the script check fails while the two sides disagree.
4. Rebuild your local database: run `scripts/init_db.ps1` against a fresh file or delete the old
   one. An existing database is not upgraded, since no version has shipped yet.
