/** Calendar-day helpers shared by the due date control: a day is `YYYY-MM-DD`, never an instant. */

/** A calendar day, split into the three dropdowns that pick it. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** Splits a stored day; anything that is not `YYYY-MM-DD` answers `null`. */
export function splitDay(value: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) {
    return null;
  }

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Joins the three parts, zero-padded so the string also compares and sorts as a day. */
export function joinDay(year: number, month: number, day: number): string {
  const paddedYear = String(year).padStart(4, "0");
  const paddedMonth = String(month).padStart(2, "0");
  const paddedDay = String(day).padStart(2, "0");

  return `${paddedYear}-${paddedMonth}-${paddedDay}`;
}

/** The local calendar day of a `Date`. */
export function isoDay(date: Date): string {
  return joinDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Today in the local time zone: the day every due date is measured against. */
export function todayDay(): string {
  return isoDay(new Date());
}

/** Shifts a day by whole days; the local calendar does the arithmetic, so DST cannot move it. */
export function shiftDay(value: string, days: number): string {
  const parts = splitDay(value);

  if (parts === null) {
    return value;
  }

  return isoDay(new Date(parts.year, parts.month - 1, parts.day + days));
}

/** Days in a month; February follows the leap-year rule the calendar already knows. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** A wall-clock time, split into the two fields that pick it. */
export interface ClockTime {
  hour: number;
  minute: number;
}

const DATE_TEXT = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
/** The same day typed as one run of digits: `20261019`. */
const DATE_RUN = /^(\d{4})(\d{2})(\d{2})$/;
const TIME_TEXT = /^(\d{1,2}):(\d{1,2})$/;
/** A clock time typed as one run of digits: `905` is 9:05, `0905` is 9:05 as well. */
const TIME_RUN = /^(\d{1,2})(\d{2})$/;
/** A whole day and time typed as one run: `202610190905`, and the half-finished forms on the way. */
const MOMENT_RUN = /^(\d{8})(\d{1,4})$/;

/** Whether the three parts name a day the calendar has, so February the 30th is refused. */
function isRealDay(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Reads a typed date (`2026-10-19`, also `2026/10/19` or `2026.10.19`) or the same day as one run
 * of digits (`20261019`). A day the month does not have is refused rather than rolled into the
 * next month.
 */
export function parseDateText(text: string): CalendarDay | null {
  const trimmed = text.trim();
  const match = DATE_TEXT.exec(trimmed) ?? DATE_RUN.exec(trimmed);

  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return isRealDay(year, month, day) ? { year, month, day } : null;
}

/**
 * Reads a typed clock time (`9:05` or `09:05`), or one written as a run of digits (`905`, `0905`).
 * The run is read the way a person types it: the last two digits are the minutes, so `202` is 2:02.
 * Anything outside a day is refused.
 */
export function parseTimeText(text: string): ClockTime | null {
  const trimmed = text.trim();
  const match = TIME_TEXT.exec(trimmed) ?? TIME_RUN.exec(trimmed);

  if (match === null) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

/** A day and a time read off one run of digits. */
export interface CompactMoment {
  day: CalendarDay;
  time: ClockTime;
}

/**
 * Reads a day and a clock typed as a single run (`202610190905`), which is what a numeric keypad
 * produces when nobody stops to type a separator.
 *
 * The first eight digits are the day and the rest is the time: `0905` and `905` are both 9:05, and
 * a bare `9` or `09` is that hour with no minutes, which is where a left-to-right run stands before
 * the minutes are typed. A run that names nothing the calendar has answers `null`.
 */
export function parseCompactMoment(text: string): CompactMoment | null {
  const match = MOMENT_RUN.exec(text.trim());

  if (match === null) {
    return null;
  }

  const day = parseDateText(match[1] ?? "");
  const tail = match[2] ?? "";
  const time = tail.length <= 2 ? { hour: Number(tail), minute: 0 } : parseTimeText(tail);

  if (day === null || time === null || time.hour > 23) {
    return null;
  }

  return { day, time };
}

/** The instant a local calendar day and clock time name, in UTC epoch seconds. */
export function instantOf(day: CalendarDay, time: ClockTime): number {
  return Math.floor(
    new Date(day.year, day.month - 1, day.day, time.hour, time.minute, 0, 0).getTime() / 1000,
  );
}


