/** Reading the stream as a timeline: local days, clocks, durations, and a colour per app. */

import type { AppEvent } from "../../types/appEvent";

/** Local midnight of the day an epoch second falls in, in epoch seconds. */
export function dayStart(seconds: number): number {
  const date = new Date(seconds * 1000);

  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/**
 * Local midnight of the next day.
 *
 * Adding a day on the calendar rather than 86400 seconds keeps the window a day long across a
 * daylight-saving change, where the day itself is 23 or 25 hours.
 */
export function nextDayStart(day: number): number {
  return dayStep(day, 1);
}

/** The day before or after `day`, both taken at local midnight. */
export function dayStep(day: number, direction: -1 | 1): number {
  const date = new Date(day * 1000);

  date.setDate(date.getDate() + direction);
  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** The wall clock of an epoch second, as the language the app runs in writes it. */
export function clock(seconds: number, language: string): string {
  return new Date(seconds * 1000).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * `HH:MM` on the axis, always in 24-hour form: the axis is read against a day, not against a
 * locale's meridiem. The end of the day reads as `24:00`, never as the `00:00` it shares with the
 * next one.
 */
export function axisClock(seconds: number, dayEnd: number): string {
  if (seconds >= dayEnd) {
    return "24:00";
  }

  const date = new Date(seconds * 1000);

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `m:ss` under an hour, `h:mm:ss` above it; a stretch in progress grows with every push. */
export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** A small, stable hash: the same app has to keep its colour across days and reloads. */
function hash(name: string): number {
  let value = 0;

  for (const char of name.toLowerCase()) {
    value = (value * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  }

  return value;
}

export interface AppColor {
  /** The dot and the axis marker. */
  strong: string;
  /** The wash behind the app's name. */
  tint: string;
}

/**
 * The colour an app is drawn in.
 *
 * The hue comes from the name, so a colour always means the same app on this page and two apps only
 * meet in colour when their names hash close together. The wheel runs from amber round to rose,
 * leaving the red the page reserves for errors, and the name stays on the tinted chip as well,
 * because a colour alone must never be the only thing carrying the meaning.
 */
export function appColor(appName: string): AppColor {
  const hue = 20 + (hash(appName) % 321);

  return { strong: `hsl(${hue} 60% 56%)`, tint: `hsl(${hue} 60% 56% / 16%)` };
}

/** One run of the axis: an app's colour held across a slice of the window, as ratios of it. */
export interface AxisTick {
  appName: string;
  /** Start of the run, `0` at the window's left edge and `1` at its right. */
  start: number;
  /** End of the run, in the same ratios. */
  end: number;
}

/**
 * How many slices the axis is cut into before an app is chosen for each.
 *
 * A day can hold tens of thousands of switches, which is far more marks than a few hundred pixels
 * can carry. The axis therefore keeps one mark per slice — the app that held the longest stretch
 * inside it — and neighbouring slices of the same app merge into one run, so the bar stays a few
 * hundred elements however busy the day was.
 */
export const AXIS_SLICES = 360;

/** The runs the axis draws for `events` inside `[from, to)`. */
export function axisTicks(
  events: readonly AppEvent[],
  from: number,
  to: number,
  slices = AXIS_SLICES,
): readonly AxisTick[] {
  const span = Math.max(1, to - from);
  const sliceOf = (seconds: number): number =>
    Math.min(slices - 1, Math.max(0, Math.floor(((seconds - from) / span) * slices)));

  // Per slice: which app covered the most of it, and for how many seconds.
  const best = new Map<number, { appName: string; seconds: number }>();

  for (const event of events) {
    const start = Math.max(from, event.startedAt);
    // A switch recorded with no length still happened: keep it a hair wide in its slice.
    const end = Math.min(to, Math.max(event.endedAt ?? start + 1, start + 1));

    if (end <= from || start >= to) {
      continue;
    }

    for (let slice = sliceOf(start); slice <= sliceOf(end - 1); slice += 1) {
      const sliceStart = from + (slice / slices) * span;
      const sliceEnd = from + ((slice + 1) / slices) * span;
      const seconds = Math.min(end, sliceEnd) - Math.max(start, sliceStart);
      const held = best.get(slice);

      if (held === undefined || seconds > held.seconds) {
        best.set(slice, { appName: event.appName, seconds });
      }
    }
  }

  const runs: { appName: string; first: number; last: number }[] = [];

  for (let slice = 0; slice < slices; slice += 1) {
    const held = best.get(slice);

    if (held === undefined) {
      continue;
    }

    const last = runs.at(-1);

    if (last !== undefined && last.appName === held.appName && last.last === slice - 1) {
      last.last = slice;
    } else {
      runs.push({ appName: held.appName, first: slice, last: slice });
    }
  }

  return runs.map((run) => ({
    appName: run.appName,
    end: (run.last + 1) / slices,
    start: run.first / slices,
  }));
}
