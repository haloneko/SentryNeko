/** Optional calendar date selected through native, keyboard-accessible dropdowns. */

import {
  dateFromParts,
  dateParts,
  daysInMonth,
  MAX_DATE_YEAR,
  MIN_DATE_YEAR,
  relativeDate,
} from "./calendarDate";
import type { DateParts } from "./calendarDate";

interface DatePickerLabels {
  label: string;
  year: string;
  month: string;
  day: string;
  clear: string;
  today: string;
  tomorrow: string;
}

interface DatePickerProps {
  /** UTC epoch seconds at midnight, or no date. */
  value: number | null;
  onChange: (value: number | null) => void;
  labels: DatePickerLabels;
  locale: string;
  disabled?: boolean;
}

export function DatePicker({
  value,
  onChange,
  labels,
  locale,
  disabled,
}: DatePickerProps) {
  const selected = dateParts(value ?? relativeDate(0));
  const lastYear = Math.min(
    MAX_DATE_YEAR,
    Math.max(new Date().getFullYear() + 100, selected.year),
  );
  const years = Array.from(
    { length: lastYear - MIN_DATE_YEAR + 1 },
    (_, index) => MIN_DATE_YEAR + index,
  );
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const days = Array.from(
    { length: daysInMonth(selected.year, selected.month) },
    (_, index) => index + 1,
  );
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });

  const change = (part: keyof DateParts, next: string) => {
    onChange(dateFromParts({ ...selected, [part]: Number(next) }));
  };

  return (
    <fieldset className="date-picker" disabled={disabled}>
      <legend>{labels.label}</legend>
      <div className="date-picker-controls">
        <label>
          <span>{labels.year}</span>
          <select
            aria-label={labels.year}
            onChange={(event) => {
              change("year", event.target.value);
            }}
            value={value === null ? "" : selected.year}
          >
            <option disabled value="">
              {labels.year}
            </option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{labels.month}</span>
          <select
            aria-label={labels.month}
            onChange={(event) => {
              change("month", event.target.value);
            }}
            value={value === null ? "" : selected.month}
          >
            <option disabled value="">
              {labels.month}
            </option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthFormat.format(Date.UTC(selected.year, month - 1, 1))}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{labels.day}</span>
          <select
            aria-label={labels.day}
            onChange={(event) => {
              change("day", event.target.value);
            }}
            value={value === null ? "" : selected.day}
          >
            <option disabled value="">
              {labels.day}
            </option>
            {days.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <div className="date-picker-actions">
          <button
            className="btn"
            onClick={() => {
              onChange(relativeDate(0));
            }}
            type="button"
          >
            {labels.today}
          </button>
          <button
            className="btn"
            onClick={() => {
              onChange(relativeDate(1));
            }}
            type="button"
          >
            {labels.tomorrow}
          </button>
          <button
            className="btn"
            disabled={value === null}
            onClick={() => {
              onChange(null);
            }}
            type="button"
          >
            {labels.clear}
          </button>
        </div>
      </div>
    </fieldset>
  );
}
