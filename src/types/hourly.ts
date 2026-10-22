/** Hourly analytics types: one row per hour, as `models/app_event.rs` and `models/focus_usage.rs` answer. */

/** One basket of the stacked chart: an app and the seconds it held inside one hour. */
export interface HourlyUsage {
  /** UTC epoch seconds of the hour's start. */
  hourStart: number;
  appName: string;
  /** Seconds of that hour the app held the foreground. */
  seconds: number;
}

/** One hour of focus, read from the buckets the minute tick fills. */
export interface FocusHour {
  /** UTC epoch seconds of the hour's start. */
  hourStart: number;
  /** Seconds of that hour spent in a focus phase. */
  seconds: number;
}

/** The two measures the hourly panel can draw. */
export type HourlyKind = "apps" | "focus";

/** Every kind, in the order the switcher shows them. */
export const HOURLY_KINDS = ["apps", "focus"] as const satisfies readonly HourlyKind[];

/** Hours a local day can draw. */
export const HOURS_PER_DAY = 24;

/** How many apps a stack keeps before the rest are folded into one slice. */
export const MAX_STACKED_APPS = 5;

/** Local-calendar window of one day, in UTC epoch seconds. */
export function dayWindow(day: Date): { from: number; to: number } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { from: Math.floor(start.getTime() / 1000), to: Math.floor(end.getTime() / 1000) };
}

/** The local hour a UTC timestamp falls in, `0` to `23`. */
export function localHour(seconds: number): number {
  return new Date(seconds * 1000).getHours();
}

/** One bar of the stack: which app it draws and what the legend calls it. */
export interface StackedApp {
  /** Key of the app inside a row; an index, so an app name never collides with `hour`. */
  key: string;
  name: string;
  /** `true` for the slice that carries every app the stack left out. */
  other?: boolean;
}

/** One row of the stack: the hour and the seconds of every app drawn above it. */
export type StackedRow = { hour: number } & Record<string, number>;

/** A stack ready for the chart: the apps to draw and one row per hour. */
export interface AppStack {
  /** Busiest first, plus the folded slice when some apps were left out. */
  apps: StackedApp[];
  rows: StackedRow[];
}

/**
 * Pivots the buckets into twenty-four rows, keeping the busiest apps apart and folding the rest.
 *
 * The apps are ranked by their total for the day, so the shape of the stack is the same across
 * every hour; a day with more than [`MAX_STACKED_APPS`] apps still stays readable.
 */
export function stackHours(
  usage: readonly HourlyUsage[],
  otherLabel: string,
): AppStack {
  const totals = new Map<string, number>();

  for (const bucket of usage) {
    totals.set(bucket.appName, (totals.get(bucket.appName) ?? 0) + bucket.seconds);
  }

  const ranked = [...totals.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const shown = ranked.slice(0, MAX_STACKED_APPS).map(([name]) => name);
  const apps: StackedApp[] = shown.map((name, index) => ({ key: `a${index}`, name }));
  const folded = `a${shown.length}`;

  if (ranked.length > shown.length) {
    apps.push({ key: folded, name: otherLabel, other: true });
  }

  const rows: StackedRow[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const row: StackedRow = { hour };

    for (const app of apps) {
      row[app.key] = 0;
    }

    return row;
  });

  for (const bucket of usage) {
    const position = shown.indexOf(bucket.appName);
    const key = position === -1 ? folded : `a${position}`;
    const row = rows[localHour(bucket.hourStart)];

    if (row !== undefined) {
      row[key] = (row[key] ?? 0) + bucket.seconds;
    }
  }

  return { apps, rows };
}

/** One point of the focus line. */
export interface FocusRow {
  hour: number;
  seconds: number;
}

/** The day at a glance: what both measures add up to and where the time went. */
export interface DayTotals {
  /** Foreground seconds of every app together. */
  apps: number;
  /** Focus seconds recorded on the day. */
  focus: number;
  /** The app that held the foreground the longest, `null` when nothing was recorded. */
  top: { name: string; seconds: number } | null;
}

/**
 * Folds a day's buckets into the numbers the summary row prints.
 *
 * Ties are broken by name, so the same day always names the same app as its busiest one.
 */
export function dayTotals(
  usage: readonly HourlyUsage[],
  focus: readonly FocusHour[],
): DayTotals {
  const perApp = new Map<string, number>();
  let apps = 0;

  for (const bucket of usage) {
    perApp.set(bucket.appName, (perApp.get(bucket.appName) ?? 0) + bucket.seconds);
    apps += bucket.seconds;
  }

  let top: DayTotals["top"] = null;

  for (const [name, seconds] of perApp) {
    if (
      top === null ||
      seconds > top.seconds ||
      (seconds === top.seconds && name.localeCompare(top.name) < 0)
    ) {
      top = { name, seconds };
    }
  }

  return { apps, focus: focus.reduce((sum, bucket) => sum + bucket.seconds, 0), top };
}

/** Fills the day's hours with the focus seconds read from the buckets. */
export function focusRows(hours: readonly FocusHour[]): FocusRow[] {
  const rows: FocusRow[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
    hour,
    seconds: 0,
  }));

  for (const bucket of hours) {
    const row = rows[localHour(bucket.hourStart)];

    if (row !== undefined) {
      row.seconds += bucket.seconds;
    }
  }

  return rows;
}
