/** Heatmap hook: focus time and completed tasks per bucket over the last year. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import { heatmapWindow } from "../types/heatmap";
import { BACKEND_EVENTS, useTauriEvent } from "./useTauriEvent";

export interface HeatmapState {
  /** Buckets oldest first, empty ones included; empty while loading or after a failure. */
  buckets: readonly HeatmapBucket[];
  loading: boolean;
  /** Code of the failed call, `null` while everything is fine. */
  error: ApiCode | null;
}

/** Loads the window again whenever the granularity changes. */
export function useHeatmap(granularity: HeatmapGranularity): HeatmapState {
  const [revision, setRevision] = useState(0);
  useTauriEvent<null>(BACKEND_EVENTS.todosChanged, () => setRevision((value) => value + 1));
  const [state, setState] = useState<HeatmapState>({ buckets: [], error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    const bounds = heatmapWindow();

    setState((current) => ({ ...current, error: null, loading: true }));

    if (!isTauri()) {
      setState({ buckets: [], error: "UNSUPPORTED", loading: false });
      return;
    }

    void invoke<ApiResponse<HeatmapBucket[]>>("heatmap", { ...bounds, granularity })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setState(
          isOk(response)
            ? { buckets: response.data, error: null, loading: false }
            : { buckets: [], error: response.code, loading: false },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({ buckets: [], error: "INTERNAL", loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [granularity, revision]);

  return state;
}
