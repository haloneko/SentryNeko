/** Hourly analytics types: one row per hour, as `models/app_event.rs` and `models/focus_usage.rs` answer. */

/** One basket of the stacked chart: an app and the seconds it held inside one hour. */
export interface HourlyUsage {
  /** UTC epoch seconds of the hour's start. */
  hourStart: number;
  appName: string;
  /** Seconds of that hour the app held the foreground. */
  seconds: number;
}

/**
 * One basket of the focus stack: the hours of one category, as `models/focus_usage.rs` answers.
 *
 * An hour that held more than one category answers once per category, which is what the stack
 * draws; the unnamed work arrives as the empty category.
 */
export interface FocusCategoryHour {
  /** UTC epoch seconds of the hour's start. */
  hourStart: number;
  /** The category the stretch was started under; empty for the work nobody named. */
  category: string;
  /** Seconds of that hour filed under the category. */
  seconds: number;
}

/** The two measures the hourly panel can draw. */
export type HourlyKind = "apps" | "focus";

/** Every kind, in the order the switcher shows them. */
export const HOURLY_KINDS = ["apps", "focus"] as const satisfies readonly HourlyKind[];

/** Hours a local day can draw. */
export const HOURS_PER_DAY = 24;

/** How many slices a stack keeps apart before the rest are folded into one slice. */
export const MAX_STACKED_SLICES = 5;

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

/** One slice of a stack: the key it draws under and what the legend calls it. */
export interface StackedSlice {
  /** Key of the slice inside a row; an index, so a name never collides with `hour`. */
  key: string;
  name: string;
  /** `true` for the slice that carries every name the stack left out. */
  other?: boolean;
}

/** One row of the stack: the hour and the seconds of every slice drawn above it. */
export type StackedRow = { hour: number } & Record<string, number>;

/** A stack ready for the chart: the slices to draw and one row per hour. */
export interface Stack {
  /** Busiest first, plus the folded slice when some names were left out. */
  slices: StackedSlice[];
  rows: StackedRow[];
}

/** One slice's seconds inside one hour, whatever the slice is named. */
interface SliceBucket {
  hourStart: number;
  name: string;
  seconds: number;
}

/**
 * Pivots the buckets into twenty-four rows, keeping the busiest slices apart and folding the rest.
 *
 * The slices are ranked by their total for the day, so the shape of the stack is the same across
 * every hour; a day with more than [`MAX_STACKED_SLICES`] of them still stays readable.
 */
function stackBuckets(buckets: readonly SliceBucket[], otherLabel: string): Stack {
  const totals = new Map<string, number>();

  for (const bucket of buckets) {
    totals.set(bucket.name, (totals.get(bucket.name) ?? 0) + bucket.seconds);
  }

  const ranked = [...totals.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const shown = ranked.slice(0, MAX_STACKED_SLICES).map(([name]) => name);
  const slices: StackedSlice[] = shown.map((name, index) => ({ key: `s${index}`, name }));
  const folded = `s${shown.length}`;

  if (ranked.length > shown.length) {
    slices.push({ key: folded, name: otherLabel, other: true });
  }

  const rows: StackedRow[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const row: StackedRow = { hour };

    for (const slice of slices) {
      row[slice.key] = 0;
    }

    return row;
  });

  for (const bucket of buckets) {
    const position = shown.indexOf(bucket.name);
    const key = position === -1 ? folded : `s${position}`;
    const row = rows[localHour(bucket.hourStart)];

    if (row !== undefined) {
      row[key] = (row[key] ?? 0) + bucket.seconds;
    }
  }

  return { slices, rows };
}

/** Stacks a day's app buckets, the app that held the foreground the longest first. */
export function stackHours(usage: readonly HourlyUsage[], otherLabel: string): Stack {
  return stackBuckets(
    usage.map((bucket) => ({
      hourStart: bucket.hourStart,
      name: bucket.appName,
      seconds: bucket.seconds,
    })),
    otherLabel,
  );
}

/**
 * Stacks a day's focus buckets, the category that took the most time first.
 *
 * The work nobody named keeps its empty category on the wire, so it is drawn under
 * `unnamedLabel` instead of as a legend entry with no text.
 */
export function stackFocus(
  hours: readonly FocusCategoryHour[],
  otherLabel: string,
  unnamedLabel: string,
): Stack {
  return stackBuckets(
    hours.map((bucket) => ({
      hourStart: bucket.hourStart,
      name: bucket.category === "" ? unnamedLabel : bucket.category,
      seconds: bucket.seconds,
    })),
    otherLabel,
  );
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
 * The focus seconds are added up from the category buckets the stack already reads, so the total
 * and the drawn slices can never disagree. Ties are broken by name, so the same day always names
 * the same app as its busiest one.
 */
export function dayTotals(
  usage: readonly HourlyUsage[],
  focusCategories: readonly FocusCategoryHour[],
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

  return {
    apps,
    focus: focusCategories.reduce((sum, bucket) => sum + bucket.seconds, 0),
    top,
  };
}
