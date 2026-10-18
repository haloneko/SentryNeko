/** Calendar dates use UTC midnight as a stable, timezone-independent storage value. */

export const MIN_DATE_YEAR = 1970;
export const MAX_DATE_YEAR = 9999;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** Number of days in a one-based month, including the Gregorian leap-year rules. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Changing month or year keeps the day where possible, otherwise uses the last day. */
export function dateFromParts({ year, month, day }: DateParts): number {
  return (
    Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))) / 1000
  );
}

export function dateParts(value: number): DateParts {
  const date = new Date(value * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Resolve today/tomorrow from the local calendar, including DST and year boundaries. */
export function relativeDate(offset: number, now = new Date()): number {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  return dateFromParts({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}
