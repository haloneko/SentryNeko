/** Todo state store: the list, its filter and the remaining count. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { Todo, TodoCounts, TodoFilter } from "../types/todo";

export interface TodoState {
  todos: readonly Todo[];
  counts: TodoCounts;
  filter: TodoFilter;
  loading: boolean;
  /** Code of the last failed call, `null` while everything is fine. */
  error: ApiCode | null;
  setFilter: (filter: TodoFilter) => void;
  refresh: () => Promise<void>;
  add: (title: string, startAt: number | null, endAt: number | null) => Promise<boolean>;
  rename: (id: number, title: string) => Promise<boolean>;
  /** Sets or clears when a task starts; the stored row replaces the one on the page. */
  setStartAt: (id: number, startAt: number | null) => Promise<boolean>;
  /** Sets or clears when a task ends; the stored row replaces the one on the page. */
  setEndAt: (id: number, endAt: number | null) => Promise<boolean>;
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
async function request<T>(command: string, args: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  return invoke<ApiResponse<T>>(command, args);
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

    const list = await request<Todo[]>("list_todos", {
      completed: completionArgument(get().filter),
    });

    if (!isOk(list)) {
      set({ loading: false, error: list.code });
      return;
    }

    const counts = await request<TodoCounts>("todo_counts");

    if (!isOk(counts)) {
      set({ loading: false, error: counts.code });
      return;
    }

    set({ todos: list.data, counts: counts.data, loading: false });
  },

  add: async (title, startAt, endAt) => {
    set({ error: null });

    const response = await request<Todo>("add_todo", { endAt, startAt, title });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const added = response.data;

    set((state) => ({
      todos: belongs(added, state.filter) ? [added, ...state.todos] : state.todos,
      counts: recounted(state.counts, null, added),
    }));

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

    return true;
  },

  setStartAt: async (id, startAt) => {
    set({ error: null });

    const response = await request<Todo>("set_todo_start_at", { id, startAt });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const started = response.data;

    // Only the row's own time changed, so it is patched in place and keeps its position.
    set((state) => ({
      todos: state.todos.map((todo) => (todo.id === started.id ? started : todo)),
    }));

    return true;
  },

  setEndAt: async (id, endAt) => {
    set({ error: null });

    const response = await request<Todo>("set_todo_end_at", { endAt, id });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    const ended = response.data;

    set((state) => ({
      todos: state.todos.map((todo) => (todo.id === ended.id ? ended : todo)),
    }));

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

    return true;
  },
}));
