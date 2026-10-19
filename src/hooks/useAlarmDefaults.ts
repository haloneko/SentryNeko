/** Alarm defaults hook: the ring duration and notification method every alarm rings with. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import { DEFAULT_ALARM_DEFAULTS } from "../types/alarm";
import type { AlarmDefaults } from "../types/alarm";
import { ALARM_DEFAULTS_KEY, parseSetting } from "../types/setting";
import type { Setting } from "../types/setting";

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
    const response = await request<Setting>("get_setting", { key: ALARM_DEFAULTS_KEY });

    if (isOk(response)) {
      setDefaults(parseSetting(response.data, DEFAULT_ALARM_DEFAULTS));
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
    const response = await request<Setting>("set_setting", {
      key: ALARM_DEFAULTS_KEY,
      value: JSON.stringify(next),
    });

    if (!isOk(response)) {
      setError(response.code);
      return null;
    }

    // The backend validates the duration, so the echo is the value actually in force.
    const saved = parseSetting(response.data, next);
    setDefaults(saved);
    setError(null);

    return saved;
  }, []);

  return { defaults, error, loading, reload, save };
}
