/** Task list layouts persisted by the settings commands. */
import type { Todo } from "./todo";

export const TODO_DISPLAY_MODES = ["separated", "merged", "twoColumns"] as const;

export type TodoDisplayMode = (typeof TODO_DISPLAY_MODES)[number];

export function isTodoDisplayMode(value: unknown): value is TodoDisplayMode {
  return TODO_DISPLAY_MODES.some((mode) => mode === value);
}

/** Task payloads predating recurring tasks have no recurrence field and are one-time tasks. */
export function isRecurringTodo(todo: Todo): boolean {
  return "recurrence" in todo && todo.recurrence != null;
}
