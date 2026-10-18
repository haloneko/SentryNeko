/** The backend's allow-list of reviewable operations. */
export type AiAction =
  | { kind: "createTodo"; title: string }
  | { kind: "completeTodo"; todoId: number }
  | { kind: "setTodoTags"; todoId: number; tagIds: readonly number[] }
  | { kind: "renameTag"; tagId: number; name: string }
  | { kind: "createAlarm"; label: string; hour: number; minute: number };

export interface AiSettings {
  model: string;
  port: number;
}

export interface AiSuggestion {
  id: number;
  reason: string;
  action: AiAction;
  revision: number;
  createdAt: number;
}

export interface AiOperationLog {
  id: number;
  suggestionId: number;
  event: "proposed" | "edited" | "confirmed" | "rejected";
  reason: string;
  action: AiAction;
  resultId: number | null;
  createdAt: number;
}
