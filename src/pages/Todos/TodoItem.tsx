/** One task: complete it, edit it, tag it, or take it off the list. */

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";

import { ActionIcon } from "../../components/ui/ActionIcon";
import { Popconfirm } from "../../components/ui/Popconfirm";
import { useI18n } from "../../hooks/useI18n";
import type { Tag } from "../../types/tag";
import type { Todo } from "../../types/todo";
import { ageOf, planSummary, tagNamesOf } from "./todos";
import { TodoPlanEditor } from "./TodoPlanEditor";
import { TodoTagEditor } from "./TodoTagEditor";
import todosStyles from "./todos.module.css";

export interface TodoItemProps {
  /** True for a task the page has not shown before, which is the only one that fades in. */
  entering: boolean;
  /** Adds the tag to the search above the list, which is the row's way of asking for its kind. */
  onFilterTag: (name: string) => void;
  /** True while the row plays its leaving animation; it takes no input until then. */
  leaving: boolean;
  /** Wall clock the relative timestamps are measured against. */
  now: number;
  onRemove: (todo: Todo) => void;
  onRename: (todo: Todo, title: string) => void;
  /** Registers the row, so the list can measure it before and after it moves between groups. */
  onRowRef: (id: number, element: HTMLLIElement | null) => void;
  onSelect: (id: number) => void;
  /** Stores the moment the task should end, or clears it with `null`. */
  onSetEndAt: (todo: Todo, endAt: number | null) => void;
  /** Stores the moment the task should start, or clears it with `null`. */
  onSetStartAt: (todo: Todo, startAt: number | null) => void;
  /** Pins the task to the top of its group, or unpins it. */
  onStar: (todo: Todo) => void;
  onToggle: (todo: Todo) => void;
  onUpdateTags: (todo: Todo, tagIds: readonly number[]) => void;
  /** Place in the list, which staggers the entrance animation. */
  rowIndex: number;
  selected: boolean;
  selecting: boolean;
  tags: readonly Tag[];
  todo: Todo;
}

export const TodoItem = memo(function TodoItem({
  entering,
  leaving,
  now,
  onFilterTag,
  onRemove,
  onRename,
  onRowRef,
  onSelect,
  onSetEndAt,
  onSetStartAt,
  onStar,
  onToggle,
  onUpdateTags,
  rowIndex,
  selected,
  selecting,
  tags,
  todo,
}: TodoItemProps) {
  const { language, t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The panels are placed against the button that opened them, so the anchor *is* the open state:
   * one value decides whether the panel draws and where it hangs from.
   */
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const [planAnchor, setPlanAnchor] = useState<HTMLElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const opened = useRef(false);
  /** Where the title was last clicked, so the caret can be put back under the same spot. */
  const clicked = useRef<{ x: number; y: number } | null>(null);

  /*
   * The title is edited in place, so the field may not draw a box of its own: it has to keep the
   * height of the text it holds instead, which a textarea only does when it is measured.
   */
  useLayoutEffect(() => {
    const element = field.current;

    if (element === null) {
      opened.current = false;
      return;
    }

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;

    if (!opened.current) {
      const point = clicked.current;

      opened.current = true;
      clicked.current = null;

      const caret = point === null ? element.value.length : caretIndexAt(element, point.x, point.y);

      element.setSelectionRange(caret, caret);
    }
  }, [draft]);

  const age = ageOf(todo.createdAt, now);
  // The tag names are the same for every row of the page, so a row that redraws — the clock moves
  // every minute — does not walk the whole tag list again to spell the few it carries.
  const names = useMemo(() => tagNamesOf(todo, tags), [tags, todo]);
  const plan = useMemo(() => planSummary(todo, now, { language, t }), [language, now, t, todo]);
  const starred = todo.starredAt !== null;

  /** Leaves the field and stores what was typed, unless nothing changed. */
  const commit = (): void => {
    const title = draft?.trim() ?? "";

    setDraft(null);

    if (title !== "" && title !== todo.title) {
      onRename(todo, title);
    }
  };

  const openField = (point: { x: number; y: number } | null): void => {
    clicked.current = point;
    setDraft(todo.title);
  };

  /**
   * Enter stores the title, Shift+Enter opens a new line; a title that outgrows its row wraps either
   * way. An IME owns Enter while its candidate list is open, so that keydown is not the task's.
   */
  const handleFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Escape") {
      setDraft(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit();
    }
  };

  /**
   * In selection mode the whole row is the target, not only the box: the row is what the eye aims
   * at, and the box is what the state looks like. A control inside the row still answers for
   * itself, so clicking the square picks once rather than twice.
   */
  const handleCardClick = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest("input, button, a")) {
      return;
    }

    onSelect(todo.id);
  };

  return (
    <li
      className={todosStyles.todoRow}
      data-leaving={leaving}
      data-selected={selecting && selected}
      data-selecting={selecting}
      data-starred={starred}
      data-testid="todo-row"
      ref={(element) => {
        onRowRef(todo.id, element);
      }}
      style={{ "--row": rowIndex } as CSSProperties}
    >
      <div
        className={todosStyles.todoCard}
        data-completed={todo.completed}
        data-editing={draft !== null}
        data-enter={entering}
        data-testid="todo-card"
        onClick={selecting ? handleCardClick : undefined}
      >
        {/* One slot for both marks: picking a task takes the place of ticking it off, never adds to it. */}
        <span className={todosStyles.todoMark}>
          <input
            aria-label={t("todo.toggle")}
            checked={todo.completed}
            className={`${todosStyles.todoCheck} ${todosStyles.todoCheckDone}`}
            data-testid="todo-check-done"
            disabled={selecting}
            onChange={() => {
              onToggle(todo);
            }}
            type="checkbox"
          />
          {selecting ? (
            <input
              aria-label={t("todo.select.item", { title: todo.title })}
              checked={selected}
              className={`${todosStyles.todoCheck} ${todosStyles.todoCheckSelect}`}
              onChange={() => {
                onSelect(todo.id);
              }}
              type="checkbox"
            />
          ) : null}
        </span>
        <div className={todosStyles.todoBody}>
          {draft === null ? (
            <button
              className={todosStyles.todoTitle}
              data-testid="todo-title"
              onClick={(event) => {
                openField(event.detail === 0 ? null : { x: event.clientX, y: event.clientY });
              }}
              tabIndex={selecting ? -1 : 0}
              type="button"
            >
              {todo.title}
            </button>
          ) : (
            <textarea
              aria-label={t("todo.edit")}
              autoFocus
              className={`${todosStyles.todoInput} ${todosStyles.todoInputInline}`}
              data-testid="todo-input-inline"
              onBlur={commit}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={handleFieldKeyDown}
              ref={field}
              rows={1}
              value={draft}
            />
          )}
          <span className={todosStyles.todoMeta}>
            {plan === null ? null : (
              <span className={todosStyles.todoPlan} data-late={plan.late}>
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 4.5V8l2.5 1.5" />
                </svg>
                {plan.text}
              </span>
            )}
            {plan?.late === true ? (
              <span className={todosStyles.todoPlanLate}>{t("todo.plan.late")}</span>
            ) : null}
            <span className={todosStyles.todoTime}>
              {age.unit === "now"
                ? t("todo.time.now")
                : t(`todo.time.${age.unit}`, { count: age.count })}
            </span>
            {names.map((name) => (
              <button
                aria-label={t("todo.tags.filter", { name })}
                className={todosStyles.todoTag}
                key={name}
                onClick={() => {
                  onFilterTag(name);
                }}
                title={t("todo.tags.filter", { name })}
                type="button"
              >
                #{name}
              </button>
            ))}
          </span>
        </div>
        {/* The row's own controls step aside while a pick is being made: one mode, one gesture. */}
        <div className={todosStyles.todoActions} inert={selecting}>
          {/* The star reads as filled or outlined, so the row's state is legible without hovering. */}
          <button
            aria-label={starred ? t("todo.star.remove") : t("todo.star.add")}
            aria-pressed={starred}
            className={`${todosStyles.todoAction} ${todosStyles.todoActionStar}`}
            data-starred={starred}
            data-testid="todo-star"
            onClick={() => {
              onStar(todo);
            }}
            title={starred ? t("todo.star.remove") : t("todo.star.add")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
            </svg>
          </button>
          <button
            aria-expanded={planAnchor !== null}
            aria-haspopup="dialog"
            aria-label={t("todo.plan.edit")}
            aria-pressed={planAnchor !== null}
            className={todosStyles.todoAction}
            onClick={(event) => {
              setPlanAnchor(planAnchor === null ? event.currentTarget : null);
              setTagAnchor(null);
            }}
            title={t("todo.plan.edit")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.5V8l2.5 1.5" />
            </svg>
          </button>
          <button
            aria-expanded={tagAnchor !== null}
            aria-haspopup="dialog"
            aria-label={t("todo.tags.label")}
            aria-pressed={tagAnchor !== null}
            className={todosStyles.todoAction}
            onClick={(event) => {
              setTagAnchor(tagAnchor === null ? event.currentTarget : null);
              setPlanAnchor(null);
            }}
            title={t("todo.tags.label")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M2 2h5l7 7-5 5-7-7z" />
              <circle cx="5.5" cy="5.5" r="0.9" />
            </svg>
          </button>
          {/* The row names itself in the panel, so the task about to go is never in doubt. */}
          <Popconfirm
            cancelText={t("todo.confirm.cancel")}
            confirmText={t("todo.confirm.delete")}
            danger
            icon={<ActionIcon name="delete" />}
            onConfirm={() => {
              onRemove(todo);
            }}
            title={t("todo.confirm.deleteTask")}
          >
            <button
              aria-label={t("todo.delete")}
              className={`${todosStyles.todoAction} ${todosStyles.todoActionDanger}`}
              title={t("todo.delete")}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1l-8 8" />
              </svg>
            </button>
          </Popconfirm>
        </div>
        {/* Both panels hang off the button that opened them, so they are placed, not laid out here. */}
        {planAnchor === null ? null : (
          <TodoPlanEditor
            anchor={planAnchor}
            onClose={() => {
              setPlanAnchor(null);
            }}
            onEndChange={(endAt) => {
              onSetEndAt(todo, endAt);
            }}
            onStartChange={(startAt) => {
              onSetStartAt(todo, startAt);
            }}
            todo={todo}
          />
        )}
        {tagAnchor === null ? null : (
          <TodoTagEditor
            anchor={tagAnchor}
            onClose={() => {
              setTagAnchor(null);
            }}
            onChange={(tagIds) => {
              onUpdateTags(todo, tagIds);
            }}
            tags={tags}
            todo={todo}
          />
        )}
      </div>
    </li>
  );
});

function caretIndexAt(element: HTMLTextAreaElement, x: number, y: number): number {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const mirror = document.createElement("div");

  mirror.textContent = element.value;
  mirror.style.cssText = [
    "position: fixed",
    `left: ${box.left}px`,
    `top: ${box.top}px`,
    `width: ${box.width}px`,
    "margin: 0",
    "padding: 0",
    "border: 0",
    "box-sizing: border-box",
    "white-space: pre-wrap",
    "overflow-wrap: anywhere",
    `font-family: ${style.fontFamily}`,
    `font-size: ${style.fontSize}`,
    `font-style: ${style.fontStyle}`,
    `font-weight: ${style.fontWeight}`,
    `letter-spacing: ${style.letterSpacing}`,
    `line-height: ${style.lineHeight}`,
    "opacity: 0",
    "z-index: 9999",
  ].join(";");
  document.body.append(mirror);

  try {
    const text = mirror.firstChild;

    return text instanceof Text ? caretIndexIn(text, x, y) : element.value.length;
  } finally {
    mirror.remove();
  }
}

/** Where a point lands in a laid-out text node; the browsers name this call differently. */
function caretIndexIn(text: Text, x: number, y: number): number {
  const lookup = document as unknown as {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = lookup.caretPositionFromPoint?.(x, y) ?? null;

  if (position !== null && position.offsetNode === text) {
    return position.offset;
  }

  const range = lookup.caretRangeFromPoint?.(x, y) ?? null;

  if (range !== null && range.startContainer === text) {
    return range.startOffset;
  }

  // The point missed the text: the field opens with the caret at the end, as it always did.
  return text.data.length;
}
