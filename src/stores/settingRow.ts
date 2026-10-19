/** One row of the backend `settings` table, as a store sees it. */
import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ApiResponse } from "../types";
import type { Setting } from "../types/setting";

/** The two generic commands a store needs to keep one row; both answer with the row itself. */
type SettingCommand = "get_setting" | "set_setting";

/**
 * Runs a settings command, answering `UNSUPPORTED` outside Tauri.
 *
 * The browser preview has no backend, so the caller falls back to the mirrored copy it already
 * keeps instead of treating the absence of a database as a failure.
 */
export async function requestSetting(
  command: SettingCommand,
  args: Record<string, unknown>,
): Promise<ApiResponse<Setting | null>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  return invoke<ApiResponse<Setting | null>>(command, args);
}
