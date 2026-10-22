/** The filter button, and the card it opens: which statuses, which tag, and whether only the late. */

import { useRef, useState } from "react";

import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useI18n } from "../../hooks/useI18n";
import type { Tag } from "../../types/tag";
import type { TodoFilter } from "../../types/todo";
import { TodoMenu } from "./TodoMenu";
import todosStyles from "./todos.module.css";

const FILTERS: readonly TodoFilter[] = ["all", "active", "completed"];

const FILTER_LABELS: Record<TodoFilter, string> = {
  all: "todo.filter.all",
  active: "todo.filter.active",
  completed: "todo.filter.completed",
};

export interface TodoFilterMenuProps {
  /** The status the list is asked for, which the backend answers. */
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
  /** Clears the status and the two filters this card adds. */
  onClear: () => void;
  onOverdueChange: (overdueOnly: boolean) => void;
  onTagChange: (tagId: number | null) => void;
  overdueOnly: boolean;
  /** The one tag the list is narrowed to, or `null` for every tag. */
  tagId: number | null;
  tags: readonly Tag[];
}

/** A funnel over the list: the statuses, the tags and the overdue flag, each set in place. */
export function TodoFilterMenu({
  filter,
  onClear,
  onFilterChange,
  onOverdueChange,
  onTagChange,
  overdueOnly,
  tagId,
  tags,
}: TodoFilterMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  // The funnel is lit whenever it narrows anything: one glance says the list is not everything.
  const narrowed = filter !== "all" || tagId !== null || overdueOnly;

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
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M2.4 3.2h11.2L9.3 8.4v4.1l-2.6 1.4V8.4z" />
        </svg>
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
          <div className={todosStyles.todoMenuSection}>
            <span aria-hidden="true" className={todosStyles.todoMenuHeading}>
              {t("todo.view.status")}
            </span>
            <SegmentedControl
              label={t("todo.filter.label")}
              onChange={onFilterChange}
              options={FILTERS.map((value) => ({ label: t(FILTER_LABELS[value]), value }))}
              value={filter}
            />
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
          <button
            aria-pressed={overdueOnly}
            className={todosStyles.todoMenuOption}
            onClick={() => {
              onOverdueChange(!overdueOnly);
            }}
            type="button"
          >
            <span>{t("todo.view.overdue")}</span>
            {overdueOnly ? (
              <svg aria-hidden="true" className={todosStyles.todoMenuCheck} viewBox="0 0 12 12">
                <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
              </svg>
            ) : null}
          </button>
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
