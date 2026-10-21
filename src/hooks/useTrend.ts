/** Trend hook: focus time and screen time per bucket over the window a chart shows. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import { trendWindow } from "../types/trend";

export interface TrendState {
  buckets: readonly HeatmapBucket[];
  /** The granularity `buckets` was read with, so a chart labels them correctly while a new window loads. */
  bucketsGranularity: HeatmapGranularity;
  totalFocusSeconds: number;
  totalAppSeconds: number;
  loading: boolean;
  busy: boolean;
  error: ApiCode | null;
}

export function useTrend(granularity: HeatmapGranularity): TrendState {
  const [state, setState] = useState<TrendState>({
    buckets: [],
    bucketsGranularity: granularity,
    busy: false,
    error: null,
    loading: true,
    totalAppSeconds: 0,
    totalFocusSeconds: 0,
  });
  // Whether a first answer ever landed, so an empty window is not mistaken for a pending one.
  const answered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const bounds = trendWindow(granularity);

    setState((current) => ({
      ...current,
      busy: true,
      error: null,
      loading: !answered.current,
    }));

    if (!isTauri()) {
      answered.current = true;
      setState({
        buckets: [],
        bucketsGranularity: granularity,
        busy: false,
        error: "UNSUPPORTED",
        loading: false,
        totalAppSeconds: 0,
        totalFocusSeconds: 0,
      });
      return;
    }

    void invoke<ApiResponse<HeatmapBucket[]>>("heatmap", { ...bounds, granularity })
      .then((response) => {
        if (cancelled) {
          return;
        }

        answered.current = true;

        if (!isOk(response)) {
          setState({
            buckets: [],
            bucketsGranularity: granularity,
            busy: false,
            error: response.code,
            loading: false,
            totalAppSeconds: 0,
            totalFocusSeconds: 0,
          });
          return;
        }

        setState({
          buckets: response.data,
          bucketsGranularity: granularity,
          busy: false,
          error: null,
          loading: false,
          totalAppSeconds: response.data.reduce((total, bucket) => total + bucket.appSeconds, 0),
          totalFocusSeconds: response.data.reduce(
            (total, bucket) => total + bucket.focusSeconds,
            0,
          ),
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        answered.current = true;
        setState({
          buckets: [],
          bucketsGranularity: granularity,
          busy: false,
          error: "INTERNAL",
          loading: false,
          totalAppSeconds: 0,
          totalFocusSeconds: 0,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [granularity]);

  return state;
}
