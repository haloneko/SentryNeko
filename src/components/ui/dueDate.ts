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
