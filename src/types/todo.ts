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
  /** UTC epoch seconds the task is planned to start, or `null` when it has no start. */
  startAt: number | null;
  /** UTC epoch seconds the task is planned to end, or `null` when it has no end. */
  endAt: number | null;
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
export const COMPLETION_SCOPES = ["all", "today"] as const satisfies readonly CompletionScope[];

/** Numerator and denominator, mirrored from `models::todo::TaskCompletion`. */
export interface TaskCompletion {
  total: number;
  completed: number;
}
