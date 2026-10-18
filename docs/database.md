# Database

**English** | [简体中文](database.zh-CN.md)

SQLite through `rusqlite` with an `r2d2` connection pool. One idempotent script creates the
schema — nothing creates tables by hand.

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

The schema holds nine tables:

| Table | Holds | Key columns |
| --- | --- | --- |
| `todos` | Tasks the user maintains | `title`, `completed`, `completed_at`, `created_at`, `updated_at`, `tag_ids`, `due_date` |
| `pomodoro_sessions` | One focus or break interval | `phase`, `planned_seconds`, `actual_seconds`, `started_at`, `ended_at`, `todo_id` |
| `app_events` | Foreground application activity | `app_name`, `window_title`, `started_at`, `ended_at` |
| `alarms` | One-off or weekly reminders | `label`, `hour`, `minute`, `repeat_days`, `enabled`, `created_at` |
| `settings` | Key/value application settings | `key`, `value`, `updated_at` |
| `tags` | Tag names a task can carry | `name` (unique, case-insensitive), `created_at` |
| `todo_tags` | Link between a task and a tag | `todo_id`, `tag_id` |
| `todo_recurrences` | Optional task schedule and current cycle | `todo_id` (primary key), `unit`, `interval`, `current_at`, `next_at` |
| `todo_completions` | Completed recurring cycles retained for the heatmap | `todo_id`, `occurrence_at` (composite primary key), `completed_at` |

`todos.due_date` is nullable UTC epoch seconds at midnight, encoding a calendar date from
1970-01-01 to 9999-12-31. `NULL` means no due date, including for tasks created before this
column existed. `Todo::update` saves the title and due date together without changing completion
or tags. The frontend formats this value in UTC so timezone offsets cannot change the selected day.

Tags are stored twice on purpose: `todos.tag_ids` is a JSON array of tag ids, so one task row
answers "which tags" without a join, while `todo_tags` is the index the other direction reads —
`idx_todo_tags_tag_id` finds every task carrying a tag. `Todo::set_tags` writes both sides in one
transaction, and `Tag::delete` removes its id from the cache of every task that listed it.

An absent `todo_recurrences` row means a one-time task, so adding these tables leaves existing
tasks and their completion flags untouched. A recurring task keeps one stable todo id and its
tags. Its schedule repeats every 1–365 days, weeks or months, anchored to the local creation date:

- The first cycle starts at creation. Later cycles start at local midnight on the scheduled date,
  using Windows time zone rules rather than fixed 24-hour durations. A skipped midnight uses the
  first valid hour of that date.
- Months clamp to the last day when necessary without losing the anchor: January 31 → February
  28/29 → March 31. Custom intervals use the same calendar arithmetic.
- The background scheduler checks `next_at` each second. Startup and task-list/count reads also
  catch up, skipping missed cycles to leave one current task rather than a backlog.
- At a boundary, completed cycles are copied to `todo_completions` before `completed` and
  `completed_at` are reset. The schedule and task update in the same transaction; retrying cannot
  duplicate a cycle. An unfinished cycle resets too, without recording a completion.
- Undoing completion before the boundary removes that cycle's completion. Deleting the task
  cascades to its schedule and archived completions. Repeated completion calls keep the original
  completion timestamp; a completion at the boundary belongs to the new cycle.

The pomodoro durations are a single `settings` row: key `pomodoro.durations`, value the JSON form
of `PomodoroDurations`. A missing row means the defaults apply. The alarm defaults are the same
shape: key `alarm.defaults`, value `{ "ringSeconds": 10, "method": "toast" }` — how long the tone
repeats and how the message travels (`toast`, or `inApp` for the window alone).

The dashboard layout is the third such row: key `dashboard.grid`, value
`{ "widgets": [{ "id": "focus-1", "kind": "focus", "x": 0, "y": 0, "w": 1, "h": 2, "source": "today" }] }`
— the widgets the home page shows, each with an identity of its own, the cell its top-left corner
sits in and how many cells it spans on a two-column grid. The `id` is what makes a placement
addressable, so the same `kind` may appear more than once. A missing row means the dashboard was
never customised and the page falls back to its built-in layout.

The task list layout uses key `todo.displayMode` with a JSON string value: `"separated"`
(the default when the row is absent), `"merged"` or `"twoColumns"`. Settings saves it through
`set_todo_display_mode`; startup reads it through `get_todo_display_mode` before rendering.
Changing this row never changes tasks, completion state, recurrence rules or list ordering.
Separate sections stack vertically; the two-column layout sits side by side and stacks when
the list has at most 560 CSS pixels of room. Merged mode labels each task type. Completion
filters and the remaining count apply to both types in every layout. A non-null `recurrence`
field identifies recurring tasks (provided by #25); absent or null fields mean one-time tasks,
so existing task payloads remain compatible.

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
- Archived recurring completions count on their original completion day alongside current task
  completions; resetting a task therefore does not erase previous days' activity.

The completion rate (`models/todo.rs`) reads `todos` from two angles: `all` counts every stored
task's current state, `today` only those created or whose current recurring cycle started after
local midnight (`COALESCE(todo_recurrences.current_at, todos.created_at)`). The numerator is the tasks
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

`ensure` runs the script in a transaction on every start: a missing table or index is created.
It also checks `pragma_table_info('todos')` and adds the nullable `due_date` column when absent,
preserving existing tasks, tags and links. This additive upgrade is idempotent; there is no schema
version table.

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
| `immediate_transaction` | The same, reserving the writer before reads for concurrent cycle resets / completion |

Row mappers are plain `fn(&Row<'_>) -> ApiResult<T>` values (`RowMapper<T>`), so a model
exposes its mapper as an associated function and every helper stays generic.

## scripts/init_db.ps1

Creates the same schema without starting the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1 [-DatabasePath <file>]
```

It needs `sqlite3` on `PATH`; without it the script stops with a message pointing at the app,
which creates the schema on first run either way. Table/index creation uses `IF NOT EXISTS`,
and the script checks for `due_date` before adding it to existing databases, so repeat runs are safe.

A test extracts the SQL from the script and runs it against both fresh and created databases,
asserting that both sides end up with the same tables and todo columns.

## Adding a table or a column

1. Add the DDL to `db/schema.rs`.
2. Mirror it in `scripts/init_db.ps1`, with the same creation and upgrade guards.
3. Run `cargo test` — the script check fails while the two sides disagree.
4. For additive changes to existing tables, check for the column before adding it in both
   `ensure` and the maintenance script; test that repeat runs preserve existing data.

Date sorting is global within each task-type section: both directions put undated tasks last, with newest id first for ties, regardless of completion. Default ordering keeps active tasks first. Overdue means an unfinished deadline before the user’s current local calendar day; a task due today is not overdue.
