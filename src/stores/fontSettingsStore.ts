/** Applies typography immediately and serializes saves to keep the latest choice on disk. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { isOk } from "../types";
import type { ApiResponse } from "../types";
import { BUNDLED_FONT_FAMILY, DEFAULT_FONT_SETTINGS, isFontSettings } from "../types/font";
import type { FontSettings } from "../types/font";

const STORAGE_KEY = "sentryneko.fontSettings";

interface FontSettingsState {
  settings: FontSettings;
  status: "idle" | "saving" | "saved" | "error";
  update: (patch: Partial<FontSettings>) => Promise<void>;
}

function mirroredSettings(): FontSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

    return isFontSettings(value) ? value : DEFAULT_FONT_SETTINGS;
  } catch {
    return DEFAULT_FONT_SETTINGS;
  }
}

function apply(settings: FontSettings): void {
  const root = document.documentElement;
  const family =
    settings.family === null
      ? "var(--font-system)"
      : settings.family === BUNDLED_FONT_FAMILY
        ? '"JetBrains Mono Variable", var(--font-system)'
        : `${JSON.stringify(settings.family)}, var(--font-system)`;

  root.style.setProperty("--font-sans", family);
  root.style.setProperty("--font-size", `${settings.size}px`);
  root.style.setProperty("--font-scale", String(settings.size / DEFAULT_FONT_SETTINGS.size));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Native persistence still works when browser storage is unavailable.
  }
}

let revision = 0;
let writes = Promise.resolve();

export const useFontSettingsStore = create<FontSettingsState>((set, get) => ({
  settings: mirroredSettings(),
  status: "idle",
  update: (patch) => {
    const settings = { ...get().settings, ...patch };

    if (!isFontSettings(settings)) {
      return Promise.resolve();
    }

    apply(settings);
    set({ settings, status: isTauri() ? "saving" : "saved" });
    const changedAt = ++revision;

    if (!isTauri()) {
      return Promise.resolve();
    }

    writes = writes.then(async () => {
      // Coalesce changes still waiting behind an earlier write, never reorder writes in flight.
      if (changedAt !== revision) {
        return;
      }

      try {
        const response = await invoke<ApiResponse<FontSettings>>("set_font_settings", { settings });

        if (changedAt === revision) {
          set({ status: isOk(response) && isFontSettings(response.data) ? "saved" : "error" });
        }
      } catch {
        if (changedAt === revision) {
          set({ status: "error" });
        }
      }
    });

    return writes;
  },
}));

/** Resolve the saved family and size before React paints any content. */
export async function loadFontSettings(): Promise<void> {
  const mirrored = mirroredSettings();

  apply(mirrored);
  useFontSettingsStore.setState({ settings: mirrored });

  if (!isTauri()) {
    return;
  }

  try {
    const response = await invoke<ApiResponse<FontSettings>>("get_font_settings");

    if (isOk(response) && isFontSettings(response.data)) {
      apply(response.data);
      useFontSettingsStore.setState({ settings: response.data });
    }
  } catch {
    // Keep the local mirror when the backend cannot be reached.
  }
}
