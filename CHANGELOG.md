# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

## v0.2.0 — 2026-10-27

Focus records now know what the time was spent on.

### Added

- Name a pomodoro before it starts; leave it blank to file the work as unnamed
- The focus chart stacks by category and shares the app chart's palette and legend
- Categories beyond the busiest five fold into one "Other categories" slice

### Improved

- The focus total and the chart read the same rows, so they can no longer disagree
- The heatmap, todo list and alarm scheduler fetch a window in one query instead of one per row
- The todo page, event stream, heatmap and date pickers skip work they have already done
- The first start after upgrading carries the data into `sentryneko-0.2.0.db`; past focus shows as unnamed

## v0.1.0 — 2026-10-22

First release: dashboard, todo list with tags, pomodoro, foreground app collection, heatmap,
event stream, alarms, tray, two languages and themes.
