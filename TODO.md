# SentryNeko TODO

**English** | [简体中文](TODO.zh-CN.md)

This file is the single source of truth for task breakdown and priority. **Every completed item must be checked off as `[x]` in the same commit that implements it** — never merge code first and tick the box later.

## Priority definitions

| Level | Meaning | Criteria | Rule |
| --- | --- | --- | --- |
| **P0** | Blocking foundation | Nothing else can start without it | Must be done first; no reordering, no jumping the queue |
| **P1** | Urgent (MVP) | Without it the product has no core value and cannot ship | Must be finished within the current iteration |
| **P2** | Important, not urgent | Affects completeness and the value of the data, but does not block the MVP | Scheduled immediately after the MVP |
| **P3** | Reserved | Future capability; only models and interfaces exist this cycle | No implementation work; early development is not allowed |

Status legend: `[ ]` not started　`[~]` in progress　`[x]` done　`[!]` blocked (note the reason at the end of the row)

## Milestones

| Milestone | Goal | Tasks | Exit criteria |
| --- | --- | --- | --- |
| **M0** Runnable foundation | A shell that proves frontend ↔ Tauri command ↔ SQLite works end to end | T01–T09 | After `pnpm tauri dev`, one test record can be written and read, and the language can be switched |
| **M1** Usable MVP | Todo + Pomodoro + foreground collection form a closed loop | T10–T16 | One full day of usage recorded, Pomodoro completion notifies, data persisted |
| **M2** Analytics & system integration | Data visualization plus always-on background service | T17–T26, T33–T39 | Heatmap / trends / ranking available, tray resident, auto-start and optional AI review |
| **M3** Reserved extensions | Social, sharing, extra languages | T27–T32 | Started on demand, never blocking M1/M2 |

## P0 Foundation (blocking)

| Status | ID | Task | Depends on | Acceptance criteria |
| --- | --- | --- | --- | --- |
| [x] | T01 | Project scaffolding: Tauri 2 + React + TS + Vite | — | `package.json` / `vite.config.ts` / `tsconfig.json` / `index.html` in place; frontend and backend directories match the README structure |
| [x] | T02 | Tauri config & capabilities: `tauri.conf.json` + `capabilities/default.json` + icons | T01 | Window size / title / bundle targets (msi, nsis) configured; the IPC allow-list is kept minimal |
| [x] | T03 | Unified command response and error conventions | T01 | `utils/response.rs` defines the shared envelope, `types/index.ts` mirrors it, and no command returns a bare value |
| [x] | T04 | SQLite integration: connection pool + schema creation + generic repository | T02 | `db/{connection,schema,repository}.rs` usable; `scripts/init_db.ps1` creates tables idempotently |
| [x] | T05 | Config read/write: database path, language, persisted settings | T04 | `config.rs` creates the config on first run, detects and saves the system language when none is stored (#32); settings survive a restart |
| [x] | T06 | Backend i18n skeleton (localized error messages) | T03 | `services/i18n.rs` supports zh-CN / en-US with error-code → message mapping |
| [x] | T07 | Frontend i18n skeleton (i18next + persisted language) | T05 | `i18n/`, `zh-CN.json` and `en-US.json` ready; `ja-JP.json` stubbed |
| [x] | T08 | Event bus + frontend event listener wrapper | T03 | `services/event_bus.rs` and `hooks/useTauriEvent.ts` connected; one test event can be emitted and received |
| [x] | T09 | Frontend routing and page skeleton | T07, T08 | `App.tsx` routing works; 8 pages and 4 stores stubbed; `Dashboard` reachable |

## P1 Urgent (MVP closed loop)

| Status | ID | Task | Depends on | Acceptance criteria |
| --- | --- | --- | --- | --- |
| [x] | T10 | Todo list: CRUD + toggle completion + filters + remaining count | T04, T09 | All `todo_commands.rs` commands usable; filtering (all / active / completed) and counting correct; optional due dates selectable on create/edit via year/month/day dropdowns, clear and today/tomorrow shortcuts, displayed in the list (#34) |
| [x] | T11 | Pomodoro timer: focus/break countdown + custom durations + start/pause/reset | T04, T09 | Countdown driven by timestamps (unaffected by render throttling); phase transitions correct; sessions persisted |
| [x] | T12 | Foreground app collector (Win32 FFI) | T04, T05 | `collectors/foreground_app.rs` + `utils/windows.rs` capture app name and window title, filter out our own process, and avoid duplicate rows for the same switch |
| [x] | T13 | Boot time collection and today's uptime | T12 | Reads system boot time; correct across midnight and sleep/resume |
| [x] | T14 | System notifications: Windows Toast | T03 | `services/notification.rs` can send a notification and falls back to an in-app toast on failure |
| [x] | T15 | Event push wiring: app switch / Pomodoro completion / alarm trigger | T08, T12 | The UI refreshes in real time without polling; event payloads have type definitions and docs |
| [x] | T16 | Settings page: Pomodoro settings + language settings | T07, T11 | `settings_commands.rs` wired to `SettingsPage`; changes take effect immediately and persist |

## P2 Important, not urgent

| Status | ID | Task | Depends on | Acceptance criteria |
| --- | --- | --- | --- | --- |
| [x] | T17 | Alarms: one-off/repeating + `scheduler.rs` | T04, T14 | Fires notification and ringtone on time; alarms that have not expired survive an app restart; pushes the alarm trigger event (T15) |
| [x] | T18 | Alarm defaults (ring duration, notification method) | T16, T17 | Merged into the settings page; new alarms inherit the defaults |
| [x] | T19 | Heatmap: aggregate focus time and task count by day/week/month | T04, T11 | `heatmap_commands.rs` + `HeatmapChart.tsx`, GitHub style; aggregation rules documented and consistent |
| [x] | T20 | App usage stats: aggregation per app + Top ranking | T12 | Attribution rules defined (merge adjacent records, ignore idle/lock screen); ranking supports time-range switching |
| [x] | T21 | Focus trends: daily/weekly/monthly trend charts | T11, T19 | Granularity switchable; empty-data placeholder state present |
| [x] | T22 | Task completion rate | T10 | Rate definition (all-time vs. today) switchable and documented |
| [x] | T23 | Event stream page (`EventsPage`) | T15 | Browse foreground app events newest-first with paging |
| [x] | T24 | Analytics page (`AnalyticsPage`) | T20, T21, T22 | Aggregates the stats above; page-level loading and error states implemented |
| [x] | T25 | System tray: stay resident when minimized + context menu + single instance | T02, T11 | Menu offers start Pomodoro, today's stats, show/hide window; closing the main window does not quit the app; launching again focuses or restores the existing window without another resident process or tray icon |
| [x] | T26 | Auto-start with Windows (registry / Task Scheduler) | T25 | A settings switch writes `HKCU\...\Run` for the running executable; switching it on twice leaves one entry, switching it off removes it, and a login start waits in the tray |
| [x] | T33 | Task tags: name index, task links and the id cache | T10 | `tags`, `todo_tags` and `todos.tag_ids` migrated; tag commands registered; read by the AI assistant |
| [x] | T34 | Reusable numeric input with wheel adjustment (#36) | T16, T18 | Validated typing, wheel / keyboard / arrow stepping, configurable min / max / step, and both themes; reused for Pomodoro and alarm durations |
| [x] | T35 | Task list display modes (#26) | T10, T16 | Settings switch between separate sections (default), one merged list with task type indicators and two columns; the preference survives a restart without changing tasks; recurring metadata comes from #25 |
| [x] | T37 | One-time and recurring tasks (#25) | T10, T17 | Daily, weekly, monthly and custom calendar intervals; distinct list badges; automatic cycle resets and restart catch-up; completed cycles retained in the heatmap |
| [x] | T38 | Sidebar panel settings (#38) | T09, T16 | Visibility toggles and up/down controls apply immediately; layout survives restarts; defaults show every panel; Settings stays reachable |
| [x] | T39 | Font preferences (#37) and reusable numeric input (#36) | T05, T16 | Bundled JetBrains Mono and installed Windows families; 10–32 px base size with typing, wheel and arrow controls; live application and persistence across restarts |
| [x] | T36 | Semi-automatic AI assistance (#33) | T10, T17, T33 | Local model suggestions in a dedicated page; edit/reject/explicitly confirm; atomic execution and log; persistent pending proposals and clearable history |

## P3 Reserved (stubs only, not implemented)

| Status | ID | Task | Depends on | Deliverable this cycle |
| --- | --- | --- | --- | --- |
| [ ] | T27 | System info collection: CPU / memory / disk | T12 | Interface signatures and stub implementation in `system_info.rs` |
| [ ] | T28 | Global shortcuts: start/pause Pomodoro, show/hide window | T25 | Settings entries stubbed; hotkeys not registered yet |
| [ ] | T29 | Data management: export / import / clear history | T04 | Stubbed commands and settings entries, including destructive-action confirmation copy |
| [ ] | T30 | Japanese `ja-JP` | T07 | Empty locale file and language option stubbed |
| [ ] | T31 | Mutual supervision: friends / room presence | T04 | `models/user.rs` and protocol stubbed |
| [ ] | T32 | Sharing: public profile / share card | T31 | Data model stubbed |

## Critical dependency chain

```text
T01 ─► T02 ─► T04 ─┬─► T05 ─► T07 ─┐
                   │                ├─► T09 ─► T10 ─► T22
                   │                │        └─► T11 ─┬─► T16 ─► T18
                   │                │                 ├─► T19 ─► T21
                   │                └─► T12 ─► T13    └─► T25 ─► T26 / T28
                   │                     └─► T20 ────┐
T01 ─► T03 ─┬─► T06                    T03 ─► T08 ─► T15 ─► T23
            └─► T14 ─► T17 ───────────► T24
```

## Ordering principles

1. **Close P0 first, in parallel**: do not open feature branches while the foundation is incomplete, to avoid rework.
2. **Collection before analytics**: without T12 there is no data for T19–T24 to compute.
3. **Notifications before alarms**: wire up T14 before T17 to avoid implementing the reminder channel twice.
4. **Reserved means interfaces only**: if a P3 item turns out to be needed early, promote it to P2 in review first — never start it silently.
