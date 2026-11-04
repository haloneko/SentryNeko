/** Inline plan editor: when a task is meant to start, and when it is meant to end. */

import { useEffect, useState } from "react";

import { DatePickerBody, DateTimeField } from "../../components/ui/DateTimeField";
import { Popover } from "../../components/ui/Popover";
import { useI18n } from "../../hooks/useI18n";
import type { Todo } from "../../types/todo";
import { planSummary } from "./todos";
import planStyles from "./TodoPlanEditor.module.css";

/** Which end the calendar is working on, when the panel has stepped down into it. */
type Picking = "end" | "start";

export interface TodoPlanEditorProps {
  /** The row's button, which the panel hangs from and gives its focus back to. */
  anchor: HTMLElement | null;
  /** Closes the editor without touching the task. */
  onClose: () => void;
  /** Called with the new end, in UTC epoch seconds, or `null` when it is cleared. */
  onEndChange: (endAt: number | null) => void;
  /** Called with the new start, in UTC epoch seconds, or `null` when it is cleared. */
  onStartChange: (startAt: number | null) => void;
  todo: Todo;
}

/**
 * Both ends are written as they are picked, like the tag picker beside it: a window is small enough
 * that a save step would only stand between the user and the row that confirms it.
 *
 * Either end may be left empty. A window that ends before it starts is still stored — the row is
 * the place that owns the fact — but the panel says so, because a typo there is easy to make and
 * invisible once the panel closes.
 *
 * The calendar opens *in* this panel rather than in a bubble of its own: one surface, one place to
 * look, and no second layer hanging off a row that already sits halfway down the window.
 */
export function TodoPlanEditor({ anchor, onClose, onEndChange, onStartChange, todo }: TodoPlanEditorProps) {
  const { language, t } = useI18n();
  const [picking, setPicking] = useState<Picking | null>(null);

  const summary = planSummary(todo, Math.floor(Date.now() / 1000), { language, t });
  const empty = todo.startAt === null && todo.endAt === null;
  const backwards = todo.startAt !== null && todo.endAt !== null && todo.endAt < todo.startAt;
  const end = picking === "start" ? t("todo.plan.start") : t("todo.plan.end");

  // Escape steps back one level: the calendar closes itself before the panel around it closes.
  useEffect(() => {
    if (picking === null) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      setPicking(null);
    };

    // Captured on the way down, so this runs before the listener the panel itself registered.
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [picking]);

  return (
    <Popover
      anchor={anchor}
      eyebrow={t("todo.plan.title")}
      footer={
        picking === null ? (
          <>
            {empty ? null : (
              <button
                className={planStyles.clear}
                onClick={() => {
                  onStartChange(null);
                  onEndChange(null);
                }}
                type="button"
              >
                {t("todo.plan.clear")}
              </button>
            )}
            <button className={planStyles.done} onClick={onClose} type="button">
              {t("todo.plan.done")}
            </button>
          </>
        ) : undefined
      }
      onClose={onClose}
      title={summary?.text ?? t("todo.plan.empty")}
    >
      {picking === null ? (
        <>
          <div className={planStyles.fields}>
            <div className={planStyles.field}>
              <span className={planStyles.fieldLabel}>{t("todo.plan.start")}</span>
              <DateTimeField
                label={t("todo.plan.start")}
                onChange={onStartChange}
                onPickerOpen={() => {
                  setPicking("start");
                }}
                panelLabel={t("todo.plan.startPanel")}
                value={todo.startAt}
              />
            </div>
            <div className={planStyles.field}>
              <span className={planStyles.fieldLabel}>{t("todo.plan.end")}</span>
              <DateTimeField
                label={t("todo.plan.end")}
                onChange={onEndChange}
                onPickerOpen={() => {
                  setPicking("end");
                }}
                panelLabel={t("todo.plan.endPanel")}
                value={todo.endAt}
              />
            </div>
          </div>

          {backwards ? (
            <p className={planStyles.warning} role="status">
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M8 2.5l6 11H2z" />
                <path d="M8 6.5v3.2M8 11.6v.1" />
              </svg>
              {t("todo.plan.order")}
            </p>
          ) : null}

          <p className={planStyles.hint}>{t("todo.plan.hint")}</p>
        </>
      ) : (
        <>
          <button
            className={planStyles.back}
            onClick={() => {
              setPicking(null);
            }}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <path d="M7.5 2.5L4 6l3.5 3.5" />
            </svg>
            {end}
          </button>
          <DatePickerBody
            inline
            onChange={picking === "start" ? onStartChange : onEndChange}
            onPickDone={() => {
              setPicking(null);
            }}
            value={picking === "start" ? todo.startAt : todo.endAt}
          />
        </>
      )}
    </Popover>
  );
}
