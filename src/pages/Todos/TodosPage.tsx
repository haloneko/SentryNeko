/** Todo page. */

import { useEffect } from "react";

import { useI18n } from "../../hooks/useI18n";
import { useTags } from "../../hooks/useTags";
import { useTodos } from "../../hooks/useTodos";
import { AddTodoForm } from "./AddTodoForm";
import { TodoList } from "./TodoList";

/** Radius of the progress ring's circle, in the SVG's own units. */
const RING_RADIUS = 19;

/** One full turn around the ring, which `stroke-dasharray` and the offset share. */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Renders the page head with the progress ring, the composer and the tasks. */
export function TodosPage() {
  const { t } = useI18n();
  const { counts, filter, sort, refresh } = useTodos();
  const { refresh: refreshTags } = useTags();

  // One load per filter change; the components below only read the result.
  useEffect(() => {
    void refresh();
  }, [filter, sort, refresh]);

  // Tags are loaded once: they are the catalog the search and the rows read, and they change only
  // when a row changes them.
  useEffect(() => {
    void refreshTags();
  }, [refreshTags]);

  const progress = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);

  return (
    <div className="todo-page">
      <header className="todo-head">
        <div
          aria-label={t("todo.progress.label")}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="todo-ring"
          role="progressbar"
        >
          <svg aria-hidden="true" viewBox="0 0 48 48">
            <defs>
              <linearGradient id="todo-ring-gradient" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-text)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <circle className="todo-ring-track" cx="24" cy="24" r={RING_RADIUS} />
            <circle
              className="todo-ring-value"
              cx="24"
              cy="24"
              r={RING_RADIUS}
              style={{
                strokeDasharray: RING_CIRCUMFERENCE,
                strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress / 100),
              }}
            />
          </svg>
          <b>
            {progress}
            <span>%</span>
          </b>
        </div>
        <div className="todo-head-text">
          <h1 className="todo-headline">{t("nav.todos")}</h1>
          <p className="todo-subtitle">
            {t("todo.subtitle", { remaining: counts.remaining, total: counts.total })}
          </p>
        </div>
      </header>
      <AddTodoForm />
      <TodoList />
    </div>
  );
}
