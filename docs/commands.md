# Tauri commands

**English** | [简体中文](commands.zh-CN.md)

Every frontend ↔ backend call goes through a `#[tauri::command]` function in
`src-tauri/src/commands/`. Handlers stay thin: validate the arguments, delegate to
`services/` or `db/`, and map the outcome to `utils::response`. Business logic does
not live in a command.

## Response envelope

Commands do not return domain types directly. Each one resolves to the same shape,
for success and failure alike (`src-tauri/src/utils/response.rs`, mirrored by
`ApiResponse<T>` in `src/types/index.ts`):

```json
// success
{ "code": "OK", "message": "OK", "details": null, "data": { "id": 1, "title": "Write the docs" } }

// failure
{ "code": "INVALID_INPUT", "message": "title must not be empty", "details": null, "data": null }
```

- `code` — the contract. The frontend switches on it and picks localized copy.
- `message` — fallback copy from the backend, useful for logs and for codes the
  frontend does not know yet. Never the only source of user-visible text.
- `details` — the underlying diagnostic (I/O message, parse error). Surfaced for
  logs and bug reports; not localized and not to be rendered as UI copy.
- `data` — the payload on success, `null` on failure.

The envelope is resolved, not rejected: `invoke()` only rejects on transport-level
failures (command not registered, handler panicked, payload failed to serialize),
so a single `code` check covers every business outcome.

## Error codes

| Code | Meaning | Raised by |
| --- | --- | --- |
| `OK` | Success, `data` present | — |
| `INVALID_INPUT` | Arguments failed validation | Any command validating its input |
| `NOT_FOUND` | Requested record does not exist | CRUD commands (T10, T16, T17) |
| `CONFLICT` | Clashes with stored state (duplicate key, stale revision) | CRUD commands |
| `DATABASE` | Database layer failed | `db/` (T04) |
| `IO` | Filesystem or OS-level I/O failed | `config.rs`, export/import (T29) |
| `PERMISSION_DENIED` | The OS refused the operation | Collector (T12), auto-start (T26) |
| `UNSUPPORTED` | Reserved capability of a later milestone | P3 stubs (T27–T32) |
| `INTERNAL` | Anything unexpected; `details` explains it | Fallback for `?` |

`services::i18n` (T06) maps codes to localized `message` text. Adding a code means
updating both `ApiCode` and the `ApiCode` union in `src/types/index.ts`.

## Writing a command

```rust
// src-tauri/src/commands/todo_commands.rs
use crate::utils::response::{ApiError, ApiResponse, ApiResult};

#[tauri::command]
pub fn toggle_todo(id: i64) -> ApiResponse<Todo> {
    toggle(id).into()
}

fn toggle(id: i64) -> ApiResult<Todo> {
    if id <= 0 {
        return Err(ApiError::invalid_input("id must be a positive integer"));
    }

    repository::toggle_todo(id) // -> ApiResult<Todo>
}
```

Rules (also enforced by `CONTRIBUTING.md`):

1. The public handler returns `ApiResponse<T>`; fallible helpers return
   `ApiResult<T>` and convert once with `.into()`.
2. No `unwrap()` / `expect()` on a path a user can trigger — return an `ApiError`.
3. Need the value inside an envelope? Use `?` on `ApiResult` and convert at the end.
4. Register the handler in `lib.rs` with
   `.invoke_handler(tauri::generate_handler![toggle_todo])`.
5. App-defined commands need no `capabilities/default.json` entry; that file only
   grants permissions of core and plugin commands.
6. Add a row to the table below and update it whenever a signature changes.

## Command index

Every command the frontend may call is listed here. The language pair is the interface behind
`src/i18n/`: `get_language` answers with the tag stored in `config.json`, and `set_language`
rejects anything outside `Language::ALL` with `INVALID_INPUT`. The appearance pair does the same
for `dark`, `light` and `system`: `get_color_mode` reads the stored choice and `set_color_mode`
rejects anything else with `INVALID_INPUT`. `emit_test_event` is the
diagnostic behind the event bus probe; the push it triggers is defined in `docs/events.md`.
The todo group is the list itself: `list_todos` filters by completion, every mutation answers
with the stored row, `todo_counts` feeds the remaining counter, and `completion_rate` answers how
many tasks of the `all` or `today` scope are done — the counting rules live in
`docs/database.md`. The tag group is reserved —
no page calls it yet: it maintains the name index, links tags to a task through `set_todo_tags`,
and reads the relation from either side (`todo_tags` for one task, `todos_with_tag` for one tag).
The pomodoro group persists the timer: `start_pomodoro_session` opens a row when a phase starts,
and `finish_pomodoro_session` closes it with the seconds actually spent — the countdown itself
runs in the frontend from timestamps, not from a tick count, and is driven from the store rather
than the page, so switching pages does not stop it. The durations are settings, so their
two commands sit in `settings_commands` and are edited on the settings page. The notification
group holds the toast channel: `send_test_notification` is the diagnostic, and
`notify_pomodoro_phase` is what the timer calls when a phase runs out. Both answer `toast`, or
push `notification-fallback` (see `docs/events.md`) and answer `fallback` when the system refused
it; the pomodoro timer keeps running either way. The system group describes the machine rather than
the data: `get_uptime` answers the boot instant (`bootAt`), the seconds since boot (`totalSeconds`,
sleep included) and the part of them that falls inside today (`todaySeconds`) — today starts at
local midnight resolved through the Windows time zone rules, so a boot before midnight counts only
the part after it, and the counter keeps running through sleep, so a resume does not shift the boot
instant. The foreground group answers what the ranking shows: `app_usage` takes a window (`from`,
`to`, UTC epoch seconds) and a `limit`, and ranks applications by the seconds they held the
foreground inside it. The frontend computes the window for its presets — "today" starts at local
midnight — and the backend clips stored rows to it, merges an app revisited later in the window,
and drops the lock and sign-in shells. The event stream reads the same table: `list_app_events`
answers one page newest first, and `before` is the id the previous page ended at, so paging stays
stable while the collector inserts rows. The heatmap group answers the chart: `heatmap` takes the
window and a `granularity` (`day`, `week` or `month`) and returns one bucket per local day, Monday
or first of the month — empty ones included — carrying the focus seconds of phases that started
there and the tasks completed there; the rules live in `docs/database.md`. The alarm group
maintains the reminders the scheduler watches: `list_alarms`, `add_alarm`, `update_alarm`,
`set_alarm_enabled` and `delete_alarm`. `hour` and `minute` are the local wall clock and
`repeatDays` is a weekday mask (`0` for a one-off); nothing here rings — `services/scheduler.rs`
does, on the thread that owns the clock, so an alarm fires whether or not the page is open. How an
alarm rings is a setting rather than a column, so it lives with the durations: `get_alarm_defaults`
and `set_alarm_defaults` carry the ring length and the notification method, and the scheduler reads
them when an alarm fires — editing one therefore moves every alarm, not only the next. The dashboard
group carries the home page itself: `get_dashboard_layout` reads the placed widgets and
`apply_dashboard_changes` applies what one arrangement changed — an `upsert` per widget moved,
resized or added, a `remove` per widget taken off. Each placement carries its own `id`, so one kind
can appear several times; an entry also names the cell its top-left corner sits in and the cells it
spans (`x`, `y`, `w`, `h` on a two-column grid) plus the data source it reads. A profile that has
never been customised has no row, so `get_dashboard_layout` answers `null` and the page sends its
built-in layout as the first change set. The two auto-start commands own the other piece of machine
state: `get_autostart` reports whether the per-user run key starts this executable, and
`set_autostart` writes or removes that entry, answering with what is now in force. A registry that
refuses the write is `PERMISSION_DENIED`.

| Command | Module | Arguments | Returns | Task |
| --- | --- | --- | --- | --- |
| `get_language` | `settings_commands` | — | `String` (BCP-47 tag) | T07 |
| `set_language` | `settings_commands` | `language: String` | `String` (tag in force) | T07 |
| `get_color_mode` | `settings_commands` | — | `String` (`dark`, `light` or `system`) | — |
| `set_color_mode` | `settings_commands` | `mode: String` | `String` (mode in force) | — |
| `emit_test_event` | `event_commands` | — | `TestEvent` (`{ sequence }`) | T08 |
| `list_todos` | `todo_commands` | `completed: bool?` | `Todo[]` | T10 |
| `add_todo` | `todo_commands` | `title: String` | `Todo` | T10 |
| `rename_todo` | `todo_commands` | `id: i64`, `title: String` | `Todo` | T10 |
| `set_todo_completed` | `todo_commands` | `id: i64`, `completed: bool` | `Todo` | T10 |
| `delete_todo` | `todo_commands` | `id: i64` | — | T10 |
| `todo_counts` | `todo_commands` | — | `TodoCounts` (`{ total, remaining, completed }`) | T10 |
| `completion_rate` | `todo_commands` | `scope: "all" \| "today"` | `TaskCompletion` (`{ total, completed }`) | T22 |
| `list_tags` | `tag_commands` | — | `Tag[]` | T33 |
| `add_tag` | `tag_commands` | `name: String` | `Tag` | T33 |
| `rename_tag` | `tag_commands` | `id: i64`, `name: String` | `Tag` | T33 |
| `delete_tag` | `tag_commands` | `id: i64` | — | T33 |
| `set_todo_tags` | `tag_commands` | `id: i64`, `tagIds: i64[]` | `Todo` | T33 |
| `todo_tags` | `tag_commands` | `todoId: i64` | `Tag[]` | T33 |
| `todos_with_tag` | `tag_commands` | `tagId: i64` | `Todo[]` | T33 |
| `get_pomodoro_durations` | `settings_commands` | — | `PomodoroDurations` (`{ focusSeconds, shortBreakSeconds, longBreakSeconds }`) | T11 |
| `set_pomodoro_durations` | `settings_commands` | `durations: PomodoroDurations` | `PomodoroDurations` | T11 |
| `start_pomodoro_session` | `pomodoro_commands` | `phase: Phase`, `plannedSeconds: i64`, `todoId: i64?` | `PomodoroSession` | T11 |
| `finish_pomodoro_session` | `pomodoro_commands` | `id: i64`, `actualSeconds: i64` | `PomodoroSession` | T11 |
| `list_pomodoro_sessions` | `pomodoro_commands` | `limit: i64` | `PomodoroSession[]` | T11 |
| `send_test_notification` | `notification_commands` | — | `Outcome` (`"toast"` or `"fallback"`) | T14 |
| `notify_pomodoro_phase` | `notification_commands` | `phase: Phase` | `Outcome` (`"toast"` or `"fallback"`) | T14 |
| `get_uptime` | `system_commands` | — | `Uptime` (`{ bootAt, todaySeconds, totalSeconds }`) | T13 |
| `app_usage` | `app_event_commands` | `from: i64`, `to: i64`, `limit: i64` | `AppUsage[]` (`{ appName, seconds }`) | T20 |
| `list_app_events` | `app_event_commands` | `before: i64?`, `limit: i64` | `AppEventPage` (`{ events, more }`) | T23 |
| `heatmap` | `heatmap_commands` | `from: i64`, `to: i64`, `granularity: "day" \| "week" \| "month"` | `HeatmapBucket[]` (`{ start, focusSeconds, completedTasks }`) | T19 |
| `list_alarms` | `alarm_commands` | — | `Alarm[]` (`{ id, label, hour, minute, repeatDays, enabled, createdAt }`) | T17 |
| `add_alarm` | `alarm_commands` | `label: String`, `hour: i64`, `minute: i64`, `repeatDays: i64` | `Alarm` | T17 |
| `update_alarm` | `alarm_commands` | `id: i64`, `label: String`, `hour: i64`, `minute: i64`, `repeatDays: i64` | `Alarm` | T17 |
| `set_alarm_enabled` | `alarm_commands` | `id: i64`, `enabled: bool` | `Alarm` | T17 |
| `delete_alarm` | `alarm_commands` | `id: i64` | — | T17 |
| `get_alarm_defaults` | `settings_commands` | — | `AlarmDefaults` (`{ ringSeconds, method }`) | T18 |
| `set_alarm_defaults` | `settings_commands` | `defaults: AlarmDefaults` | `AlarmDefaults` | T18 |
| `get_autostart` | `settings_commands` | — | `bool` — whether the login entry starts this executable | T26 |
| `set_autostart` | `settings_commands` | `enabled: bool` | `bool` — the state now in force | T26 |
| `get_dashboard_layout` | `settings_commands` | — | `DashboardLayout?` (`{ widgets: { id, kind, x, y, w, h, source }[] }`; `null` until customised) | — |
| `apply_dashboard_changes` | `settings_commands` | `changes: WidgetChange[]` (`upsert` with a widget, or `remove` with an id) | `DashboardLayout` — the layout now in force | — |
| `get_todo_display_mode` | `settings_commands` | — | `"separated"` (default), `"merged"` or `"twoColumns"` | T35 |
| `set_todo_display_mode` | `settings_commands` | `mode: String` | The saved display mode; other values return `INVALID_INPUT` | T35 |
