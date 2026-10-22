/** The sort button, and the card it opens: how the tasks are ordered inside their group. */

import { useRef, useState } from "react";

import { useI18n } from "../../hooks/useI18n";
import type { TodoSort } from "./todos";
import { TodoMenu } from "./TodoMenu";
import todosStyles from "./todos.module.css";

/** The orders the card offers, in the order it lists them. */
const SORTS: readonly TodoSort[] = ["default", "due", "oldest", "title"];

const SORT_LABELS: Record<TodoSort, string> = {
  default: "todo.sort.default",
  due: "todo.sort.due",
  oldest: "todo.sort.oldest",
  title: "todo.sort.title",
};

export interface TodoSortMenuProps {
  onChange: (sort: TodoSort) => void;
  sort: TodoSort;
}

/** Two arrows against a list: the button that says "this is the order, pick another". */
export function TodoSortMenu({ onChange, sort }: TodoSortMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("todo.view.sortOpen")}
        className={todosStyles.todoViewButton}
        data-active={sort !== "default"}
        data-testid="todo-sort-button"
        onClick={() => {
          setOpen(true);
        }}
        ref={anchor}
        title={t("todo.view.sortOpen")}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M5 3.4v9.2M2.8 5.6 5 3.4l2.2 2.2" />
          <path d="M11 12.6V3.4M8.8 10.4 11 12.6l2.2-2.2" />
        </svg>
        {sort === "default" ? null : (
          <span aria-hidden="true" className={todosStyles.todoViewDot} />
        )}
      </button>
      {open ? (
        <TodoMenu
          anchor={anchor.current}
          label={t("todo.view.sort")}
          onClose={() => {
            setOpen(false);
          }}
        >
          {SORTS.map((value) => (
            <button
              aria-pressed={sort === value}
              className={todosStyles.todoMenuOption}
              data-testid="todo-sort-option"
              key={value}
              onClick={() => {
                onChange(value);
              }}
              type="button"
            >
              <span>{t(SORT_LABELS[value])}</span>
              {sort === value ? (
                <svg aria-hidden="true" className={todosStyles.todoMenuCheck} viewBox="0 0 12 12">
                  <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
                </svg>
              ) : null}
            </button>
          ))}
        </TodoMenu>
      ) : null}
    </>
  );
}
