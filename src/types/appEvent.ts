/** Foreground application event types, mirrored from `models/app_event.rs`. */

/** One episode of an application in the foreground; the collector pushes each new one. */
export interface AppEvent {
  id: number;
  /** Executable file name without its extension, e.g. `chrome`. */
  appName: string;
  /** Caption of the window when the app reached the foreground. */
  windowTitle: string | null;
  /** UTC epoch seconds. */
  startedAt: number;
  /** UTC epoch seconds; the collector moves it forward with every report while the app stays in front. */
  endedAt: number | null;
}

/** One page of the event stream, mirrored from `models::app_event::AppEventPage`. */
export interface AppEventPage {
  /** Newest first. */
  events: readonly AppEvent[];
  /** Whether rows older than the last one of `events` exist. */
  more: boolean;
}

/** One line of the usage ranking, mirrored from `models::app_event::AppUsage`. */
export interface AppUsage {
  appName: string;
  /** Seconds the app held the foreground inside the asked window, merged over every row. */
  seconds: number;
}

/** Time ranges the ranking can be switched between. */
export type UsageRange = "today" | "week" | "month";

/** Every range, in the order the switcher shows them. */
export const USAGE_RANGES = ["today", "week", "month"] as const satisfies readonly UsageRange[];

/** Days one range spans, counting today as the last of them. */
const RANGE_DAYS: Record<UsageRange, number> = { month: 30, today: 1, week: 7 };

/**
 * Local-calendar window of a range preset, in UTC epoch seconds, ending at `now`.
 *
 * The start is local midnight, so "today" means the day the user is in rather than the last 24
 * hours; the backend clips stored rows to this window.
 */
export function usageWindow(range: UsageRange, now = new Date()): { from: number; to: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1));

  return { from: Math.floor(start.getTime() / 1000), to: Math.floor(now.getTime() / 1000) };
}
