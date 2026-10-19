/** Due date panel: three dropdowns (year, month, day) plus the two days people pick most. */

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { useI18n } from "../../hooks/useI18n";
import { daysInMonth, joinDay, shiftDay, splitDay, todayDay } from "./dueDate";

export interface DueDatePickerProps {
  /** Called with the chosen day, or with `null` when the date is cleared. */
  onChange: (day: string | null) => void;
  /** Closes the panel after a quick choice, a clear, or the done button. */
  onClose: () => void;
  /** The chosen day, `YYYY-MM-DD`, or `null` while there is none. */
  value: string | null;
}

/** The current year first, with a year either side and enough ahead to plan with. */
const YEARS_BEFORE = 1;
const YEARS_AFTER = 10;

/** One choice in a dropdown; the value is the number the calendar needs. */
interface DueOption {
  label: string;
  value: number;
}

interface DueSelectProps {
  label: string;
  onChange: (value: number) => void;
  options: readonly DueOption[];
  value: number;
}

/**
 * Closes a floating panel when a pointer lands outside `root`, or when Escape is pressed.
 *
 * The trigger belongs inside `root`: a click on it is a toggle, not a dismissal, so the panel must
 * stay open for that click to close it.
 */
export function useDismissPanel<T extends HTMLElement>(
  root: RefObject<T | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const element = root.current;

      if (element !== null && !element.contains(event.target as Node)) {
        onClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open, root]);
}

/**
 * One field of the panel: a label sitting on the outline, a button that opens a listbox, and the
 * menu itself. A native `<select>` would draw its popup with the operating system's own styling,
 * which is the one part of the picker that cannot be made to look at home beside the rest.
 */
function DueSelect({ label, onChange, options, value }: DueSelectProps) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

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
    <div className="due-date-field" ref={field}>
      <span className="due-date-field-name">{label}</span>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label} ${selected?.label ?? ""}`.trim()}
        className="due-date-select"
        onClick={() => {
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
        ref={trigger}
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
          className="due-date-menu"
          onKeyDown={onMenuKeyDown}
          ref={menu}
          role="listbox"
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="due-date-option"
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

export function DueDatePicker({ onChange, onClose, value }: DueDatePickerProps) {
  const { language, t } = useI18n();

  const today = todayDay();
  // An empty date still shows today, so the three dropdowns always have something to say.
  const shown = splitDay(value ?? today) ?? splitDay(today)!;
  const shownDate = new Date(shown.year, shown.month - 1, shown.day);
  const monthNames = new Intl.DateTimeFormat(language, { month: "long" });
  const lastDay = daysInMonth(shown.year, shown.month);

  const currentYear = splitDay(today)?.year ?? shown.year;
  const years: number[] = [];

  for (let year = currentYear - YEARS_BEFORE; year <= currentYear + YEARS_AFTER; year += 1) {
    years.push(year);
  }

  if (!years.includes(shown.year)) {
    years.push(shown.year);
    years.sort((a, b) => a - b);
  }

  const yearOptions = years.map((year) => ({ label: String(year), value: year }));
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({
    label: monthNames.format(new Date(2000, index, 1)),
    value: index + 1,
  }));
  const dayOptions = Array.from({ length: lastDay }, (_, index) => ({
    label: String(index + 1),
    value: index + 1,
  }));

  /** Applies a new day, clamping the day number to the month that is now shown. */
  const apply = (year: number, month: number, day: number): void => {
    onChange(joinDay(year, month, Math.min(day, daysInMonth(year, month))));
  };

  const title = new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(shownDate);
  const weekday = new Intl.DateTimeFormat(language, { weekday: "long" }).format(shownDate);

  return (
    <div
      aria-label={t("dueDate.label")}
      className="due-date-panel"
      data-empty={value === null}
      role="group"
    >
      {/* The header is the answer: it reads the day the three fields below spell out. */}
      <div className="due-date-head">
        <div>
          <span className="due-date-eyebrow">{t("dueDate.label")}</span>
          <span className="due-date-title">{title}</span>
          <span className="due-date-weekday">{weekday}</span>
        </div>
        <button
          aria-label={t("dueDate.close")}
          className="due-date-close"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>

      <div className="due-date-body">
        <div className="due-date-grid">
          <DueSelect
            label={t("dueDate.year")}
            onChange={(year) => {
              apply(year, shown.month, shown.day);
            }}
            options={yearOptions}
            value={shown.year}
          />
          <DueSelect
            label={t("dueDate.month")}
            onChange={(month) => {
              apply(shown.year, month, shown.day);
            }}
            options={monthOptions}
            value={shown.month}
          />
          <DueSelect
            label={t("dueDate.day")}
            onChange={(day) => {
              apply(shown.year, shown.month, day);
            }}
            options={dayOptions}
            value={shown.day}
          />
        </div>

        <div className="due-date-quick">
          <button
            aria-pressed={value === today}
            className="due-date-chip"
            onClick={() => {
              onChange(today);
              onClose();
            }}
            type="button"
          >
            {t("dueDate.today")}
          </button>
          <button
            aria-pressed={value === shiftDay(today, 1)}
            className="due-date-chip"
            onClick={() => {
              onChange(shiftDay(today, 1));
              onClose();
            }}
            type="button"
          >
            {t("dueDate.tomorrow")}
          </button>
        </div>
      </div>

      <div className="due-date-foot">
        {value === null ? null : (
          <button
            className="due-date-clear"
            onClick={() => {
              onChange(null);
              onClose();
            }}
            type="button"
          >
            {t("dueDate.clear")}
          </button>
        )}
        <button className="due-date-done" onClick={onClose} type="button">
          {t("dueDate.done")}
        </button>
      </div>
    </div>
  );
}
