/** The todo page's working surface: search, filters, groups and bulk actions. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useI18n } from "../../hooks/useI18n";
import { useTags } from "../../hooks/useTags";
import { useTodoDisplay } from "../../hooks/useTodoDisplay";
import { useTodos } from "../../hooks/useTodos";
import type { Todo, TodoFilter } from "../../types/todo";
import { isRecurringTodo } from "../../types/todoDisplay";
import { groupTodos, searchTodos } from "./todos";
import { TodoItem } from "./TodoItem";
import { TodoSearch } from "./TodoSearch";

const FILTERS: readonly TodoFilter[] = ["all", "active", "completed"];

const FILTER_LABELS: Record<TodoFilter, string> = {
  all: "todo.filter.all",
  active: "todo.filter.active",
  completed: "todo.filter.completed",
};

/** The two groups a task can sit in, in the order they are shown. */
type Group = "oneTime" | "recurring" | "merged";

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

/** The wall clock the relative timestamps are measured against, in the epoch seconds the API uses. */
function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return now;
}

/** Filter switch, the search, the groups themselves and the bulk actions. */
export function TodoList() {
  const { t } = useI18n();
  const {
    counts,
    error,
    filter,
    loading,
    remove,
    rename,
    setFilter,
    todos,
    toggle,
    updateTags,
  } = useTodos();
  const { tags } = useTags();
  const { mode } = useTodoDisplay();
  const now = useNow();

  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());

  const visible = useMemo(() => searchTodos(todos, tags, query), [todos, tags, query]);
  const groups = useMemo(() => {
    const definitions: { id: Group; tasks: readonly Todo[] }[] = mode === "merged"
      ? [{ id: "merged", tasks: visible }]
      : [
        { id: "oneTime", tasks: visible.filter((todo) => !isRecurringTodo(todo)) },
        { id: "recurring", tasks: visible.filter(isRecurringTodo) },
      ];
    return definitions.map(({ id, tasks }) => {
      const grouped = groupTodos(tasks);
      return { id, rows: [...grouped.active, ...grouped.completed] };
    });
  }, [visible, mode]);

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

    groups.forEach(({ id: group, rows }) => {
      rows.forEach((todo) => {
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

  const handleRename = (todo: Todo, title: string): void => {
    void rename(todo.id, title);
  };

  const handleUpdateTags = (todo: Todo, tagIds: readonly number[]): void => {
    void updateTags(todo.id, tagIds);
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
    <section className="todo-panel">
      <div className="todo-toolbar">
        <TodoSearch onChange={setQuery} query={query} />
        <SegmentedControl
          label={t("todo.filter.label")}
          onChange={setFilter}
          options={FILTERS.map((value) => ({ label: t(FILTER_LABELS[value]), value }))}
          value={filter}
        />
        <button
          aria-pressed={selecting}
          className="btn btn-quiet"
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
        <span className="todo-count">
          {query === ""
            ? t("todo.remaining", { remaining: counts.remaining })
            : t("todo.search.results", { count: visible.length })}
        </span>
      </div>

      {selecting ? (
        <div className="todo-bulk">
          <span className="todo-bulk-count">{t("todo.select.count", { count: selected.size })}</span>
          <div className="todo-bulk-actions">
            <button className="btn btn-quiet" onClick={selectEveryVisible} type="button">
              {t("todo.select.all")}
            </button>
            <button className="btn btn-quiet" onClick={invertSelection} type="button">
              {t("todo.select.invert")}
            </button>
            <button
              className="btn"
              disabled={selected.size === 0}
              onClick={completeSelected}
              type="button"
            >
              {t("todo.select.complete")}
            </button>
            <button
              className="btn btn-danger"
              disabled={selected.size === 0}
              onClick={deleteSelected}
              type="button"
            >
              {t("todo.select.delete")}
            </button>
          </div>
          <button className="todo-bulk-exit" onClick={exitSelecting} type="button">
            {t("todo.select.exit")}
          </button>
        </div>
      ) : null}

      {error !== null ? <p className="todo-error">{t("todo.error")}</p> : null}

      {loading ? (
        <p className="muted">{t("todo.loading")}</p>
      ) : visible.length === 0 ? (
        <div className="empty todo-empty">
          <span aria-hidden="true" className="todo-empty-icon">
            <svg viewBox="0 0 24 24">
              <path d="M9 5h6M7 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
              <path d="m9.5 12 2 2 3.5-4" />
            </svg>
          </span>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="todo-groups" data-mode={mode}>
          {groups.map(({ id: group, rows }) => {
            return (
              <section className="todo-group" key={group}>
                {group !== "merged" ? <h2 className="todo-group-head">
                  {t(`todo.section.${group}`)}
                  <span className="todo-group-count">{rows.length}</span>
                </h2> : null}
                {rows.length === 0 ? <p className="muted">{t("todo.empty")}</p> : null}
                <ul className="todo-list">
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
                      onToggle={handleToggle}
                      onUpdateTags={handleUpdateTags}
                      rowIndex={index}
                      selected={selected.has(todo.id)}
                      selecting={selecting}
                      showType={mode === "merged"}
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
