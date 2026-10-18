/** Task display preference shared by settings and the task list. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { ApiResponse } from "../types";
import { isTodoDisplayMode } from "../types/todoDisplay";
import type { TodoDisplayMode } from "../types/todoDisplay";

const STORAGE_KEY = "sentryneko.todoDisplayMode";

interface TodoDisplayState {
  mode: TodoDisplayMode;
  saving: boolean;
  error: boolean;
  setMode: (mode: TodoDisplayMode) => Promise<void>;
}

export const useTodoDisplayStore = create<TodoDisplayState>((set, get) => ({
  mode: "separated",
  saving: false,
  error: false,
  setMode: async (mode) => {
    if (get().saving) {
      return;
    }

    set({ saving: true, error: false });

    try {
      if (isTauri()) {
        const response = await invoke<ApiResponse<TodoDisplayMode>>("set_todo_display_mode", { mode });

        if (response.code !== "OK" || !isTodoDisplayMode(response.data)) {
          set({ saving: false, error: true });
          return;
        }

        set({ mode: response.data, saving: false });
      } else {
        localStorage.setItem(STORAGE_KEY, mode);
        set({ mode, saving: false });
      }
    } catch {
      set({ saving: false, error: true });
    }
  },
}));

/** Resolves the saved layout before the app's first render. */
export async function loadTodoDisplayMode(): Promise<void> {
  try {
    const response = isTauri()
      ? await invoke<ApiResponse<TodoDisplayMode>>("get_todo_display_mode")
      : { code: "OK", data: localStorage.getItem(STORAGE_KEY) ?? "separated" };

    if (response.code === "OK" && isTodoDisplayMode(response.data)) {
      useTodoDisplayStore.setState({ mode: response.data, error: false });
    } else {
      useTodoDisplayStore.setState({ error: true });
    }
  } catch {
    useTodoDisplayStore.setState({ error: true });
  }
}
