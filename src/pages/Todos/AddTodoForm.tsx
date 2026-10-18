/** Form for creating a new todo task. */

import { useState } from "react";
import type { FormEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import { useTodos } from "../../hooks/useTodos";
import type { RecurrenceUnit, TodoRecurrence } from "../../types/todo";

const SCHEDULES = ["once", "daily", "weekly", "monthly", "custom"] as const;
type Schedule = (typeof SCHEDULES)[number];
const UNITS: readonly RecurrenceUnit[] = ["day", "week", "month"];

/** Stores the typed title and clears the field once it landed. */
export function AddTodoForm() {
  const { t } = useI18n();
  const { add } = useTodos();
  const [title, setTitle] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("once");
  const [interval, setInterval] = useState("2");
  const [unit, setUnit] = useState<RecurrenceUnit>("day");
  const [pending, setPending] = useState(false);
  const customInterval = Number(interval);
  const validInterval =
    Number.isInteger(customInterval) &&
    customInterval >= 1 &&
    customInterval <= 365;

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const trimmed = title.trim();

    if (
      trimmed === "" ||
      pending ||
      (schedule === "custom" && !validInterval)
    ) {
      return;
    }

    const recurrence: TodoRecurrence | null =
      schedule === "once"
        ? null
        : {
            interval: schedule === "custom" ? customInterval : 1,
            unit:
              schedule === "custom"
                ? unit
                : schedule === "weekly"
                  ? "week"
                  : schedule === "monthly"
                    ? "month"
                    : "day",
          };
    setPending(true);
    void add(trimmed, recurrence)
      .then((stored) => {
        if (stored) {
          setTitle("");
        }
      })
      .finally(() => setPending(false));
  };

  return (
    <form className="todo-form" onSubmit={submit}>
      <div className="todo-composer">
        <input
          aria-label={t("todo.placeholder")}
          className="todo-composer-input"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          placeholder={t("todo.placeholder")}
          disabled={pending}
          value={title}
        />
        <button
          className="todo-composer-add"
          disabled={
            pending ||
            title.trim() === "" ||
            (schedule === "custom" && !validInterval)
          }
          type="submit"
        >
          {t("todo.add")}
        </button>
      </div>
      <div className="todo-schedule-controls">
        <label className="todo-schedule-label">
          {t("todo.recurrence.label")}
          <select
            className="todo-input"
            disabled={pending}
            value={schedule}
            onChange={(event) => {
              const selected = SCHEDULES.find(
                (value) => value === event.target.value,
              );
              if (selected) setSchedule(selected);
            }}
          >
            {SCHEDULES.map((value) => (
              <option key={value} value={value}>
                {t(`todo.recurrence.${value}`)}
              </option>
            ))}
          </select>
        </label>
        {schedule === "custom" && (
          <>
            <label className="todo-schedule-label">
              {t("todo.recurrence.interval")}
              <input
                className="todo-input todo-interval"
                disabled={pending}
                type="number"
                min="1"
                max="365"
                step="1"
                required
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              />
            </label>
            <label className="todo-schedule-label">
              {t("todo.recurrence.unit")}
              <select
                className="todo-input"
                disabled={pending}
                value={unit}
                onChange={(event) => {
                  const selected = UNITS.find(
                    (value) => value === event.target.value,
                  );
                  if (selected) setUnit(selected);
                }}
              >
                {UNITS.map((value) => (
                  <option key={value} value={value}>
                    {t(`todo.recurrence.units.${value}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {schedule !== "once" && (
        <p className="todo-schedule-hint muted">{t("todo.recurrence.hint")}</p>
      )}
    </form>
  );
}
