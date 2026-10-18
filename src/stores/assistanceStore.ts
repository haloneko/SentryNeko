/** AI requests and review state outlive the page, so inference never blocks navigation. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { useTodoStore } from "./todoStore";
import { useTagStore } from "./tagStore";

import type { ApiCode, ApiResponse } from "../types";
import type {
  AiAction,
  AiOperationLog,
  AiSettings,
  AiSuggestion,
} from "../types/assistance";
import type { Tag } from "../types/tag";
import type { Todo } from "../types/todo";

interface AssistanceState {
  settings: AiSettings;
  suggestions: readonly AiSuggestion[];
  log: readonly AiOperationLog[];
  todos: readonly Todo[];
  tags: readonly Tag[];
  loading: boolean;
  busy: boolean;
  generating: boolean;
  generated: boolean;
  error: ApiCode | null;
  hasMore: boolean;
  load: () => Promise<void>;
  saveSettings: (settings: AiSettings) => Promise<boolean>;
  generate: (prompt: string) => Promise<void>;
  edit: (suggestion: AiSuggestion, action: AiAction) => Promise<boolean>;
  confirm: (suggestion: AiSuggestion) => Promise<void>;
  reject: (suggestion: AiSuggestion) => Promise<void>;
  clearLog: () => Promise<void>;
  loadMore: () => Promise<void>;
}

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

export const useAssistanceStore = create<AssistanceState>((set, get) => {
  let refreshQueue = Promise.resolve();
  async function mutate(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (get().busy || get().loading || get().generating) return false;
    set({ busy: true, error: null });
    const response = await request<unknown>(command, args);
    // A conflict may mean another review has already changed the row; refresh the preview too.
    await get().load();
    set({
      busy: false,
      error: response.code === "OK" ? get().error : response.code,
    });
    return response.code === "OK";
  }

  return {
    settings: { model: "", port: 11434 },
    suggestions: [],
    log: [],
    todos: [],
    tags: [],
    loading: false,
    busy: false,
    generating: false,
    generated: false,
    error: null,
    hasMore: false,

    load: () => {
      const pending = refreshQueue.then(async () => {
        set({ loading: true });
        const [settings, suggestions, log, todos, tags] = await Promise.all([
          request<AiSettings>("get_ai_settings"),
          request<AiSuggestion[]>("list_ai_suggestions"),
          request<AiOperationLog[]>("list_ai_operation_log", { before: null }),
          request<Todo[]>("list_todos", { completed: null }),
          request<Tag[]>("list_tags"),
        ]);
        const failure = [settings, suggestions, log, todos, tags].find(
          (response) => response.code !== "OK",
        );
        if (
          failure ||
          !settings.data ||
          !suggestions.data ||
          !log.data ||
          !todos.data ||
          !tags.data
        ) {
          set({ loading: false, error: failure?.code ?? "INTERNAL" });
          return;
        }
        set({
          settings: settings.data,
          suggestions: suggestions.data,
          log: log.data,
          todos: todos.data,
          tags: tags.data,
          hasMore: log.data.length === 50,
          loading: false,
          error: null,
        });
      });
      refreshQueue = pending;
      return pending;
    },

    saveSettings: (settings) => mutate("set_ai_settings", { settings }),

    generate: async (prompt) => {
      if (get().generating || get().loading || get().busy) return;
      set({ generating: true, generated: false, error: null });
      const response = await request<AiSuggestion[]>(
        "generate_ai_suggestions",
        { prompt },
      );
      await get().load();
      set({
        generating: false,
        generated: response.code === "OK",
        error: response.code === "OK" ? get().error : response.code,
      });
    },

    edit: (suggestion, action) =>
      mutate("edit_ai_suggestion", {
        id: suggestion.id,
        revision: suggestion.revision,
        action,
      }),
    confirm: async (suggestion) => {
      const stored = await mutate("confirm_ai_suggestion", {
        id: suggestion.id,
        revision: suggestion.revision,
        confirmed: true,
      });
      if (stored) await Promise.all([useTodoStore.getState().refresh(), useTagStore.getState().refresh()]);
    },
    reject: async (suggestion) => {
      await mutate("reject_ai_suggestion", {
        id: suggestion.id,
        revision: suggestion.revision,
      });
    },
    clearLog: async () => {
      await mutate("clear_ai_operation_log");
    },

    loadMore: async () => {
      if (get().busy || get().loading || get().generating || !get().hasMore)
        return;
      const before = get().log.at(-1)?.id;
      if (before === undefined) return;
      set({ busy: true, error: null });
      const response = await request<AiOperationLog[]>(
        "list_ai_operation_log",
        { before },
      );
      if (response.code === "OK" && response.data) {
        set({
          log: [...get().log, ...response.data],
          hasMore: response.data.length === 50,
          busy: false,
        });
      } else {
        set({ error: response.code, busy: false });
      }
    },
  };
});
