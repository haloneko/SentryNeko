/** Alarm defaults hook: the ring duration and notification method every alarm rings with. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import { DEFAULT_ALARM_DEFAULTS, normalizeAlarmDefaults } from "../types/alarm";
import type { AlarmDefaults } from "../types/alarm";
import { parseSetting, SETTINGS } from "../types/setting";
import type { Setting } from "../types/setting";

/** The row this hook reads; the backend stores it as sent. */
const { category: DEFAULTS_CATEGORY, key: DEFAULTS_KEY } = SETTINGS.alarmDefaults;

export interface AlarmDefaultsState {
  /** The stored defaults, or the built-in ones until they arrive. */
  defaults: AlarmDefaults;
  loading: boolean;
  /** Code of the last failed call, `null` while everything is fine. */
  error: ApiCode | null;
  reload: () => Promise<void>;
  save: (defaults: AlarmDefaults) => Promise<AlarmDefaults | null>;
}

/** Runs a command, answering `UNSUPPORTED` outside Tauri so the UI can react the same way. */
async function request<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<ApiResponse<T>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  return invoke<ApiResponse<T>>(command, args);
}

/** Reads the defaults once and answers with what the backend stored after a save. */
export function useAlarmDefaults(): AlarmDefaultsState {
  const [defaults, setDefaults] = useState<AlarmDefaults>(DEFAULT_ALARM_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiCode | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);

    // An absent key answers `null` in `data`, which `parseSetting` reads as "use the defaults".
    const response = await request<Setting>("get_setting", { key: DEFAULTS_KEY });

    if (isOk(response)) {
      // The row is the frontend's to check: a duration outside `1..=60` falls back.
      setDefaults(normalizeAlarmDefaults(parseSetting<unknown>(response.data, null)));
      setError(null);
    } else {
      setError(response.code);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (next: AlarmDefaults): Promise<AlarmDefaults | null> => {
    // The backend stores what it is handed, so the check happens here: what goes into the row is
    // a duration and a method the settings page can produce.
    const checked = normalizeAlarmDefaults(next);
    const response = await request<Setting>("set_setting", {
      key: DEFAULTS_KEY,
      value: JSON.stringify(checked),
      category: DEFAULTS_CATEGORY,
    });

    if (!isOk(response)) {
      setError(response.code);
      return null;
    }

    // The echo is what is now in force; normalizing it keeps the form on a usable value.
    const saved = normalizeAlarmDefaults(parseSetting<unknown>(response.data, checked));
    setDefaults(saved);
    setError(null);

    return saved;
  }, []);

  return { defaults, error, loading, reload, save };
}
