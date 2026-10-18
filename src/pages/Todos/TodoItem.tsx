/** One task: complete it, edit it, tag it, or take it off the list. */

import { useState } from "react";
import type { CSSProperties } from "react";

import { useI18n } from "../../hooks/useI18n";
import type { Tag } from "../../types/tag";
import type { Todo } from "../../types/todo";
import { isRecurringTodo } from "../../types/todoDisplay";
import { ageOf, tagNamesOf } from "./todos";
import { TodoTagEditor } from "./TodoTagEditor";

export interface TodoItemProps {
  /** True for a task the page has not shown before, which is the only one that fades in. */
  entering: boolean;
  /** True while the row plays its leaving animation; it takes no input until then. */
  leaving: boolean;
  /** Wall clock the relative timestamps are measured against. */
  now: number;
  onRemove: (todo: Todo) => void;
  onRename: (todo: Todo, title: string) => void;
  /** Registers the row, so the list can measure it before and after it moves between groups. */
  onRowRef: (id: number, element: HTMLLIElement | null) => void;
  onSelect: (id: number) => void;
  onToggle: (todo: Todo) => void;
  onUpdateTags: (todo: Todo, tagIds: readonly number[]) => void;
  /** Place in the list, which staggers the entrance animation. */
  rowIndex: number;
  selected: boolean;
  selecting: boolean;
  showType?: boolean;
  tags: readonly Tag[];
  todo: Todo;
}

export function TodoItem({
  entering,
  leaving,
  now,
  onRemove,
  onRename,
  onRowRef,
  onSelect,
  onToggle,
  onUpdateTags,
  rowIndex,
  selected,
  selecting,
  showType = false,
  tags,
  todo,
}: TodoItemProps) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);

  const age = ageOf(todo.createdAt, now);
  const names = tagNamesOf(todo, tags);

  /** Leaves the field and stores what was typed, unless nothing changed. */
  const commit = (): void => {
    const title = draft?.trim() ?? "";

    setDraft(null);

    if (title !== "" && title !== todo.title) {
      onRename(todo, title);
    }
  };

  return (
    <li
      className="todo-row"
      data-leaving={leaving}
      data-selected={selecting && selected}
      ref={(element) => {
        onRowRef(todo.id, element);
      }}
      style={{ "--row": rowIndex } as CSSProperties}
    >
      <div className="todo-card" data-completed={todo.completed} data-enter={entering}
        data-recurring={isRecurringTodo(todo)}>
        {selecting ? (
          <input
            aria-label={t("todo.select.item", { title: todo.title })}
            checked={selected}
            className="todo-check todo-check-select"
            onChange={() => {
              onSelect(todo.id);
            }}
            type="checkbox"
          />
        ) : null}
        <input
          aria-label={t(todo.completed ? "todo.reopen" : "todo.toggle")}
          checked={todo.completed}
          className="todo-check"
          onChange={() => {
            onToggle(todo);
          }}
          type="checkbox"
        />
        <div className="todo-body">
          {draft === null ? (
            <button
              className="todo-title"
              onClick={() => {
                setDraft(todo.title);
              }}
              type="button"
            >
              {todo.title}
            </button>
          ) : (
            <input
              aria-label={t("todo.edit")}
              autoFocus
              className="todo-input todo-input-inline"
              onBlur={commit}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commit();
                }

                if (event.key === "Escape") {
                  setDraft(null);
                }
              }}
              value={draft}
            />
          )}
          <span className="todo-meta">
            {todo.recurrence != null ? (
              <span className="todo-kind">
                {t(`todo.recurrence.summary.${todo.recurrence.unit}`, { count: todo.recurrence.interval })}
              </span>
            ) : null}
            {todo.nextOccurrenceAt != null ? (
              <span className="todo-time">
                {t("todo.recurrence.next", {
                  date: new Intl.DateTimeFormat(language, { dateStyle: "medium" })
                    .format(todo.nextOccurrenceAt * 1000),
                })}
              </span>
            ) : null}
            {showType ? (
              <span className="todo-type" data-type={isRecurringTodo(todo) ? "recurring" : "oneTime"}>
                {t(isRecurringTodo(todo) ? "todo.type.recurring" : "todo.type.oneTime")}
              </span>
            ) : null}
            <span className="todo-time">
              {age.unit === "now"
                ? t("todo.time.now")
                : t(`todo.time.${age.unit}`, { count: age.count })}
            </span>
            {names.map((name) => (
              <span className="todo-tag" key={name}>
                #{name}
              </span>
            ))}
          </span>
          {tagging ? (
            <TodoTagEditor
              onClose={() => {
                setTagging(false);
              }}
              onChange={(tagIds) => {
                onUpdateTags(todo, tagIds);
              }}
              tags={tags}
              todo={todo}
            />
          ) : null}
        </div>
        <div className="todo-actions">
          <button
            aria-label={t("todo.edit")}
            className="todo-action"
            onClick={() => {
              setDraft(todo.title);
            }}
            title={t("todo.edit")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M11.5 2.5l2 2-8 8-3 1 1-3z" />
            </svg>
          </button>
          <button
            aria-label={t("todo.tags.label")}
            aria-pressed={tagging}
            className="todo-action"
            onClick={() => {
              setTagging((open) => !open);
            }}
            title={t("todo.tags.label")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M2 2h5l7 7-5 5-7-7z" />
              <circle cx="5.5" cy="5.5" r="0.9" />
            </svg>
          </button>
          <button
            aria-label={t("todo.delete")}
            className="todo-action todo-action-danger"
            onClick={() => {
              onRemove(todo);
            }}
            title={t("todo.delete")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}
