/** Font preferences and the installed Windows families offered by the settings page. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { useFontSettingsStore } from "../stores/fontSettingsStore";
import { isOk } from "../types";
import type { ApiResponse } from "../types";

export function useFontSettings() {
  const settings = useFontSettingsStore((state) => state.settings);
  const status = useFontSettingsStore((state) => state.status);
  const update = useFontSettingsStore((state) => state.update);
  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(isTauri);
  const [fontsError, setFontsError] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;

    async function load(): Promise<void> {
      try {
        const response = await invoke<ApiResponse<string[]>>("get_system_fonts");

        if (active) {
          if (isOk(response) && Array.isArray(response.data)) {
            setFamilies(response.data.filter((family) => typeof family === "string"));
          } else {
            setFontsError(true);
          }
        }
      } catch {
        if (active) {
          setFontsError(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  return { families, fontsError, loading, settings, status, update };
}
