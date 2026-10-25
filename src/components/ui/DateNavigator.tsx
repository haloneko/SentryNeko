import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import { dateFormatter } from "../../utils/intl";
import { daysInMonth } from "./dueDate";
import dateNavigatorStyles from "./DateNavigator.module.css";

export interface DateNavigatorProps {
  /** Which edge the calendar hangs from; a navigator at a card's right edge opens inwards. */
  align?: "end" | "start";
  label: string;
  onChange: (day: number) => void;
  max?: number;
  min?: number;
  value: number;
}

/** Local midnight of the day an epoch second falls in. */
function dayStart(seconds: number): number {
  const date = new Date(seconds * 1000);

  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** The day `delta` days away; the calendar does the arithmetic, so a DST change cannot shift it. */
function shiftDay(day: number, delta: number): number {
  const date = new Date(day * 1000);

  date.setDate(date.getDate() + delta);
  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** The first of the month a day falls in, so a month can be walked without touching the day. */
function monthStart(day: number): number {
  const date = new Date(day * 1000);

  date.setDate(1);
  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** The first of the month `delta` months away; the day is not carried, so the 31st cannot overflow. */
function shiftMonth(day: number, delta: number): number {
  const date = new Date(day * 1000);

  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  date.setHours(0, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** Local midnight of a month's first day; a `month` past December rolls into the next year. */
function firstDayOf(year: number, month: number): number {
  return Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
}

/** `YYYY-MM-DD` for the local day, which is what the grid keys its cells by. */
function isoDay(day: number): string {
  const date = new Date(day * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${dateOfMonth}`;
}

/** One cell of the grid: `null` pads the first and last week so the columns stay under a weekday. */
type Cell = number | null;

/** The weeks a month is drawn as, Monday first, padded to whole weeks. */
function monthCells(cursor: number): Cell[] {
  const date = new Date(cursor * 1000);
  const year = date.getFullYear();
  const month = date.getMonth();
  // `getDay()` counts from Sunday; the grid starts on Monday, so Sunday moves to the end.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const total = daysInMonth(year, month + 1);
  const cells: Cell[] = [...Array.from({ length: lead }, (): Cell => null)];

  for (let dateOfMonth = 1; dateOfMonth <= total; dateOfMonth += 1) {
    cells.push(Math.floor(new Date(year, month, dateOfMonth).getTime() / 1000));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

/**
 * A day with a day either side of it.
 *
 * The arrows move by whole days and stop at `min`/`max`; the day in the middle opens a month grid
 * where any day inside that range can be picked. Only two things are state here: whether the
 * calendar is open, and which month it shows — the chosen day always comes from the caller.
 */
export function DateNavigator({
  align = "start",
  label,
  max,
  min,
  onChange,
  value,
}: DateNavigatorProps) {
  const { language, t } = useI18n();
  const root = useRef<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const months = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  // The calendar has two faces: the days of a month, and the months of a year to jump between them.
  const [picking, setPicking] = useState<"day" | "month">("day");
  const [cursor, setCursor] = useState(() => monthStart(value));
  const [yearCursor, setYearCursor] = useState(() => new Date(value * 1000).getFullYear());
  // A cell to focus once the grid it lives in has been drawn, after a key or an arrow crossed a month.
  const [focusDay, setFocusDay] = useState<string | null>(null);

  const day = dayStart(value);
  const lowest = min === undefined ? null : dayStart(min);
  const highest = max === undefined ? null : dayStart(max);
  const canBack = lowest === null || shiftDay(day, -1) >= lowest;
  const canForward = highest === null || shiftDay(day, 1) <= highest;
  const today = dayStart(Math.floor(Date.now() / 1000));
  const shown = new Date(day * 1000);
  const cursorDate = new Date(cursor * 1000);

  // The closed trigger draws only `shortDate`, and the open calendar the rest: neither set is rebuilt
  // for a render that did not move the day or the month it shows.
  const shortDate = useMemo(
    () =>
      dateFormatter(language, {
        day: "numeric",
        month: "short",
        weekday: "short",
        year: "numeric",
      }).format(shown),
    [language, shown],
  );
  const longDate = useMemo(
    () =>
      dateFormatter(language, {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
      }).format(shown),
    [language, shown],
  );
  const monthTitle = useMemo(
    () =>
      dateFormatter(language, { month: "long", year: "numeric" }).format(cursorDate),
    [language, cursorDate],
  );
  const yearTitle = useMemo(
    () => dateFormatter(language, { year: "numeric" }).format(new Date(yearCursor, 0, 1)),
    [language, yearCursor],
  );
  // 2024-01-01 was a Monday, which is where the grid's columns start.
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        dateFormatter(language, { weekday: "narrow" }).format(new Date(2024, 0, 1 + index)),
      ),
    [language],
  );
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        dateFormatter(language, { month: "short" }).format(new Date(2024, index, 1)),
      ),
    [language],
  );

  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const nextMonthStart = shiftMonth(cursor, 1);
  const canBackMonth = lowest === null || lowest < cursor;
  const canForwardMonth = highest === null || highest >= nextMonthStart;
  const shownMonth = cursorDate.getMonth() + 1;
  const shownYear = cursorDate.getFullYear();

  /** Whether a month holds at least one day inside the range, so the grid never offers a dead end. */
  const monthAllowed = (year: number, month: number): boolean =>
    (lowest === null || firstDayOf(year, month + 1) > lowest) &&
    (highest === null || firstDayOf(year, month) <= highest);

  /** Whether a year holds at least one month the range allows. */
  const yearAllowed = (year: number): boolean =>
    (lowest === null || firstDayOf(year + 1, 1) > lowest) &&
    (highest === null || firstDayOf(year, 1) <= highest);

  const canBackYear = yearAllowed(yearCursor - 1);
  const canForwardYear = yearAllowed(yearCursor + 1);

  /** Leaves the month list for the days of the month on show, parking the focus on a day there. */
  const backToDays = useCallback((): void => {
    const last = shiftDay(nextMonthStart, -1);
    const from = Math.max(cursor, lowest ?? cursor);
    const to = Math.min(last, highest ?? last);

    setPicking("day");
    setFocusDay(isoDay(Math.min(Math.max(day, from), to)));
  }, [cursor, day, highest, lowest, nextMonthStart]);

  // A day picked elsewhere, or a date walked by the arrows, can leave the grid on another month.
  useEffect(() => {
    if (!open) {
      return;
    }

    setCursor(monthStart(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      // The month list sits on top of the days, so it is the nearer layer to leave first.
      if (picking === "month") {
        backToDays();
        return;
      }

      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [backToDays, open, picking]);

  // A cell is only focusable once it exists, so the focus asked for by a key lands on the next frame.
  useEffect(() => {
    if (!open || focusDay === null) {
      return;
    }

    // A jump can land on a month the range has already closed; the nearest open day takes the focus.
    const cell =
      grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`) ??
      grid.current?.querySelector<HTMLElement>("[data-day]:enabled");

    cell?.focus();
    setFocusDay(null);
  }, [cursor, focusDay, open]);

  // The month list opens on the month being read, so a step back to it is one key press away.
  useEffect(() => {
    if (!open || picking !== "month") {
      return;
    }

    months.current?.querySelector<HTMLElement>('[aria-pressed="true"]:enabled')?.focus();
  }, [open, picking]);

  const allowed = (candidate: number): boolean =>
    (lowest === null || candidate >= lowest) && (highest === null || candidate <= highest);

  const pick = (picked: number): void => {
    onChange(dayStart(picked));
    setOpen(false);
    trigger.current?.focus();
  };

  const openCalendar = (): void => {
    setPicking("day");
    setCursor(monthStart(day));
    setYearCursor(new Date(day * 1000).getFullYear());
    setFocusDay(isoDay(day));
    setOpen(true);
  };

  /** Leaves the day grid for the twelve months of the year it is showing. */
  const openMonths = (): void => {
    setYearCursor(shownYear);
    setPicking("month");
  };

  /** Jumps the grid to a month of the year on show, then goes back to reading its days. */
  const chooseMonth = (month: number): void => {
    const first = firstDayOf(yearCursor, month);
    const last = firstDayOf(yearCursor, month + 1) - 1;
    const target = Math.min(
      Math.max(day, first, lowest ?? first),
      Math.min(last, highest ?? last),
    );

    setCursor(first);
    setPicking("day");
    setFocusDay(isoDay(target));
  };

  /** Moves the focus inside the grid without picking, crossing months where the week runs out. */
  const moveFocus = (from: number, delta: number, edge: "first" | "last" | null = null): void => {
    const next =
      edge === "first"
        ? cursor
        : edge === "last"
          ? shiftDay(nextMonthStart, -1)
          : shiftDay(from, delta);

    if (!allowed(next)) {
      return;
    }

    setCursor(monthStart(next));
    setFocusDay(isoDay(next));
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-day]");

    if (cell === null) {
      return;
    }

    const from = Number(cell.dataset.epoch);

    if (!Number.isFinite(from)) {
      return;
    }

    const moves: Record<string, () => void> = {
      ArrowDown: () => {
        moveFocus(from, 7);
      },
      ArrowLeft: () => {
        moveFocus(from, -1);
      },
      ArrowRight: () => {
        moveFocus(from, 1);
      },
      ArrowUp: () => {
        moveFocus(from, -7);
      },
      End: () => {
        moveFocus(from, 0, "last");
      },
      Home: () => {
        moveFocus(from, 0, "first");
      },
      PageDown: () => {
        setCursor(shiftMonth(cursor, canForwardMonth ? 1 : 0));
      },
      PageUp: () => {
        setCursor(shiftMonth(cursor, canBackMonth ? -1 : 0));
      },
    };
    const move = moves[event.key];

    if (move === undefined) {
      return;
    }

    event.preventDefault();
    move();
  };

  return (
    <div className={dateNavigatorStyles.navigator} data-align={align} ref={root}>
      <button
        aria-label={t("datePicker.previousDay")}
        className={dateNavigatorStyles.step}
        disabled={!canBack}
        onClick={() => {
          onChange(shiftDay(day, -1));
        }}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
      </button>

      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${longDate}`}
        className={dateNavigatorStyles.day}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openCalendar();
          }
        }}
        ref={trigger}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <rect height="11" rx="2" width="12" x="2" y="3" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
        <span className={dateNavigatorStyles.dayText}>{shortDate}</span>
      </button>

      <button
        aria-label={t("datePicker.nextDay")}
        className={dateNavigatorStyles.step}
        disabled={!canForward}
        onClick={() => {
          onChange(shiftDay(day, 1));
        }}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>

      {open ? (
        <div aria-label={label} className={dateNavigatorStyles.calendar} role="dialog">
          <div className={dateNavigatorStyles.calendarHead}>
            <button
              aria-label={
                picking === "month" ? t("datePicker.previousYear") : t("datePicker.previousMonth")
              }
              className={dateNavigatorStyles.monthStep}
              disabled={picking === "month" ? !canBackYear : !canBackMonth}
              onClick={() => {
                if (picking === "month") {
                  setYearCursor(yearCursor - 1);
                } else {
                  setCursor(shiftMonth(cursor, -1));
                }
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M10 3.5 5.5 8l4.5 4.5" />
              </svg>
            </button>

            <button
              aria-expanded={picking === "month"}
              aria-label={t("datePicker.months")}
              className={dateNavigatorStyles.titleButton}
              onClick={() => {
                if (picking === "month") {
                  backToDays();
                } else {
                  openMonths();
                }
              }}
              type="button"
            >
              <span aria-live="polite" className={dateNavigatorStyles.monthTitle}>
                {picking === "month" ? yearTitle : monthTitle}
              </span>
              <svg aria-hidden="true" viewBox="0 0 10 6">
                <path d="m1 1 4 4 4-4" />
              </svg>
            </button>

            <button
              aria-label={
                picking === "month" ? t("datePicker.nextYear") : t("datePicker.nextMonth")
              }
              className={dateNavigatorStyles.monthStep}
              disabled={picking === "month" ? !canForwardYear : !canForwardMonth}
              onClick={() => {
                if (picking === "month") {
                  setYearCursor(yearCursor + 1);
                } else {
                  setCursor(shiftMonth(cursor, 1));
                }
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </button>
          </div>

          {picking === "month" ? (
            <div
              aria-label={t("datePicker.months")}
              className={dateNavigatorStyles.months}
              ref={months}
              role="group"
            >
              {monthNames.map((name, index) => {
                const month = index + 1;

                return (
                  <button
                    aria-pressed={month === shownMonth && yearCursor === shownYear}
                    className={dateNavigatorStyles.monthCell}
                    disabled={!monthAllowed(yearCursor, month)}
                    key={month}
                    onClick={() => {
                      chooseMonth(month);
                    }}
                    type="button"
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className={dateNavigatorStyles.weekdays}>
                {weekdays.map((weekday, index) => (
                  <span className={dateNavigatorStyles.weekday} key={`${weekday}-${index}`}>
                    {weekday}
                  </span>
                ))}
              </div>

              <div
                aria-label={monthTitle}
                className={dateNavigatorStyles.grid}
                onKeyDown={onGridKeyDown}
                ref={grid}
                role="group"
              >
                {cells.map((cell, index) =>
                  cell === null ? (
                    <span
                      aria-hidden="true"
                      className={dateNavigatorStyles.blank}
                      key={`blank-${index}`}
                    />
                  ) : (
                    <button
                      aria-current={cell === today ? "date" : undefined}
                      aria-label={dateFormatter(language, {
                        day: "numeric",
                        month: "long",
                        weekday: "long",
                        year: "numeric",
                      }).format(new Date(cell * 1000))}
                      aria-pressed={cell === day}
                      className={dateNavigatorStyles.cell}
                      data-day={isoDay(cell)}
                      data-epoch={cell}
                      data-selected={cell === day}
                      data-today={cell === today}
                      disabled={!allowed(cell)}
                      key={cell}
                      onClick={() => {
                        pick(cell);
                      }}
                      tabIndex={cell === day ? 0 : -1}
                      type="button"
                    >
                      {new Date(cell * 1000).getDate()}
                    </button>
                  ),
                )}
              </div>
            </>
          )}

          {/* The way back to today belongs to the calendar: the row above only steps a day at a time. */}
          <div className={dateNavigatorStyles.calendarFoot}>
            <button
              className={dateNavigatorStyles.todayButton}
              disabled={!allowed(today)}
              onClick={() => {
                pick(today);
              }}
              type="button"
            >
              {t("datePicker.today")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
