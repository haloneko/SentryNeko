# Tauri events

**English** | [简体中文](events.zh-CN.md)

Commands are calls the frontend makes; events are pushes the backend makes. Every event
listed here is emitted through `services/event_bus.rs`: collectors and timers hand their
payloads to the bus, and the bus pushes them to the webview.

## Listening from the frontend

Do not call `listen` directly. `hooks/useTauriEvent.ts` owns the subscription and tears it
down on unmount; outside Tauri it subscribes to nothing, so a plain `pnpm dev` in a browser
still runs.

```tsx
import { BACKEND_EVENTS, useTauriEvent } from "../hooks/useTauriEvent";
import type { TestEventPayload } from "../types";

useTauriEvent<TestEventPayload>(BACKEND_EVENTS.testEvent, (payload) => {
  // payload.sequence
});
```

Event names live in `BACKEND_EVENTS` (`hooks/useTauriEvent.ts`) and payload types in
`src/types/`; both are registered in the table below.

## Event names

Names are flat kebab-case strings. Renaming one breaks every listener, so a rename counts as
a new event: add the new name, migrate the listeners, then drop the old one.

| Event | Payload | Trigger | Task |
| --- | --- | --- | --- |
| `test-event` | `TestEvent` — `{ sequence: u64 }` | `emit_test_event` pushes one on demand; `sequence` rises with every push | T08 |
| `notification-fallback` | `NotificationFallback` — `{ kind, reason }` | `send_test_notification` pushes one when the system refuses the toast, so the frontend paints it in the app instead | T14 |
| `app-switch` | `AppEvent` — `{ id, appName, windowTitle, startedAt, endedAt }` | The foreground collector opened a row, i.e. another app took the foreground. A title change inside the same app updates its row without a push, so one push is one switch | T15 |
| `pomodoro-finished` | `PomodoroSession` — `{ id, phase, plannedSeconds, actualSeconds, startedAt, endedAt, todoId }` | `finish_pomodoro_session` closed a session, so a history view can refresh without polling; the window that closed it already knows | T15 |
| `tray-start-pomodoro` | — (payload is `null`) | The tray's `Start Pomodoro` entry: the window has already been shown, and the shell reloads the durations and starts the phase from the store, so it runs exactly like one started on the page | T25 |
| `alarm-triggered` | `Alarm` — `{ id, label, hour, minute, repeatDays, enabled, createdAt }` | `services/scheduler.rs` reached the alarm's local time: the tone started and, unless the stored defaults say `inApp`, the toast (or its `notification-fallback`) was handed over first. A one-off is already switched off, so the payload carries `enabled: false` | T17, T18 |
| `todos-changed` | — (payload is `null`) | A successful task mutation or a committed recurring-cycle reset. The shell reloads the current list/filter and counts; mounted completion-rate and heatmap views reload too. The scheduler checks every second, including while the window stays in the tray | T34 |

The shell (`App.tsx`) subscribes to `app-switch` once and hands every push to
`stores/appEventStore.ts`, which keeps the newest rows. `EventsPage` pages through the database and
puts that tail on top, so a switch shows up while the page is open and older history stays
browsable. It also
renders `AlarmRinging`, which keeps the newest `alarm-triggered` push on screen for a minute or
until dismissed: a toast can be missed while the window is in the background, and the payload is
enough to say which alarm it was.

## Payload rules

- The payload is a `serde` struct next to its name in `services/event_bus.rs` and an interface
  in `src/types/index.ts`; a field is optional only when the type says so.
- Property names are camelCase on the wire (`#[serde(rename_all = "camelCase")]`), so the
  frontend reads `startedAt` rather than `started_at`.
- Timestamps travel as UTC epoch seconds, matching `docs/database.md`, and are formatted for
  display on the frontend; a pre-formatted local string never travels in a payload.
- No localized copy in a payload: the frontend renders its own `t()` keys.
