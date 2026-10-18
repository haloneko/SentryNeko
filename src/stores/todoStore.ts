/** Todo state store: the list, its filter and the remaining count. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type {
  Todo,
  TodoCounts,
  TodoFilter,
  TodoRecurrence,
} from "../types/todo";

export interface TodoState {
  todos: readonly Todo[];
  counts: TodoCounts;
  filter: TodoFilter;
  loading: boolean;
  /** Code of the last failed call, `null` while everything is fine. */
  error: ApiCode | null;
  setFilter: (filter: TodoFilter) => void;
  refresh: () => Promise<void>;
  add: (title: string, recurrence?: TodoRecurrence | null) => Promise<boolean>;
  rename: (id: number, title: string) => Promise<boolean>;
  /** Replaces the tags a task carries; an empty list leaves it untagged. */
  updateTags: (id: number, tagIds: readonly number[]) => Promise<boolean>;
  toggle: (todo: Todo) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

const EMPTY_COUNTS: TodoCounts = { total: 0, remaining: 0, completed: 0 };

/** Maps the UI filter to the `completed` argument the command takes. */
function completionArgument(filter: TodoFilter): boolean | null {
  if (filter === "active") {
    return false;
  }

  if (filter === "completed") {
    return true;
  }

  return null;
}

/** Runs a command, answering `UNSUPPORTED` outside Tauri so the UI can react the same way. */
async function request<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<ApiResponse<T>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  try {
    return await invoke<ApiResponse<T>>(command, args);
  } catch {
    return { code: "INTERNAL", message: command, details: null, data: null };
  }
}

/**
 * Whether a task still belongs in the list the current filter shows.
 *
 * The list is always what the backend would answer for the filter, and a change made on the page
 * has to keep it that way: a task ticked off under "active" is left out, and a task added under
 * "completed" is not slipped in. Under "all" every task belongs, which is what lets a ticked task
 * stay on the page and move between the two groups instead of leaving the list.
 */
function belongs(todo: Todo, filter: TodoFilter): boolean {
  if (filter === "active") {
    return !todo.completed;
  }

  if (filter === "completed") {
    return todo.completed;
  }

  return true;
}

/** The counts after a task appears, changes or goes away; a missing side is passed as `null`. */
function recounted(counts: TodoCounts, before: Todo | null, after: Todo | null): TodoCounts {
  const total = counts.total + (after === null ? 0 : 1) - (before === null ? 0 : 1);
  const completed =
    counts.completed + (after?.completed === true ? 1 : 0) - (before?.completed === true ? 1 : 0);

  return { total, completed, remaining: total - completed };
}
// A reset event can arrive during a user refresh or filter change; only the newest read may land.
let refreshVersion = 0;

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  counts: EMPTY_COUNTS,
  filter: "all",
  loading: false,
  error: null,

  setFilter: (filter) => {
    set({ filter });
  },

  refresh: async () => {
    // A load in place must not blank the page out: only the first list, with nothing on screen to
    // keep, gets to say it is loading. Every later one — a filter switch, a stale dashboard count —
    // swaps its result in quietly, so the rows stay put and their animations are left alone.
    set({ loading: get().todos.length === 0, error: null });
    const version = ++refreshVersion;

    const list = await request<Todo[]>("list_todos", {
      completed: completionArgument(get().filter),
    });
    if (version !== refreshVersion) return;

    if (!isOk(list)) {
      set({ loading: false, error: list.code });
      return;
    }

    const counts = await request<TodoCounts>("todo_counts");
    if (version !== refreshVersion) return;

    if (!isOk(counts)) {
      set({ loading: false, error: counts.code });
      return;
    }

    set({ todos: list.data, counts: counts.data, loading: false });
  },

  add: async (title, recurrence = null) => {
    set({ error: null });

    const response = await request<Todo>("add_todo", { title, recurrence });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const added = response.data;

    set((state) => ({
      todos: belongs(added, state.filter) ? [added, ...state.todos] : state.todos,
      counts: recounted(state.counts, null, added),
    }));

    await get().refresh();
    return true;
  },

  rename: async (id, title) => {
    set({ error: null });

    const response = await request<Todo>("rename_todo", { id, title });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const renamed = response.data;

    // Only the row's own text changed, so the list is patched in place: nothing else on the page
    // has a reason to move.
    set((state) => ({
      todos: state.todos.map((todo) => (todo.id === renamed.id ? renamed : todo)),
    }));

    await get().refresh();
    return true;
  },

  updateTags: async (id, tagIds) => {
    set({ error: null });

    const response = await request<Todo>("set_todo_tags", { id, tagIds: [...tagIds] });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const tagged = response.data;

    set((state) => ({
      todos: state.todos.map((todo) => (todo.id === tagged.id ? tagged : todo)),
    }));

    await get().refresh();
    return true;
  },

  toggle: async (todo) => {
    set({ error: null });

    const response = await request<Todo>("set_todo_completed", {
      completed: !todo.completed,
      id: todo.id,
    });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const moved = response.data;

    // Under "all" the row stays in the list so the page can carry it over to its new group; under a
    // filter the list no longer holds it, so it goes.
    set((state) => ({
      todos: belongs(moved, state.filter)
        ? state.todos.map((item) => (item.id === moved.id ? moved : item))
        : state.todos.filter((item) => item.id !== moved.id),
      counts: recounted(state.counts, todo, moved),
    }));

    await get().refresh();
    return true;
  },

  remove: async (id) => {
    set({ error: null });

    const response = await request<unknown>("delete_todo", { id });

    // `isOk` cannot narrow a payload typed `null`, so the code is checked directly.
    if (response.code !== "OK") {
      set({ error: response.code });
      return false;
    }

    set((state) => ({
      todos: state.todos.filter((todo) => todo.id !== id),
      counts: recounted(state.counts, state.todos.find((todo) => todo.id === id) ?? null, null),
    }));

    await get().refresh();
    return true;
  },
}));
