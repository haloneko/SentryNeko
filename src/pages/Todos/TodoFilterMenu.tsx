/** The filter button, and the card it opens: which state the task is in, and which tag it carries. */

import { useRef, useState } from "react";

import { ActionIcon } from "../../components/ui/ActionIcon";
import { useI18n } from "../../hooks/useI18n";
import type { Tag } from "../../types/tag";
import type { TodoFilter } from "../../types/todo";
import { TodoMenu } from "./TodoMenu";
import todosStyles from "./todos.module.css";

/** The states the card offers, in the order a task moves through them. */
const FILTERS: readonly TodoFilter[] = ["all", "open", "ongoing", "late", "completed"];

const FILTER_LABELS: Record<TodoFilter, string> = {
  all: "todo.filter.all",
  open: "todo.filter.open",
  ongoing: "todo.filter.ongoing",
  late: "todo.filter.late",
  completed: "todo.filter.completed",
};

export interface TodoFilterMenuProps {
  /** The state the list is asked for. */
  filter: TodoFilter;
  /** Puts the status and the tag back to "everything". */
  onClear: () => void;
  onFilterChange: (filter: TodoFilter) => void;
  onTagChange: (tagId: number | null) => void;
  /** The one tag the list is narrowed to, or `null` for every tag. */
  tagId: number | null;
  tags: readonly Tag[];
}

/** A funnel over the list: the four states of a task and the tag it carries, set in place. */
export function TodoFilterMenu({
  filter,
  onClear,
  onFilterChange,
  onTagChange,
  tagId,
  tags,
}: TodoFilterMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  // The funnel is lit whenever it narrows anything: one glance says the list is not everything.
  const narrowed = filter !== "all" || tagId !== null;

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("todo.view.filterOpen")}
        className={todosStyles.todoViewButton}
        data-active={narrowed}
        data-testid="todo-filter-button"
        onClick={() => {
          setOpen(true);
        }}
        ref={anchor}
        title={t("todo.view.filterOpen")}
        type="button"
      >
        <ActionIcon name="filter" />
        {narrowed ? <span aria-hidden="true" className={todosStyles.todoViewDot} /> : null}
      </button>
      {open ? (
        <TodoMenu
          anchor={anchor.current}
          label={t("todo.view.filter")}
          onClose={() => {
            setOpen(false);
          }}
        >
          <div
            aria-label={t("todo.filter.label")}
            className={todosStyles.todoMenuSection}
            role="group"
          >
            <span aria-hidden="true" className={todosStyles.todoMenuHeading}>
              {t("todo.view.status")}
            </span>
            {FILTERS.map((value) => (
              <button
                aria-pressed={filter === value}
                className={todosStyles.todoMenuOption}
                data-testid="todo-status-option"
                key={value}
                onClick={() => {
                  onFilterChange(value);
                }}
                type="button"
              >
                <span>{t(FILTER_LABELS[value])}</span>
                {filter === value ? (
                  <ActionIcon className={todosStyles.todoMenuCheck} name="check" />
                ) : null}
              </button>
            ))}
          </div>
          {tags.length === 0 ? null : (
            <div className={todosStyles.todoMenuSection}>
              <span aria-hidden="true" className={todosStyles.todoMenuHeading}>
                {t("todo.view.tags")}
              </span>
              <div
                aria-label={t("todo.view.tags")}
                className={todosStyles.todoMenuChips}
                role="group"
              >
                <button
                  aria-pressed={tagId === null}
                  className={todosStyles.todoChip}
                  onClick={() => {
                    onTagChange(null);
                  }}
                  type="button"
                >
                  {t("todo.view.allTags")}
                </button>
                {tags.map((tag) => (
                  <button
                    aria-pressed={tagId === tag.id}
                    className={todosStyles.todoChip}
                    key={tag.id}
                    onClick={() => {
                      // The chip that is already chosen puts the list back to every tag.
                      onTagChange(tagId === tag.id ? null : tag.id);
                    }}
                    type="button"
                  >
                    #{tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {narrowed ? (
            <button className={todosStyles.todoMenuClear} onClick={onClear} type="button">
              {t("todo.view.clear")}
            </button>
          ) : null}
        </TodoMenu>
      ) : null}
    </>
  );
}
