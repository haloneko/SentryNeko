/**
 * Whether this start found a database to run on.
 *
 * A copy that failed changes nothing, so the answer is read once, before the first paint: either
 * the application comes up, or it comes up on the rollback the backend has nothing to offer but.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";

import { isOk } from "../types";
import type { ApiResponse } from "../types";
import type { Stranded } from "../types/migration";

/** Asks the backend what it found when it opened the database. */
export async function loadStranded(): Promise<Stranded | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const response = await invoke<ApiResponse<Stranded | null>>("get_stranded");

    return isOk(response) ? response.data : null;
  } catch {
    return null;
  }
}
