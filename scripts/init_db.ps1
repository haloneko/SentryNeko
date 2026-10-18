# Creates the SentryNeko SQLite schema without starting the app.
# The DDL must stay in step with src-tauri/src/db/schema.rs —
# cargo test fails when the two sides drift apart.
# Safe to run repeatedly: every statement is idempotent.

[CmdletBinding()]
param(
    [string]$DatabasePath = (Join-Path $env:APPDATA 'com.sentryneko.desktop\sentryneko.db')
)

$ErrorActionPreference = 'Stop'

$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (-not $sqlite) {
    throw 'sqlite3.exe was not found on PATH. Install the SQLite command line tools, or just start the app once: it migrates the database on first run.'
}

$directory = Split-Path -Parent $DatabasePath
if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$schema = @'
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS todos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    completed_at INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    tag_ids      TEXT    NOT NULL DEFAULT '[]',
    due_date     INTEGER
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    phase           TEXT    NOT NULL CHECK (phase IN ('focus', 'short_break', 'long_break')),
    planned_seconds INTEGER NOT NULL,
    actual_seconds  INTEGER,
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER,
    todo_id         INTEGER REFERENCES todos (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name     TEXT    NOT NULL,
    window_title TEXT,
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS alarms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL DEFAULT '',
    hour        INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
    minute      INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 59),
    repeat_days INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reason         TEXT NOT NULL,
    action         TEXT NOT NULL,
    expected_state TEXT NOT NULL,
    revision       INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_operation_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER NOT NULL,
    event         TEXT NOT NULL CHECK (event IN ('proposed', 'edited', 'confirmed', 'rejected')),
    reason        TEXT NOT NULL,
    action        TEXT NOT NULL,
    result_id     INTEGER,
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status ON ai_suggestions (status, id);

CREATE INDEX IF NOT EXISTS idx_todos_completed
    ON todos (completed, created_at);

CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_started_at
    ON pomodoro_sessions (started_at);

CREATE INDEX IF NOT EXISTS idx_app_events_started_at
    ON app_events (started_at);

CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id
    ON todo_tags (tag_id);

CREATE TABLE IF NOT EXISTS todo_recurrences (
    todo_id    INTEGER PRIMARY KEY REFERENCES todos (id) ON DELETE CASCADE,
    unit       TEXT    NOT NULL CHECK (unit IN ('day', 'week', 'month')),
    interval   INTEGER NOT NULL CHECK (interval BETWEEN 1 AND 365),
    current_at INTEGER NOT NULL,
    next_at    INTEGER NOT NULL CHECK (next_at > current_at)
);

CREATE INDEX IF NOT EXISTS idx_todo_recurrences_next_at ON todo_recurrences (next_at);

CREATE TABLE IF NOT EXISTS todo_completions (
    todo_id       INTEGER NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
    occurrence_at INTEGER NOT NULL,
    completed_at  INTEGER NOT NULL,
    PRIMARY KEY (todo_id, occurrence_at)
);

CREATE INDEX IF NOT EXISTS idx_todo_completions_completed_at ON todo_completions (completed_at);
'@

$schema | & $sqlite.Source $DatabasePath
if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the database schema.'
}

$hasDueDate = & $sqlite.Source $DatabasePath "SELECT COUNT(*) FROM pragma_table_info('todos') WHERE name = 'due_date';"
if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the todo schema.'
}
if ($hasDueDate -eq '0') {
    & $sqlite.Source $DatabasePath 'ALTER TABLE todos ADD COLUMN due_date INTEGER;'
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not add the todo due-date column.'
    }
}

Write-Host "Database ready: $DatabasePath"
& $sqlite.Source $DatabasePath "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
