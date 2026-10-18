# SentryNeko

**English** | [简体中文](README.zh-CN.md)

<img src="src-tauri/app-icon.svg" alt="SentryNeko cat-and-clock logo" width="96" height="96" />

> A Windows desktop productivity tool that combines a todo list, a Pomodoro timer, foreground-app tracking and focus analytics — all data stored locally, no cloud required.

## Overview

SentryNeko is a personal productivity and time-tracking app built for Windows. It puts *task management* and *where the time actually went* in the same place: you plan work with the todo list and Pomodoro timer while the app keeps tracking the foreground application and window title in the background. Heatmaps and charts then answer one question — **where did my time go?**

- Local-first: SQLite storage, no account, no network required
- Always-on but light: runs in the system tray and starts with Windows, the collector works silently
- Real-time feedback: Pomodoro completion, alarm firing and app switches are pushed to the UI via Tauri events
- Bilingual UI: both the interface and backend error messages support multiple languages

## Platform support

**Windows 10 / 11 (x64) only.**

This project has no cross-platform abstraction layer. It calls Win32 APIs directly (`GetForegroundWindow`, `GetWindowText`, `GetTickCount64`, …) and relies on Windows-specific features such as Toast notifications plus registry / Task Scheduler entries for auto-start. macOS and Linux are out of scope, and building on other platforms is not supported.

Runtime requirement: [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (bundled with Windows 11, must be installed separately on Windows 10).

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop framework | Tauri 2.x |
| Backend | Rust (Win32 FFI, SQLite, scheduling, Toast notifications) |
| Frontend | React + TypeScript + Vite |
| Database | SQLite via rusqlite, r2d2 connection pool, one idempotent schema script |
| i18n | i18next / react-i18next (Simplified Chinese, English) |
| State management | Frontend stores + Tauri event subscriptions |

## Planned features

Status legend: ✅ Planned (implemented in the current scope); 🚧 Reserved (future release, models and interfaces are stubbed out now).

### 1. Core productivity

| Feature | Description | Status |
| --- | --- | --- |
| Todo list | Create, read, update, delete; daily, weekly, monthly or custom recurring tasks with automatic cycle resets; optional due dates with a year/month/day picker, local-day overdue indicators and date sorting; toggle completion; filter (all / active / completed); remaining count; separate sections (default), merged list or two columns for one-time and recurring tasks, selected in Settings and saved locally | ✅ Planned |
| Pomodoro timer | 25-minute focus countdown, break countdown, custom durations, start / pause / reset | ✅ Planned |
| Heatmap | Aggregate focus time and completed tasks by day / week / month, GitHub-style rendering | ✅ Planned |
| Alarms | One-off or repeating alarms, custom time, Windows Toast notification plus in-app ringtone | ✅ Planned |

### 2. System collection

| Feature | Description | Status |
| --- | --- | --- |
| Foreground app monitoring | Track the current foreground app name and window title in real time, record switch timestamps, browse history | ✅ Planned |
| Uptime | Record system boot time and compute today's total uptime | ✅ Planned |
| System info | CPU usage, memory usage, disk space (reserved) | 🚧 Reserved |

### 3. Real-time communication

| Feature | Description | Status |
| --- | --- | --- |
| Tauri event push | Push foreground app switches, Pomodoro completion and alarm triggers to the frontend in real time | ✅ Planned |
| System notifications | Windows Toast notifications (alarm ringing, Pomodoro completion reminder) | ✅ Planned |

### 4. Analytics

| Feature | Description | Status |
| --- | --- | --- |
| App usage stats | Aggregate usage time per application and show a Top apps ranking | ✅ Planned |
| Focus trends | Daily / weekly / monthly focus time trend charts | ✅ Planned |
| Task completion rate | Completed tasks / total tasks | ✅ Planned |

### 5. Internationalization

| Feature | Description | Status |
| --- | --- | --- |
| Multi-language support | Simplified Chinese, English, Japanese (reserved) | ✅ Planned |
| Language switching | Switch the language on the settings page, persisted locally | ✅ Planned |

### 6. Social (reserved)

| Feature | Description | Status |
| --- | --- | --- |
| Mutual supervision | Friends / rooms to see each other's online status and focus time | 🚧 Reserved |
| Sharing | Public profile page / share card showing heatmap and stats | 🚧 Reserved |

### 7. System integration

| Feature | Description | Status |
| --- | --- | --- |
| Auto-start with Windows | A settings switch writes the per-user run key, so the app starts at login and waits in the tray | ✅ Planned |
| System tray | Close to tray with a right-click menu (start Pomodoro, view today's stats); launching again restores the existing window | ✅ Planned |
| Global shortcuts | Custom shortcuts to start / pause the Pomodoro timer and show / hide the main window | 🚧 Reserved |

### 8. Settings

| Feature | Description | Status |
| --- | --- | --- |
| Pomodoro settings | Focus duration, break duration, long-break interval, daily goal | ✅ Planned |
| Alarm defaults | Default ring duration and notification method | ✅ Planned |
| Language settings | Switch the interface language | ✅ Planned |
| Sidebar panels | Show/hide and reorder panels from Settings; changes apply immediately and persist across launches | ✅ Planned |
| Font settings | Bundled JetBrains Mono or installed Windows fonts; 10–32 px base size with direct input, wheel and arrows; applied immediately and saved locally | ✅ Planned |
| Data management | Export / import data, clear history | 🚧 Reserved |

The default sidebar shows Dashboard, Todos, Pomodoro, Heatmap, Alarms, Events and Analytics, followed
by the always-visible Settings entry. Use the the drag editor or keyboard controls to reorder panels, or restore the
default layout. Preferences are stored locally under `sentryneko.sidebarLayout` in WebView storage,
alongside the collapsed flag. Missing panels are appended on upgrade; invalid saved data falls
back to the default layout. Hiding an entry leaves its page accessible through other links.
### 9. AI assistance

| Feature | Description | Status |
| --- | --- | --- |
| Semi-automatic AI assistant | Optional local Ollama suggestions; edit, reject or explicitly confirm each action; persistent operation log | ✅ Planned |

See [AI assistance](docs/assistance.md) for local model setup, supported actions and review behavior.

### Summary

| Category | Count |
| --- | --- |
| ✅ Planned | 18 |
| 🚧 Reserved | 5 |
| Total | 23 |

## Project structure

> **Note:** the tree below is the **planned** structure, not the current state of the repository.

```text
SentryNeko/
├── src-tauri/                        # Tauri Rust backend
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs                      # Tauri build script (generates the permission schemas)
│   ├── tauri.conf.json               # Tauri config (window, permissions, bundling)
│   ├── capabilities/
│   │   └── default.json              # Capability config (commands allowed over IPC)
│   ├── app-icon.svg                  # Icon source consumed by `pnpm icons`
│   ├── icons/                        # App icons (generated, not tracked)
│   └── src/
│       ├── main.rs                   # Entry point: starts the Tauri app
│       ├── lib.rs                    # Module registration + Tauri command registration
│       ├── config.rs                 # Config loading (database path, language, …)
│       ├── db/
│       │   ├── mod.rs                # Database module entry
│       │   ├── connection.rs         # SQLite connection pool setup
│       │   ├── schema.rs             # Schema creation script (idempotent)
│       │   └── repository.rs         # Generic data access layer (CRUD)
│       ├── models/
│       │   ├── mod.rs                # Models module entry
│       │   ├── todo.rs               # Todo model
│       │   ├── tag.rs                # Tag model (reserved: labels for tasks)
│       │   ├── pomodoro.rs           # Pomodoro model
│       │   ├── heatmap.rs            # Heatmap data model
│       │   ├── alarm.rs              # Alarm model
│       │   ├── user.rs               # User model (reserved, for sharing / supervision)
│       │   └── app_event.rs          # Foreground app event model
│       ├── commands/                 # Tauri command layer
│       │   ├── mod.rs                # Commands module entry
│       │   ├── todo_commands.rs      # Todo CRUD commands
│       │   ├── tag_commands.rs       # Tag commands (reserved)
│       │   ├── pomodoro_commands.rs  # Pomodoro commands
│       │   ├── heatmap_commands.rs   # Heatmap data commands
│       │   ├── alarm_commands.rs     # Alarm commands
│       │   ├── app_event_commands.rs # Foreground app event query commands
│       │   ├── event_commands.rs     # Event bus commands
│       │   ├── settings_commands.rs  # Settings commands
│       │   └── system_commands.rs    # System info commands (uptime)
│       ├── collectors/               # Windows system collection layer
│       │   ├── mod.rs                # Collectors module entry
│       │   ├── foreground_app.rs     # Foreground app collector (GetForegroundWindow + GetWindowText)
│       │   └── system_info.rs        # System info collection (uptime, CPU, memory, …)
│       ├── services/
│       │   ├── mod.rs                # Services module entry
│       │   ├── scheduler.rs          # Timed task scheduler (alarm triggering)
│       │   ├── notification.rs       # Windows notification push (Toast)
│       │   ├── event_bus.rs          # Event bus (collector → frontend push)
│       │   └── i18n.rs               # Backend i18n (localized error messages)
│       └── utils/
│           ├── mod.rs                # Utils module entry
│           ├── time.rs               # Time handling helpers
│           ├── windows.rs            # Windows-specific API wrappers (Win32 FFI)
│           └── response.rs           # Unified command response format
│
├── src/                              # React frontend (Tauri frontend)
│   ├── main.tsx                      # Entry point
│   ├── App.tsx                       # Root component + router config
│   ├── i18n/                         # Internationalization
│   │   ├── index.ts                  # i18n setup (i18next / react-i18next)
│   │   ├── locales/
│   │   │   ├── zh-CN.json            # Simplified Chinese
│   │   │   ├── en-US.json            # English
│   │   │   └── ja-JP.json            # Japanese (reserved)
│   │   └── config.ts                 # Language config
│   ├── hooks/
│   │   ├── useTodos.ts               # Todo data hook
│   │   ├── usePomodoro.ts            # Pomodoro hook
│   │   ├── useHeatmap.ts             # Heatmap data hook
│   │   ├── useAlarms.ts              # Alarm hook
│   │   ├── useAppEvents.ts           # Foreground app event hook
│   │   ├── useI18n.ts                # Language switching hook
│   │   ├── useTauriEvent.ts          # Tauri event listener wrapper
│   │   └── useWindowControls.ts      # Window controls for the custom title bar
│   ├── components/
│   │   ├── TodoList.tsx              # Todo list component
│   │   ├── TodoItem.tsx              # Single todo item
│   │   ├── AddTodoForm.tsx           # Add-todo form
│   │   ├── PomodoroTimer.tsx         # Pomodoro timer
│   │   ├── PomodoroSettings.tsx      # Phase duration form
│   │   ├── HeatmapChart.tsx          # Heatmap component
│   │   ├── AlarmList.tsx             # Alarm list
│   │   ├── AppEventLog.tsx           # Foreground app event log list
│   │   ├── LanguageSwitcher.tsx      # Language picker used by the settings page
│   │   ├── TitleBar.tsx              # Custom title bar: drag, minimize, maximize, close
│   │   ├── ToastHost.tsx             # In-app toast for a refused system notification
│   │   ├── I18nProvider.tsx          # i18n provider component
│   │   └── ui/                       # Shared component library
│   │       ├── NumericInput.tsx      # Validated numeric input with wheel and arrow stepping
│   │       └── SegmentedControl.tsx  # Segmented switch with a sliding highlight
│   ├── pages/
│   │   ├── Dashboard.tsx             # Main dashboard
│   │   ├── TodosPage.tsx             # Todos page
│   │   ├── PomodoroPage.tsx          # Pomodoro page
│   │   ├── HeatmapPage.tsx           # Heatmap page
│   │   ├── AlarmsPage.tsx            # Alarms page
│   │   ├── SettingsPage.tsx          # Settings page
│   │   ├── EventsPage.tsx            # Event stream page
│   │   └── AnalyticsPage.tsx         # Analytics page
│   ├── stores/
│   │   ├── todoStore.ts              # Todo state
│   │   ├── pomodoroStore.ts          # Pomodoro state
│   │   ├── appEventStore.ts          # Foreground app event state
│   │   └── i18nStore.ts              # Language state
│   ├── styles/
│   │   └── app.css                   # Design tokens and the window shell styles
│   └── types/
│       ├── index.ts                  # Global type definitions
│       ├── todo.ts                   # Todo types
│       ├── tag.ts                    # Tag types (reserved)
│       ├── pomodoro.ts               # Pomodoro types
│       ├── heatmap.ts                # Heatmap types
│       ├── alarm.ts                  # Alarm types
│       ├── appEvent.ts               # Foreground app event types
│       └── i18n.ts                   # i18n type definitions
│
├── docs/                             # Documentation (English + Simplified Chinese)
│   ├── commands.md                   # Tauri command reference
│   ├── database.md                   # Schema, the connection pool and scripts/init_db.ps1
│   ├── events.md                     # Tauri event definitions
│   ├── i18n.md                       # i18n guide
│   └── architecture.md               # Architecture notes
│
├── scripts/
│   ├── init_db.ps1                   # Database initialization script (PowerShell)
│   ├── dev.ps1                       # One-command dev environment (PowerShell)
│   └── check_locales.mjs             # Locale key parity check, run by `pnpm lint`
│
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .gitignore
├── README.md                         # English docs (default)
├── README.zh-CN.md                   # Simplified Chinese docs
├── TODO.md                           # English task breakdown (default)
├── TODO.zh-CN.md                     # Simplified Chinese task breakdown
├── CONTRIBUTING.md                   # English contribution guide (default)
└── CONTRIBUTING.zh-CN.md             # Simplified Chinese contribution guide
```

## Development requirements

| Dependency | Version |
| --- | --- |
| Windows | 10 1903+ / 11 (x64) |
| Node.js | 20 LTS or later |
| Package manager | pnpm (recommended) or npm |
| Rust | stable (MSVC toolchain) |
| Visual Studio Build Tools | with the "Desktop development with C++" workload |
| WebView2 Runtime | latest |

## Getting started

```powershell
# 1. Install frontend dependencies
pnpm install

# 2. Generate the application icons (they are generated artifacts, only app-icon.svg is tracked)
pnpm icons

# 3. Initialize the local database (optional, tables are created on first run)
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1

# 4. Start the dev environment (frontend HMR + Rust backend)
pnpm tauri dev
# or use the convenience script
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

# 5. Build the Windows installer (msi / nsis)
pnpm tauri build
```

> The collector reads foreground window information and runs inside the app, under your own account. If antivirus software blocks it, allow the SentryNeko executable in that tool; there is nothing to register separately. Starting with Windows is a switch on the settings page, which writes one value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Layered architecture, data flow and module responsibilities |
| [docs/commands.md](docs/commands.md) | Tauri command signatures and response format |
| [docs/database.md](docs/database.md) | Schema, the connection pool and `scripts/init_db.ps1` |
| [docs/events.md](docs/events.md) | Tauri event definitions and trigger points |
| [docs/i18n.md](docs/i18n.md) | How copy is organized and how to add a language |
| [docs/tray.md](docs/tray.md) | System tray: close-to-tray, menu entries and the live today line |
| [TODO.md](TODO.md) | Task breakdown, priorities and dependencies |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching, commit conventions and the definition of done |

> Files under `docs/` are bilingual: each one has a Simplified Chinese counterpart named `<name>.zh-CN.md`, for example [docs/commands.zh-CN.md](docs/commands.zh-CN.md).

## License

[Apache License 2.0](LICENSE) © 2026 haloneko

The original application icon (`src-tauri/app-icon.svg`) combines a violet cat silhouette with a clock, using the same slate, violet and off-white palette as the interface. It is covered by the project's Apache License 2.0. Run `pnpm icons` after editing the SVG to regenerate the window, tray and installer icons; generated files under `src-tauri/icons/` are not tracked.

The sidebar settings entry opens a modal drag editor. Pointer and keyboard reordering animate smoothly, visibility changes apply immediately, and closing the editor restores focus to its Edit button.

JetBrains Mono is provided by the locked `@fontsource-variable/jetbrains-mono` dependency under the SIL Open Font License 1.1. The package supplies the font assets at build time; no font binaries are tracked in this repository. Vite includes those assets in the application bundle, so the installed app loads the font offline. System fonts supply missing glyphs, including Chinese.
