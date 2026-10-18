# Contributing to SentryNeko

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for your interest in SentryNeko. This guide covers the environment, the conventions we follow, and the bar a change has to clear before it lands.

## Before you start

- **Windows only.** SentryNeko targets Windows 10/11 (x64) and has no cross-platform abstraction on purpose. Do not add `cfg(target_os = ...)` branches, platform-agnostic wrappers, or build guidance for macOS/Linux. All Win32 calls belong in `src-tauri/src/utils/windows.rs`.
- **Local-first.** No telemetry, no accounts, no cloud calls. Data lives in a local SQLite file and stays there.
- **Read [TODO.md](TODO.md) first.** It is the single source of truth for scope and priority. Work on P0 before P1, and do not start P3 (reserved) items — if one becomes necessary, promote it to P2 in review first.
- **The directory structure in the README is the agreed layout.** Add new files to the matching layer (`models` / `commands` / `collectors` / `services` / `utils`) instead of introducing new top-level modules.

## Development setup

Follow [README.md](README.md#development-requirements) for the toolchain (Windows 10 1903+, Node.js 20 LTS+, Rust stable MSVC, VS Build Tools with "Desktop development with C++", WebView2 Runtime).

```powershell
pnpm install
pnpm tauri dev          # frontend HMR + Rust backend
```

## Branching

| Change type | Branch | Notes |
| --- | --- | --- |
| Feature | `feat/<task-id>-<slug>` (e.g. `feat/t12-foreground-collector`) | Always include the TODO id |
| Bug fix | `fix/<slug>` | |
| Docs / metadata only | `docs/<slug>` | |
| Tooling, deps, CI | `chore/<slug>` | |

## Commit messages

English, [Conventional Commits](https://www.conventionalcommits.org/) style, imperative mood, subject ≤ 72 characters. The body explains *what* and *why*; reference the TODO id when a task is involved.

```
feat(pomodoro): persist focus sessions when a cycle completes

Sessions are written on phase transition instead of on window close,
so a crash no longer loses the current cycle.

Refs: T11
```

```
fix(collector): skip duplicate rows for an unchanged foreground window
docs: mark directory structure as planned rather than current
refactor(response): remove bare returns from the command layer
test(heatmap): cover week boundary aggregation
```

Types in use: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

**Scope names** follow the modules: `pomodoro`, `todo`, `collector`, `alarm`, `heatmap`, `tray`, `i18n`, `db`, `response`, plus `ui` for the frontend shell (router, layout, pages).

## Definition of done

A change is ready for review when every box is ticked:

- [ ] The matching TODO.md item is marked `[x]` **in the same commit** that implements it, and the commit message carries its T-id.
- [ ] `cargo fmt --check` and `cargo clippy -- -D warnings` are clean (run from `src-tauri/`).
- [ ] `cargo test` passes; new pure logic (aggregation, time bucketing, scheduling) comes with tests.
- [ ] `pnpm lint` and `pnpm build` pass. In the frontend, TypeScript is strict — no `any`, no `@ts-ignore` without a comment explaining why.
- [ ] No `unwrap()` / `expect()` on any path a user can trigger; return the unified error response instead.
- [ ] Tauri commands return the shared envelope from `utils/response.rs`; their signature is added to `docs/commands.md` + `docs/commands.zh-CN.md`.
- [ ] New Tauri events are documented in `docs/events.md` with payload type and trigger point.
- [ ] Every user-visible string exists in both `src/i18n/locales/zh-CN.json` and `en-US.json` (`pnpm lint` checks that the key sets match); backend errors are returned as codes mapped in `services/i18n.rs`. No hardcoded UI copy.
- [ ] Behavior, scope or priority changed → the relevant section of `README.md` / `TODO.md` / `docs/*.md` is updated in the same commit.
- [ ] No debug prints, commented-out code, or in-code TODO markers. Open work belongs in TODO.md.
- [ ] No cross-platform abstraction was introduced; all Win32 usage goes through `utils/windows.rs`.

## Code conventions

**Rust (`src-tauri/`)**

- Keep layers one-directional: `commands` → `services` / `db` → `models`, with `collectors` feeding `services::event_bus` and `db`.
- A command handler stays thin: validate input, delegate, map the result to `utils::response`.
- Collectors never touch the UI directly; they emit on the event bus and persist via `db::repository`.
- Timestamps are stored as UTC epoch values and formatted in `utils/time.rs`; never store pre-formatted local strings.
- Keep the tray/collector thread off the UI thread; scheduling belongs to `services/scheduler.rs`.

**React / TypeScript (`src/`)**

- Function components and hooks only. Data access lives in `src/hooks`, state in `src/stores`, shapes in `src/types`.
- No Tauri `invoke` calls inside components — go through a hook or a store.
- Share the Tauri event listener wrapper from `hooks/useTauriEvent.ts` instead of calling `listen` directly, so subscriptions are cleaned up on unmount.
- Countdowns and durations are derived from timestamps, never from accumulated `setInterval` ticks.
- Charts must handle loading, empty and error states.
- Styles live in `src/styles/app.css`: design tokens on `:root`, then the shell and the shared primitives. Inline styles only for values that come from state, such as a measured position.
- A reusable, feature-agnostic control belongs in `src/components/ui/` and takes its copy as props; a component only one page uses stays in `src/components/`.

## Testing

```powershell
# backend
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# frontend
pnpm lint
pnpm test
pnpm build

# numeric input browser regressions (install Chromium once)
pnpm exec playwright install chromium
pnpm test:numeric-input
```

`NumericInput` in `src/components/ui/` takes a numeric `value`, `onChange`, optional
`min` / `max` / positive `step` (default `1`), and translated `increaseLabel` /
`decreaseLabel` props. Use a linked label or `aria-label` for the input itself. Values
are clamped and manual input is rounded to the nearest step relative to `min` (or
zero). Temporary blanks, signs and decimal points stay editable and settle to the
current value on blur or Enter. Wheel and arrow adjustments publish immediately;
disabled and read-only inputs allow the page to scroll normally.

Anything touching foreground-app collection, notifications, tray behavior or auto-start also needs a manual pass on real Windows hardware: switch between a few apps, leave the machine idle, lock the screen, and resume from sleep, then confirm the recorded events and durations look sane.

## Documentation

| Change | Update |
| --- | --- |
| New or changed Tauri command | `docs/commands.md` + `docs/commands.zh-CN.md` |
| New or changed Tauri event | `docs/events.md` + `docs/events.zh-CN.md` |
| Table, column, migration, pool setting or config field | `docs/database.md` + `docs/database.zh-CN.md` |
| Copy, locale key, language list | `docs/i18n.md` + `docs/i18n.zh-CN.md` |
| Layer, data flow, module responsibility | `docs/architecture.md` + `docs/architecture.zh-CN.md` |
| Scope, priority, milestone | `TODO.md` + `TODO.zh-CN.md` |
| Feature list, setup steps, structure | `README.md` + `README.zh-CN.md` |

**Bilingual policy:** README, TODO, CONTRIBUTING and every file under `docs/` are maintained in both English (default) and Simplified Chinese — `<name>.md` and `<name>.zh-CN.md`. When you change one, update its counterpart in the same commit and keep the two files structurally identical — same headings, same order, same tables.

## Reporting bugs

Open an issue with:

1. Windows version and build (`winver`), plus app version.
2. Steps to reproduce — the smallest sequence that shows the problem.
3. Expected vs. actual behavior.
4. Whether the collector was running, and whether the issue survives a restart.
5. Relevant logs and, when data looks wrong, the aggregation window you used.

For feature requests, check [TODO.md](TODO.md) first: reserved (🚧) items are already tracked, so a request that matches one is best expressed as "+1 plus reasoning on priority".

## License

By contributing you agree that your work is licensed under the [Apache License 2.0](LICENSE), without any additional terms.
