/** Todo task types mirrored from `models/todo.rs`. */

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
  /** UTC epoch seconds. */
  createdAt: number;
  updatedAt: number;
  /** Ids of the tags the task carries, see `types/tag.ts`. */
  tagIds: readonly number[];
  recurrence: TodoRecurrence | null;
  /** UTC epoch seconds of the next reset, or null for a one-time task. */
  nextOccurrenceAt: number | null;
}

export type RecurrenceUnit = "day" | "week" | "month";

export interface TodoRecurrence {
  unit: RecurrenceUnit;
  /** Integer from 1 through 365. */
  interval: number;
}

/** Totals shown beside the list. */
export interface TodoCounts {
  total: number;
  remaining: number;
  completed: number;
}

/** Which tasks the page shows; `list_todos` takes the same three states. */
export type TodoFilter = "all" | "active" | "completed";

/** Tasks a completion rate covers; `completion_rate` takes the same values. */
export type CompletionScope = "all" | "today";

/** Every scope, in the order the switcher shows them. */
export const COMPLETION_SCOPES = [
  "all",
  "today",
] as const satisfies readonly CompletionScope[];

/** Numerator and denominator, mirrored from `models::todo::TaskCompletion`. */
export interface TaskCompletion {
  total: number;
  completed: number;
}
