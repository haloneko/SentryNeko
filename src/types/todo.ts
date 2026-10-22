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
  /**
   * UTC epoch seconds the task was pinned to the top of its group, or `null` while it is not pinned.
   *
   * The moment rather than a flag, because the list puts the most recently starred task first.
   */
  starredAt: number | null;

  extra: Readonly<Record<string, unknown>>;
  /**
   * Reserved: the column is read here, but nothing writes it yet.
   *
   * A note would be free-form text the user writes for themselves, so it is a column of its own
   * rather than an entry in `extra`.
   */
  notes: string | null;
}

/** Totals shown beside the list. */
export interface TodoCounts {
  total: number;
  remaining: number;
  completed: number;
}

/**
 * Which tasks the page shows.
 *
 * `open` is everything still to do, and `ongoing` and `late` are the two states a planned task can
 * be in at this minute — both of them sit inside `open`. `list_todos` only knows the completion
 * flag, so the planned states are drawn from the open list against the clock.
 */
export type TodoFilter = "all" | "open" | "ongoing" | "late" | "completed";

/**
 * Finished tasks, mirrored from `models::todo::TodoCompletions`.
 *
 * A task is a plan for later, so the interface counts finished tasks by day instead of dividing
 * them into a percentage.
 */
export interface TodoCompletions {
  /** Tasks finished since local midnight. */
  today: number;
  /** Every stored finished task. */
  all: number;
}
