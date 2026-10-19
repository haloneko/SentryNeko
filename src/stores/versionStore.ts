/**
 * The version the interface reports.
 *
 * The backend owns the number: it is compiled into the binary and answered by `get_version`, so the
 * frontend only displays it.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import packageInfo from "../../package.json";
import { isOk } from "../types";
import type { ApiResponse } from "../types";

/**
 * What a browser preview shows: there is no binary to ask, so the build's own manifest stands in.
 * The real number arrives from `get_version` inside Tauri.
 */
const PREVIEW = packageInfo.version;

export interface VersionState {
  /** The program's version, as the backend reports it. */
  version: string;
  /** Reads it from the backend; never rejects. */
  load: () => Promise<void>;
}

async function readVersion(): Promise<string> {
  if (!isTauri()) {
    return PREVIEW;
  }

  try {
    const response = await invoke<ApiResponse<string>>("get_version");

    return isOk(response) ? response.data : PREVIEW;
  } catch {
    return PREVIEW;
  }
}

export const useVersionStore = create<VersionState>((set) => ({
  // The preview number holds the label in place until the backend answers a moment later.
  version: PREVIEW,
  load: async () => {
    set({ version: await readVersion() });
  },
}));

/** Reads the version before the first paint, so the label never starts out blank. */
export async function loadVersion(): Promise<void> {
  await useVersionStore.getState().load();
}

/** The label a version is shown under, without doubling a `v` the source already carries. */
export function versionLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}
