/** Todo data access hooks: each surface subscribes to the fields it draws, and to nothing else. */

import { useShallow } from "zustand/react/shallow";

import { useTodoStore } from "../stores/todoStore";
import type { TodoCounts } from "../types/todo";

/**
 * The tasks, and the state the list draws them in.
 *
 * A hook per surface rather than one hook returning the whole store: a subscriber to the whole store
 * is redrawn by every field, so a task ticked off on the page also redrew the composer and the
 * dashboard panels that were reading a count somewhere else.
 */
export function useTodoList() {
  return useTodoStore(
    useShallow((state) => ({
      counts: state.counts,
      error: state.error,
      filter: state.filter,
      loading: state.loading,
      todos: state.todos,
    })),
  );
}

/** What is left and how much of it was finished today, for the page head. */
export function useTodoSummary() {
  return useTodoStore(
    useShallow((state) => ({
      completions: state.completions,
      counts: state.counts,
      filter: state.filter,
    })),
  );
}

/** The totals beside the list, and the panel that shows only them. */
export function useTodoCounts(): TodoCounts {
  return useTodoStore((state) => state.counts);
}

/** Finished tasks of today and of all time, with how the last read went. */
export function useTodoCompletions() {
  return useTodoStore(
    useShallow((state) => ({
      completions: state.completions,
      error: state.completionsError,
      loading: state.completionsLoading,
    })),
  );
}

/**
 * The actions, and nothing they act on.
 *
 * They keep their identity for the life of the store, so a component that only writes — a composer,
 * a bulk action — is not redrawn by the rows the write produces.
 */
export function useTodoActions() {
  return useTodoStore(
    useShallow((state) => ({
      add: state.add,
      refresh: state.refresh,
      refreshCompletions: state.refreshCompletions,
      remove: state.remove,
      rename: state.rename,
      setEndAt: state.setEndAt,
      setFilter: state.setFilter,
      setStarred: state.setStarred,
      setStartAt: state.setStartAt,
      toggle: state.toggle,
      updateTags: state.updateTags,
    })),
  );
}
