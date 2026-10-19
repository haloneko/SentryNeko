/** One row of the backend `settings` table, which every preference goes through. */

export interface Setting {
  key: string;
  /** JSON text; the caller owns the shape inside. */
  value: string;
  category: string;
  updatedAt: number;
}

/** One preference: the row it lives in and the subject that row is filed under. */
export interface SettingEntry {
  /** Subject the row is listed under. */
  readonly category: string;
  readonly key: string;
}

/**
 * Keys the app stores today.
 *
 * The backend is a plain key/value store and never looks inside a value, so a store names the
 * category of what it writes and owns the shape within: it checks a payload before writing one and
 * normalizes what it reads back.
 */
export const SETTINGS = {
  alarmDefaults: { category: "alarm", key: "alarm.defaults" },
  dashboardGrid: { category: "dashboard", key: "dashboard.grid" },
  pomodoroDurations: { category: "pomodoro", key: "pomodoro.durations" },
  sidebarPanels: { category: "sidebar", key: "sidebar.panels" },
} as const satisfies Record<string, SettingEntry>;

/**
 * Parses a row's payload, answering `fallback` when the row is missing or unreadable.
 *
 * A missing row is the normal first launch, and an unreadable one is a payload from an older
 * build; either way the defaults are better than a broken screen.
 */
export function parseSetting<T>(row: Setting | null, fallback: T): T {
  if (row === null) {
    return fallback;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

