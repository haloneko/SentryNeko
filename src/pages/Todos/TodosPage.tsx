/** Todo page. */

import { useEffect } from "react";

import { useI18n } from "../../hooks/useI18n";
import { useTags } from "../../hooks/useTags";
import { useTodos } from "../../hooks/useTodos";
import { AddTodoForm } from "./AddTodoForm";
import { TodoList } from "./TodoList";
import todosStyles from "./todos.module.css";

/** Renders the page head with today's finished count, the composer and the tasks. */
export function TodosPage() {
  const { t } = useI18n();
  const { completions, counts, filter, refresh } = useTodos();
  const { refresh: refreshTags } = useTags();

  // One load per filter change; the components below only read the result.
  useEffect(() => {
    void refresh();
  }, [filter, refresh]);

  // Tags are loaded once: they are the catalog the search and the rows read, and they change only
  // when a row changes them.
  useEffect(() => {
    void refreshTags();
  }, [refreshTags]);

  return (
    <div className={todosStyles.todoPage}>
      <header className={todosStyles.todoHead}>
        <div
          aria-label={t("todo.done.label", { count: completions.today })}
          className={todosStyles.todoDone}
          data-testid="todo-done"
          role="img"
        >
          <b aria-hidden="true">{completions.today}</b>
          <span aria-hidden="true">{t("todo.done.caption")}</span>
        </div>
        <div className={todosStyles.todoHeadText}>
          <h1 className={todosStyles.todoHeadline}>{t("nav.todos")}</h1>
          <p className={todosStyles.todoSubtitle}>
            {t("todo.subtitle", { remaining: counts.remaining, total: counts.total })}
          </p>
        </div>
      </header>
      <AddTodoForm />
      <TodoList />
    </div>
  );
}
