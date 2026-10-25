/** A text field with a picker button: type a moment by hand, or choose it from the panel. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import { dateFormatter } from "../../utils/intl";
import {
  daysInMonth,
  instantOf,
  isoDay,
  parseCompactMoment,
  parseDateText,
  parseTimeText,
  shiftDay,
  splitDay,
  todayDay,
} from "./dueDate";
import type { ClockTime } from "./dueDate";
import dateTimeFieldStyles from "./DateTimeField.module.css";

export type DateTimeMode = "date" | "datetime" | "time";

export interface DateTimeFieldProps {
  /** Accessible name shared by the input and the picker button. */
  label: string;
  /** What the field picks: a day, a clock time, or both. */
  mode?: DateTimeMode;
  /** Called with the chosen moment in UTC epoch seconds, or `null` when the text is cleared. */
  onChange: (value: number | null) => void;
  /**
   * Heading the open panel reads. The caller owns this wording, because only it knows what the
   * field is for — a start, a due date, a reminder — while the panel itself does not. Defaults to
   * `label`, which is a sensible name for a field that stands on its own.
   */
  panelLabel?: string;
  /** The chosen moment in UTC epoch seconds, or `null` while there is none. */
  value: number | null;
}

/** The current year first, with a year either side and enough ahead to plan with. */
const YEARS_BEFORE = 1;
const YEARS_AFTER = 10;

/** What an empty panel shows before the first turn: today at nine, or today's midnight. */
const DEFAULT_HOUR = 9;

const PLACEHOLDERS: Record<DateTimeMode, string> = {
  date: "YYYY-MM-DD",
  datetime: "YYYY-MM-DD HH:mm",
  time: "HH:mm",
};

/** One option of a select: what the reader sees, and the value it stands for. */
interface Option {
  label: string;
  value: number;
}

/** The hours and the minutes of a clock, which never change and so are built once. */
const HOUR_OPTIONS: Option[] = Array.from({ length: 24 }, (_, hour) => ({
  label: String(hour).padStart(2, "0"),
  value: hour,
}));
const MINUTE_OPTIONS: Option[] = Array.from({ length: 60 }, (_, minute) => ({
  label: String(minute).padStart(2, "0"),
  value: minute,
}));

type ParsedDraft =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { epoch: number; kind: "value" };

/** The moment an empty panel shows: today at nine, or today's midnight for a day pick. */
function startingPoint(mode: DateTimeMode): Date {
  const date = new Date();

  date.setHours(mode === "date" ? 0 : DEFAULT_HOUR, 0, 0, 0);

  return date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The text the input shows for a stored moment. */
function formatValue(value: number | null, mode: DateTimeMode): string {
  if (value === null) {
    return "";
  }

  const date = new Date(value * 1000);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (mode === "date") {
    return day;
  }

  if (mode === "time") {
    return clock;
  }

  return `${day} ${clock}`;
}

/** Reads what was typed. A lone day in `datetime` mode means midnight; a lone time means today. */
function parseDraft(text: string, mode: DateTimeMode): ParsedDraft {
  const trimmed = text.trim();

  if (trimmed === "") {
    return { kind: "empty" };
  }

  const now = new Date();
  const today = { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };

  if (mode === "date") {
    const day = parseDateText(trimmed);

    return day === null
      ? { kind: "invalid" }
      : { epoch: instantOf(day, { hour: 0, minute: 0 }), kind: "value" };
  }

  if (mode === "time") {
    const time = parseTimeText(trimmed);

    return time === null ? { kind: "invalid" } : { epoch: instantOf(today, time), kind: "value" };
  }

  // A run of digits carries both halves at once (`202610190905`), so it is read before the text is
  // split on a separator it does not have.
  const run = parseCompactMoment(trimmed);

  if (run !== null) {
    return { epoch: instantOf(run.day, run.time), kind: "value" };
  }

  const [head = "", ...rest] = trimmed.split(/[ T]+/);
  const day = parseDateText(head);

  if (day !== null) {
    const tail = rest.join(" ");
    const time: ClockTime | null =
      tail === "" ? { hour: 0, minute: 0 } : parseTimeText(tail);

    return time === null
      ? { kind: "invalid" }
      : { epoch: instantOf(day, time), kind: "value" };
  }

  const time = parseTimeText(trimmed);

  return time === null ? { kind: "invalid" } : { epoch: instantOf(today, time), kind: "value" };
}

/** One choice in a dropdown; the value is the number the calendar needs. */
interface DueOption {
  label: string;
  value: number;
}

interface DueSelectProps {
  label: string;
  onChange: (value: number) => void;
  /** Steps the value by `delta`, so the mouse wheel can move a field without opening it. */
  onStep?: (delta: number) => void;
  options: readonly DueOption[];
  value: number;
}

/**
 * One field of the panel: a label sitting on the outline, a button that opens a listbox, and the
 * menu itself. A native `<select>` would draw its popup with the operating system's own styling,
 * which is the one part of the picker that cannot be made to look at home beside the rest.
 */
function DueSelect({ label, onChange, onStep, options, value }: DueSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  // React's wheel listener is passive, so it cannot stop the page from scrolling; the field binds
  // its own non-passive listener and turns the wheel into one step of the value.
  useEffect(() => {
    const element = trigger.current;

    if (element === null || onStep === undefined) {
      return undefined;
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      onStep(event.deltaY < 0 ? 1 : -1);
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [onStep]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (field.current !== null && !field.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // The chosen row is where the eye expects to land, so it takes focus and is scrolled into view.
  useEffect(() => {
    if (!open) {
      return;
    }

    const chosen = menu.current?.querySelector<HTMLElement>('[aria-selected="true"]');

    chosen?.focus();
    chosen?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const choose = (next: number): void => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "Escape") {
      // The menu is the nearest layer, so it closes before the panel underneath it.
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[index]?.click();
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();

      if (items.length === 0) {
        return;
      }

      let next = index;

      if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = items.length - 1;
      } else if (event.key === "ArrowDown") {
        next = index < 0 ? 0 : (index + 1) % items.length;
      } else {
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      }

      items[next]?.focus();
    }
  };

  return (
    <div className={dateTimeFieldStyles.dueDateField} ref={field}>
      <span className={dateTimeFieldStyles.dueDateFieldName}>{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label} ${selected?.label ?? ""}`.trim()}
        className={dateTimeFieldStyles.dueDateSelect}
        onClick={() => {
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
        ref={trigger}
        title={onStep === undefined ? undefined : t("dueDate.scrollHint")}
        type="button"
      >
        <span>{selected?.label}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6">
          <path d="m1 1 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label={label}
          className={dateTimeFieldStyles.dueDateMenu}
          onKeyDown={onMenuKeyDown}
          ref={menu}
          role="listbox"
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={dateTimeFieldStyles.dueDateOption}
              key={option.value}
              onClick={() => {
                choose(option.value);
              }}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <svg aria-hidden="true" viewBox="0 0 12 12">
                  <path d="m2 6.5 2.5 2.5L10 3.5" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The button icon follows what the field picks: a calendar, a clock, or both. */
function ModeIcon({ mode }: { mode: DateTimeMode }) {
  if (mode === "time") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    );
  }

  if (mode === "datetime") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <rect height="11" rx="2" width="12" x="2" y="3" />
        <path d="M2 6.5h12M5.5 1.5v3" />
        <circle cx="10.5" cy="10.5" r="2.4" />
        <path d="M10.5 9.4v1.2l.8.5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect height="11" rx="2" width="12" x="2" y="3" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </svg>
  );
}

export function DateTimeField({
  label,
  mode = "datetime",
  onChange,
  panelLabel,
  value,
}: DateTimeFieldProps) {
  const { language, t } = useI18n();
  const [draft, setDraft] = useState(() => formatValue(value, mode));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  // A stored moment is the source of truth; the text follows it unless the user is mid-edit.
  useEffect(() => {
    setDraft(formatValue(value, mode));
    setInvalid(false);
  }, [mode, value]);

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
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const commit = (): boolean => {
    const parsed = parseDraft(draft, mode);

    if (parsed.kind === "invalid") {
      setInvalid(true);
      return false;
    }

    setInvalid(false);

    if (parsed.kind === "empty") {
      if (value !== null) {
        onChange(null);
      }

      setDraft("");
      return true;
    }

    onChange(parsed.epoch);
    setDraft(formatValue(parsed.epoch, mode));

    return true;
  };

  /** Writes a moment chosen in the panel, so the text never lags behind the pick. */
  const apply = (next: number | null): void => {
    onChange(next);
    setDraft(formatValue(next, mode));
    setInvalid(false);
  };

  // The panel names itself the way its caller does; the field's own label is the fallback.
  const heading = panelLabel ?? label;
  const shownDate = value === null ? startingPoint(mode) : new Date(value * 1000);
  const shown = {
    day: shownDate.getDate(),
    hour: shownDate.getHours(),
    minute: shownDate.getMinutes(),
    month: shownDate.getMonth() + 1,
    year: shownDate.getFullYear(),
  };
  const withDate = mode !== "time";
  const withTime = mode !== "date";
  const pickedDay = value === null ? null : isoDay(shownDate);
  const lastDay = daysInMonth(shown.year, shown.month);

  const currentYear = splitDay(todayDay())?.year ?? shown.year;

  // The lists are the same for every render of the same month, so they are kept rather than rebuilt
  // each time the panel redraws — which it does on every keystroke in the text field beside it.
  const years = useMemo(() => {
    const list: number[] = [];

    for (let year = currentYear - YEARS_BEFORE; year <= currentYear + YEARS_AFTER; year += 1) {
      list.push(year);
    }

    if (!list.includes(shown.year)) {
      list.push(shown.year);
      list.sort((a, b) => a - b);
    }

    return list;
  }, [currentYear, shown.year]);

  const yearOptions = useMemo(
    () => years.map((year) => ({ label: String(year), value: year })),
    [years],
  );
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        label: dateFormatter(language, { month: "long" }).format(new Date(2000, index, 1)),
        value: index + 1,
      })),
    [language],
  );
  const dayOptions = useMemo(
    () =>
      Array.from({ length: lastDay }, (_, index) => ({ label: String(index + 1), value: index + 1 })),
    [lastDay],
  );

  /** Writes local calendar fields as one instant; the day is clamped to the month it lands in. */
  const applyFields = (
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
  ): void => {
    const picked = new Date(
      year,
      month - 1,
      Math.min(day, daysInMonth(year, month)),
      withTime ? hour : 0,
      withTime ? minute : 0,
      0,
      0,
    );

    apply(Math.floor(picked.getTime() / 1000));
  };

  const title = withDate
    ? new Intl.DateTimeFormat(language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(shownDate)
    : new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(shownDate);
  const weekday = withDate
    ? new Intl.DateTimeFormat(language, { weekday: "long" }).format(shownDate)
    : null;

  return (
    <div className={dateTimeFieldStyles.dateTimeField} data-invalid={invalid} ref={root}>
      <div className={dateTimeFieldStyles.dateTimeRow}>
        <input
          aria-invalid={invalid}
          aria-label={label}
          className={dateTimeFieldStyles.dateTimeInput}
          inputMode={mode === "datetime" ? "text" : "numeric"}
          onBlur={commit}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();

              if (commit()) {
                event.currentTarget.blur();
              }
            }

            if (event.key === "Escape") {
              setDraft(formatValue(value, mode));
              setInvalid(false);
              setOpen(false);
            }
          }}
          placeholder={PLACEHOLDERS[mode]}
          spellCheck={false}
          value={draft}
        />
        <button
          aria-expanded={open}
          aria-label={t("dueDate.open")}
          className={dateTimeFieldStyles.dateTimeTrigger}
          onClick={() => {
            setOpen((current) => !current);
          }}
          type="button"
        >
          <ModeIcon mode={mode} />
        </button>
      </div>

      {invalid ? (
        <p className={dateTimeFieldStyles.dateTimeError} role="alert">
          {t("dueDate.invalid")}
        </p>
      ) : null}

      {open ? (
        <div
          aria-label={heading}
          className={dateTimeFieldStyles.dueDatePanel}
          data-empty={value === null}
          role="group"
        >
          <div className={dateTimeFieldStyles.dueDateHead}>
            <div>
              <span className={dateTimeFieldStyles.dueDateEyebrow}>{heading}</span>
              <span className={dateTimeFieldStyles.dueDateTitle}>{title}</span>
              {weekday === null ? null : <span className={dateTimeFieldStyles.dueDateWeekday}>{weekday}</span>}
            </div>
            <button
              aria-label={t("dueDate.close")}
              className={dateTimeFieldStyles.dueDateClose}
              onClick={() => {
                setOpen(false);
              }}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1l-8 8" />
              </svg>
            </button>
          </div>

          <div className={dateTimeFieldStyles.dueDateBody}>
            {withDate ? (
              <div className={dateTimeFieldStyles.dueDateGrid}>
                <DueSelect
                  label={t("dueDate.year")}
                  onChange={(year) => {
                    applyFields(year, shown.month, shown.day, shown.hour, shown.minute);
                  }}
                  onStep={(delta) => {
                    const index = years.indexOf(shown.year) + delta;
                    const year = years[Math.min(Math.max(index, 0), years.length - 1)];

                    if (year !== undefined) {
                      applyFields(year, shown.month, shown.day, shown.hour, shown.minute);
                    }
                  }}
                  options={yearOptions}
                  value={shown.year}
                />
                <DueSelect
                  label={t("dueDate.month")}
                  onChange={(month) => {
                    applyFields(shown.year, month, shown.day, shown.hour, shown.minute);
                  }}
                  onStep={(delta) => {
                    applyFields(
                      shown.year,
                      ((shown.month - 1 + delta + 12) % 12) + 1,
                      shown.day,
                      shown.hour,
                      shown.minute,
                    );
                  }}
                  options={monthOptions}
                  value={shown.month}
                />
                <DueSelect
                  label={t("dueDate.day")}
                  onChange={(day) => {
                    applyFields(shown.year, shown.month, day, shown.hour, shown.minute);
                  }}
                  onStep={(delta) => {
                    applyFields(
                      shown.year,
                      shown.month,
                      Math.min(Math.max(shown.day + delta, 1), lastDay),
                      shown.hour,
                      shown.minute,
                    );
                  }}
                  options={dayOptions}
                  value={shown.day}
                />
              </div>
            ) : null}

            {withTime ? (
              <div className={dateTimeFieldStyles.dueDateTime}>
                <div className={`${dateTimeFieldStyles.dueDateGrid} ${dateTimeFieldStyles.dueDateGridTime}`}>
                  <DueSelect
                    label={t("dueDate.hour")}
                    onChange={(hour) => {
                      applyFields(shown.year, shown.month, shown.day, hour, shown.minute);
                    }}
                    onStep={(delta) => {
                      applyFields(
                        shown.year,
                        shown.month,
                        shown.day,
                        (shown.hour + delta + 24) % 24,
                        shown.minute,
                      );
                    }}
                    options={HOUR_OPTIONS}
                    value={shown.hour}
                  />
                  <DueSelect
                    label={t("dueDate.minute")}
                    onChange={(minute) => {
                      applyFields(shown.year, shown.month, shown.day, shown.hour, minute);
                    }}
                    onStep={(delta) => {
                      applyFields(
                        shown.year,
                        shown.month,
                        shown.day,
                        shown.hour,
                        (shown.minute + delta + 60) % 60,
                      );
                    }}
                    options={MINUTE_OPTIONS}
                    value={shown.minute}
                  />
                </div>
              </div>
            ) : null}

            <div className={dateTimeFieldStyles.dueDateQuick}>
              {withDate
                ? [
                    { day: todayDay(), label: t("dueDate.today") },
                    { day: shiftDay(todayDay(), 1), label: t("dueDate.tomorrow") },
                  ].map((quick) => {
                    const parts = splitDay(quick.day);

                    return (
                      <button
                        aria-pressed={pickedDay === quick.day}
                        className={dateTimeFieldStyles.dueDateChip}
                        key={quick.label}
                        onClick={() => {
                          if (parts !== null) {
                            applyFields(parts.year, parts.month, parts.day, shown.hour, shown.minute);
                          }

                          setOpen(false);
                        }}
                        type="button"
                      >
                        {quick.label}
                      </button>
                    );
                  })
                : (
                    <button
                      className={dateTimeFieldStyles.dueDateChip}
                      onClick={() => {
                        apply(Math.floor(Date.now() / 60_000) * 60);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      {t("dueDate.now")}
                    </button>
                  )}
            </div>
          </div>

          <div className={dateTimeFieldStyles.dueDateFoot}>
            {value === null ? null : (
              <button
                className={dateTimeFieldStyles.dueDateClear}
                onClick={() => {
                  apply(null);
                  setOpen(false);
                }}
                type="button"
              >
                {t("dueDate.clear")}
              </button>
            )}
            <button
              className={dateTimeFieldStyles.dueDateDone}
              onClick={() => {
                setOpen(false);
              }}
              type="button"
            >
              {t("dueDate.done")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
