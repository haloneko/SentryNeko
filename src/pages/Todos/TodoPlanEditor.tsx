/** Inline plan editor: when a task is meant to start, and when it is meant to end. */

import { DateTimeField } from "../../components/ui/DateTimeField";
import { useI18n } from "../../hooks/useI18n";
import type { Todo } from "../../types/todo";
import todosStyles from "./todos.module.css";

export interface TodoPlanEditorProps {
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
 */
export function TodoPlanEditor({ onClose, onEndChange, onStartChange, todo }: TodoPlanEditorProps) {
  const { t } = useI18n();
  const backwards = todo.startAt !== null && todo.endAt !== null && todo.endAt < todo.startAt;

  return (
    <div className={todosStyles.todoPlanEditor}>
      <div className={todosStyles.todoPlanFields}>
        <DateTimeField
          label={t("todo.plan.start")}
          onChange={onStartChange}
          panelLabel={t("todo.plan.startPanel")}
          value={todo.startAt}
        />
        <DateTimeField
          label={t("todo.plan.end")}
          onChange={onEndChange}
          panelLabel={t("todo.plan.endPanel")}
          value={todo.endAt}
        />
      </div>
      {backwards ? (
        <p className={todosStyles.todoPlanWarning} role="status">
          {t("todo.plan.order")}
        </p>
      ) : null}
      <div className={todosStyles.todoPlanFoot}>
        <span className={todosStyles.todoPlanHint}>{t("todo.plan.hint")}</span>
        <button className="btn btn-quiet" onClick={onClose} type="button">
          {t("todo.plan.done")}
        </button>
      </div>
    </div>
  );
}
