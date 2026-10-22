/** The todo page's working surface: search, filters, groups and bulk actions. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ActionIcon } from "../../components/ui/ActionIcon";
import { Popconfirm } from "../../components/ui/Popconfirm";
import { useI18n } from "../../hooks/useI18n";
import { useMinuteClock } from "../../hooks/useMinuteClock";
import { useTags } from "../../hooks/useTags";
import { useTodos } from "../../hooks/useTodos";
import type { Todo } from "../../types/todo";
import type { TodoSort } from "./todos";
import { groupTodos, isLate, overdueCount, searchTodos } from "./todos";
import { TodoFilterMenu } from "./TodoFilterMenu";
import { TodoItem } from "./TodoItem";
import { TodoSearch } from "./TodoSearch";
import { TodoSortMenu } from "./TodoSortMenu";
import todosStyles from "./todos.module.css";

/** The two groups a task can sit in, in the order they are shown. */
const GROUPS = ["active", "completed"] as const;

type Group = (typeof GROUPS)[number];

/** Where a task sat in the last paint: which group, and how far from the top of the window. */
interface Placement {
  group: Group;
  top: number;
}

/**
 * Where a row sits down the document, in the layout's own pixels.
 *
 * A row's box is the wrong thing to measure here, twice over. It reports where a running flip has
 * carried the row instead of where it will settle, so a second change mid-slide would read that
 * animation as a new position and send a corrective move after it. And it is scaled by `zoom`, which
 * the reading column carries so that a wide window can enlarge the whole page — but the `translateY`
 * a flip writes is in layout pixels, so a slide measured off a box overshoots by the zoom factor.
 *
 * `offsetTop` has neither problem, only the drawback of being relative to the row's own list, which
 * is why the chain is walked up to the root: a task moving between groups has to be compared in one
 * coordinate space. Each step rounds to whole pixels, so under `zoom` two different lists can come
 * out a few pixels apart — a few pixels of starting offset on a slide, against a whole slide that is
 * wrong by the zoom factor itself.
 */
function pageTop(element: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = element;

  while (node !== null) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }

  return top;
}

/**
 * How long a row fades before the task is really taken off the list.
 *
 * It is the card's own fade, to the millisecond: any longer and the list sits still after the row
 * has already gone, any shorter and the row would leave while it is still on screen.
 */
const LEAVE_MS = 140;

/** How long a task takes to travel to its new place when it changes group. */
const MOVE_MS = 320;

/** How long the row that changed group stays lit once it has landed. */
const SETTLE_MS = 640;

/** Filter switch, the search, the groups themselves and the bulk actions. */
export function TodoList() {
  const { language, t } = useI18n();
  const {
    counts,
    error,
    filter,
    loading,
    remove,
    rename,
    setEndAt,
    setFilter,
    setStarred,
    setStartAt,
    todos,
    toggle,
    updateTags,
  } = useTodos();
  const { tags } = useTags();
  const now = useMinuteClock();

  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());
  // The order the list is drawn in, and the two narrowings the filter card adds on top of the
  // status the backend already answers.
  const [sort, setSort] = useState<TodoSort>("default");
  const [tagId, setTagId] = useState<number | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const visible = useMemo(() => {
    const searched = searchTodos(todos, tags, query);
    const tagged =
      tagId === null ? searched : searched.filter((todo) => todo.tagIds.includes(tagId));

    return overdueOnly ? tagged.filter((todo) => isLate(todo, now)) : tagged;
  }, [now, overdueOnly, query, tagId, tags, todos]);
  const groups = useMemo(
    () => groupTodos(visible, sort, language),
    [language, sort, visible],
  );

  /** Puts the status and the two card filters back to "everything". */
  const clearFilters = (): void => {
    setFilter("all");
    setTagId(null);
    setOverdueOnly(false);
  };

  // Counted against the same minute the rows read, so the badge and the flags on the rows agree.
  // It covers what the search leaves: a count of tasks that are not on the screen beside them
  // would be a number with nothing to point at.
  const overdue = useMemo(() => overdueCount(visible, now), [visible, now]);

  /** The row elements by task id, so a task that moved can be measured where it landed. */
  const rowElements = useRef(new Map<number, HTMLLIElement>());
  /** Where each task sat in the last paint, which is the "before" half of the animation below. */
  const placements = useRef(new Map<number, Placement>());

  const placeRow = useCallback((id: number, element: HTMLLIElement | null) => {
    if (element === null) {
      rowElements.current.delete(id);
    } else {
      rowElements.current.set(id, element);
    }
  }, []);

  /**
   * Flips every task that stayed on the page from where it was to where it is now.
   *
   * Tick a task off under the "all" filter and it is not taken off the list at all: it moves into
   * the other group. Comparing where each row sat in the last paint with where it sits here says
   * how far it travelled, and animating that distance away is what sends the row gliding across
   * the divider while the rows it passed slide up to fill the gap it left.
   *
   * A row that is new to the page is skipped: the entrance animation already covers it.
   *
   * Each row is measured where it will settle rather than where a running flip currently has it, so
   * a second change mid-slide does not read the animation as a new position and start a corrective
   * move of its own.
   */
  useLayoutEffect(() => {
    const landed = new Map<number, Placement>();

    GROUPS.forEach((group) => {
      groups[group].forEach((todo) => {
        const element = rowElements.current.get(todo.id);

        if (element !== undefined) {
          landed.set(todo.id, { group, top: pageTop(element) });
        }
      });
    });

    const before = placements.current;

    placements.current = landed;

    if (before.size === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    landed.forEach((last, id) => {
      const first = before.get(id);
      const element = rowElements.current.get(id);

      if (first === undefined || element === undefined) {
        return;
      }

      const distance = first.top - last.top;

      if (Math.abs(distance) > 1) {
        element.animate([{ transform: `translateY(${distance}px)` }, { transform: "none" }], {
          duration: MOVE_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }

      if (first.group !== last.group) {
        // The row stays lit for a moment, so the eye can follow it into its new group.
        element.dataset.settled = "true";

        window.setTimeout(() => {
          delete element.dataset.settled;
        }, SETTLE_MS);
      }
    });
    // `leaving` is a dependency as well: the frame a row is pinned out of the flow is a frame where
    // the rows below close the gap, and that is the distance this needs to carry them over.
  }, [groups, leaving]);

  /** The selected tasks as the store holds them, so a pick made under another filter still works. */
  const chosen = useMemo(() => todos.filter((todo) => selected.has(todo.id)), [todos, selected]);

  /**
   * Escape leaves the mode, so a pick made by mistake costs one key instead of a trip to the bar.
   *
   * A field that owns the key keeps it: renaming a task and the tag filter both close on Escape,
   * and taking the whole mode down underneath them would be a surprise.
   */
  useEffect(() => {
    if (!selecting) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement && target.closest("input, textarea")) {
        return;
      }

      setSelecting(false);
      setSelected(new Set());
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selecting]);

  /**
   * Lifts a row out of the flow where it stands.
   *
   * The position goes into custom properties rather than into `top`/`left` directly, because the row
   * element carries a style object React owns — its place in the list, for the entrance stagger —
   * and that object is diffed on every render.
   */
  const pin = useCallback((id: number): boolean => {
    const element = rowElements.current.get(id);

    if (element === undefined || element.parentElement === null) {
      return false;
    }

    // Offsets rather than a box: these are the layout pixels the `top` and `width` behind them are
    // read back as, while a box would come back scaled by `zoom` and pin the row off by that factor.
    element.style.setProperty("--exit-top", `${element.offsetTop}px`);
    element.style.setProperty("--exit-left", `${element.offsetLeft}px`);
    element.style.setProperty("--exit-width", `${element.offsetWidth}px`);

    return true;
  }, []);

  /** Puts a row that stayed on the list back into the flow, where it was. */
  const unpin = useCallback((id: number): void => {
    const element = rowElements.current.get(id);

    if (element === undefined) {
      return;
    }

    element.style.removeProperty("--exit-top");
    element.style.removeProperty("--exit-left");
    element.style.removeProperty("--exit-width");
  }, []);

  /**
   * Takes rows off the list.
   *
   * Each row is pinned where it stands before it is marked as leaving, so it stops taking up room in
   * the same frame: the card fades on the spot while the rows below close the gap it left, carried
   * there by the flip above. Leaving the row in the flow until it had faded would make the list wait
   * for it and only then close up, which reads as two moves where the eye expects one.
   *
   * The marks come off either way: a row that failed comes back into the flow where it was, and a
   * row that only moved between groups comes back to sit in its new one.
   */
  const retire = useCallback(
    (ids: readonly number[], action: () => Promise<boolean>) => {
      const pinned = ids.filter(pin);

      setLeaving((current) => new Set([...current, ...ids]));

      window.setTimeout(() => {
        void action().then(() => {
          pinned.forEach(unpin);

          setLeaving((current) => {
            const next = new Set(current);

            ids.forEach((id) => next.delete(id));

            return next;
          });
        });
      }, LEAVE_MS);
    },
    [pin, unpin],
  );

  /**
   * Runs an action that only moves tasks around the page.
   *
   * Under the "all" filter the rows have somewhere to go, so they are left in place and the flip
   * above carries them; under a filter the task leaves the list for good and fades out the way a
   * removed row does.
   */
  const act = useCallback(
    (ids: readonly number[], action: () => Promise<boolean>) => {
      if (filter === "all") {
        void action();
        return;
      }

      retire(ids, action);
    },
    [filter, retire],
  );

  const handleToggle = (todo: Todo): void => {
    act([todo.id], () => toggle(todo));
  };

  const handleRemove = (todo: Todo): void => {
    retire([todo.id], () => remove(todo.id));
  };

  /**
   * Pinning never takes a row off the page, so the row is left where it is and the flip above
   * carries it to the top of its group.
   */
  const handleStar = (todo: Todo): void => {
    void setStarred(todo.id, todo.starredAt === null);
  };

  const handleRename = (todo: Todo, title: string): void => {
    void rename(todo.id, title);
  };

  const handleUpdateTags = (todo: Todo, tagIds: readonly number[]): void => {
    void updateTags(todo.id, tagIds);
  };

  /** The two ends are separate commands, so the row is patched by the answer of the one that moved. */
  const handleSetStartAt = (todo: Todo, startAt: number | null): void => {
    void setStartAt(todo.id, startAt);
  };

  const handleSetEndAt = (todo: Todo, endAt: number | null): void => {
    void setEndAt(todo.id, endAt);
  };

  const handleSelect = (id: number): void => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const exitSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };

  const selectEveryVisible = (): void => {
    setSelected(new Set(visible.map((todo) => todo.id)));
  };

  const invertSelection = (): void => {
    setSelected(
      new Set(
        visible
          .map((todo) => todo.id)
          .filter((id) => !selected.has(id)),
      ),
    );
  };

  const completeSelected = (): void => {
    const pending = chosen.filter((todo) => !todo.completed);

    if (pending.length === 0) {
      return;
    }

    act(
      pending.map((todo) => todo.id),
      async () => {
        const done = await Promise.all(pending.map((todo) => toggle(todo)));

        return done.every(Boolean);
      },
    );

    // The pick is spent: leaving it would make the next bulk act on tasks that are already gone.
    setSelected(new Set());
  };

  const deleteSelected = (): void => {
    if (chosen.length === 0) {
      return;
    }

    retire(
      chosen.map((todo) => todo.id),
      async () => {
        const done = await Promise.all(chosen.map((todo) => remove(todo.id)));

        return done.every(Boolean);
      },
    );

    setSelected(new Set());
  };

  const emptyMessage =
    query === ""
      ? counts.total === 0
        ? t("todo.empty")
        : t("todo.filter.empty")
      : t("todo.search.empty", { query });

  return (
    <section className={todosStyles.todoPanel}>
      <div className={todosStyles.todoToolbar}>
        <TodoSearch onChange={setQuery} query={query} />
        {/* The status switch keeps its place inside the funnel: it is the narrowing used daily. */}
        <TodoFilterMenu
          filter={filter}
          onClear={clearFilters}
          onFilterChange={setFilter}
          onOverdueChange={setOverdueOnly}
          onTagChange={setTagId}
          overdueOnly={overdueOnly}
          tagId={tagId}
          tags={tags}
        />
        <TodoSortMenu onChange={setSort} sort={sort} />
        <button
          aria-pressed={selecting}
          className={`btn btn-quiet ${todosStyles.todoSelectToggle}`}
          data-testid="todo-select-toggle"
          onClick={() => {
            if (selecting) {
              exitSelecting();
            } else {
              setSelecting(true);
            }
          }}
          type="button"
        >
          {selecting ? t("todo.select.exit") : t("todo.select.enter")}
        </button>
        {overdue > 0 ? (
          <span className={todosStyles.todoOverdue}>{t("todo.overdue", { count: overdue })}</span>
        ) : null}
        <span className={todosStyles.todoCount}>
          {query === "" && tagId === null && !overdueOnly
            ? t("todo.remaining", { remaining: counts.remaining })
            : t("todo.search.results", { count: visible.length })}
        </span>
      </div>

      {/*
        The bar is always mounted and animated open: a mode that appears out of nowhere costs the
        eye a jump, and the rows below it would slide down in one frame.
      */}
      <div
        aria-label={t("todo.select.enter")}
        className={todosStyles.todoBulk}
        data-open={selecting}
        data-testid="todo-bulk"
        role="region"
      >
        <div className={todosStyles.todoBulkBody} inert={!selecting}>
          <div className={todosStyles.todoBulkSurface}>
            <span aria-live="polite" className={todosStyles.todoBulkCount}>
              {t("todo.select.count", { count: selected.size })}
            </span>
            <span aria-hidden="true" className={todosStyles.todoBulkSep} />
            <button className={`btn btn-quiet ${todosStyles.todoBulkQuiet}`} onClick={selectEveryVisible} type="button">
              {t("todo.select.all")}
            </button>
            <button className={`btn btn-quiet ${todosStyles.todoBulkQuiet}`} onClick={invertSelection} type="button">
              {t("todo.select.invert")}
            </button>
            <div className={todosStyles.todoBulkActions}>
              <button
                className="btn"
                disabled={selected.size === 0}
                onClick={completeSelected}
                type="button"
              >
                {t("todo.select.complete")}
              </button>
              <Popconfirm
                cancelText={t("todo.confirm.cancel")}
                confirmText={t("todo.confirm.delete")}
                danger
                icon={<ActionIcon name="delete" />}
                onConfirm={deleteSelected}
                title={t("todo.confirm.deleteSelected")}
              >
                <button className="btn btn-danger" disabled={selected.size === 0} type="button">
                  {t("todo.select.delete")}
                </button>
              </Popconfirm>
            </div>
          </div>
        </div>
      </div>

      {error !== null ? <p className={todosStyles.todoError}>{t("todo.error")}</p> : null}

      {loading ? (
        <p className="muted">{t("todo.loading")}</p>
      ) : visible.length === 0 ? (
        <div className={`empty ${todosStyles.todoEmpty}`}>
          <span aria-hidden="true" className={todosStyles.todoEmptyIcon}>
            <svg viewBox="0 0 24 24">
              <path d="M9 5h6M7 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
              <path d="m9.5 12 2 2 3.5-4" />
            </svg>
          </span>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className={todosStyles.todoGroups}>
          {GROUPS.map((group) => {
            const rows = groups[group];

            if (rows.length === 0) {
              return null;
            }

            return (
              <section className={todosStyles.todoGroup} data-testid="todo-group" key={group}>
                <h2 className={todosStyles.todoGroupHead} data-testid="todo-group-head">
                  {t(`todo.group.${group}`)}
                  <span className={todosStyles.todoGroupCount} data-testid="todo-group-count">{rows.length}</span>
                </h2>
                <ul className={todosStyles.todoList}>
                  {rows.map((todo, index) => (
                    <TodoItem
                      key={todo.id}
                      /* A task the last paint did not have is arriving; one it did have is moving. */
                      entering={!placements.current.has(todo.id)}
                      leaving={leaving.has(todo.id)}
                      now={now}
                      onRemove={handleRemove}
                      onRename={handleRename}
                      onRowRef={placeRow}
                      onSelect={handleSelect}
                      onSetEndAt={handleSetEndAt}
                      onSetStartAt={handleSetStartAt}
                      onStar={handleStar}
                      onToggle={handleToggle}
                      onUpdateTags={handleUpdateTags}
                      rowIndex={index}
                      selected={selected.has(todo.id)}
                      selecting={selecting}
                      tags={tags}
                      todo={todo}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
