/** One row of the backend `settings` table, which every preference goes through. */

export interface Setting {
  key: string;
  /** JSON text; the caller owns the shape inside. */
  value: string;
  category: string;
  updatedAt: number;
}

/** Keys the app stores today; the backend knows their shape and their category. */
export const POMODORO_DURATIONS_KEY = "pomodoro.durations";
export const ALARM_DEFAULTS_KEY = "alarm.defaults";

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
