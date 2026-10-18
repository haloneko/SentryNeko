/** Todo page helpers: what the search matches, how the list is ordered and grouped. */

import type { Tag } from "../../types/tag";
import type { Todo, TodoSort } from "../../types/todo";

/** How long ago something happened, in the largest unit that still reads as "ago". */
export type Age =
  | { unit: "now" }
  | { count: number; unit: "minutes" | "hours" | "days" };

/** Whether `todo` matches `query`, by title or by the name of any tag it carries. */
export function matchesQuery(todo: Todo, tags: readonly Tag[], query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return true;
  }

  if (todo.title.toLowerCase().includes(needle)) {
    return true;
  }

  const names = new Map(tags.map((tag) => [tag.id, tag.name.toLowerCase()]));

  return todo.tagIds.some((id) => names.get(id)?.includes(needle) ?? false);
}

/** Newest first, so a task that was just added arrives at the top of its group. */
export function sortTodos(todos: readonly Todo[], sort: TodoSort = "default"): readonly Todo[] {
  return [...todos].sort((a, b) => {
    if (sort === "default") {
      return Number(a.completed) - Number(b.completed) || b.id - a.id;
    }
    if (a.dueDate == null || b.dueDate == null) {
      return Number(a.dueDate == null) - Number(b.dueDate == null) || b.id - a.id;
    }
    return (sort === "dueDateAsc" ? a.dueDate - b.dueDate : b.dueDate - a.dueDate) || b.id - a.id;
  });
}

/** The tasks the search leaves, in the order the page shows them. */
export function searchTodos(
  todos: readonly Todo[],
  tags: readonly Tag[],
  query: string,
  sort: TodoSort = "default",
): readonly Todo[] {
  return sortTodos(todos.filter((todo) => matchesQuery(todo, tags, query)), sort);
}

/** The two groups the list is drawn in; the backend filter decides whether both can be non-empty. */
export function groupTodos(todos: readonly Todo[]): {
  active: readonly Todo[];
  completed: readonly Todo[];
} {
  return {
    active: sortTodos(todos.filter((todo) => !todo.completed)),
    completed: sortTodos(todos.filter((todo) => todo.completed)),
  };
}

/** The names of the tags a task carries, in the order the task holds them. */
export function tagNamesOf(todo: Todo, tags: readonly Tag[]): readonly string[] {
  const names = new Map(tags.map((tag) => [tag.id, tag.name]));

  return todo.tagIds.map((id) => names.get(id)).filter((name): name is string => name !== undefined);
}

/** How long ago `timestamp` was, measured against `now`; both are UTC epoch seconds. */
export function ageOf(timestamp: number, now: number): Age {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60);

  if (minutes < 1) {
    return { unit: "now" };
  }

  if (minutes < 60) {
    return { count: minutes, unit: "minutes" };
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return { count: hours, unit: "hours" };
  }

  return { count: Math.floor(hours / 24), unit: "days" };
}
