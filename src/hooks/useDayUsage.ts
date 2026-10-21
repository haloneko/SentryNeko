/** Hourly usage hook: the app stacks and the focus buckets of one local day. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { FocusHour, HourlyUsage } from "../types/hourly";
import { dayWindow } from "../types/hourly";

export interface DayUsageState {
  /** One row per app and hour; empty while loading or after a failure. */
  usage: readonly HourlyUsage[];
  /** One row per hour that has focus time. */
  focus: readonly FocusHour[];
  loading: boolean;
  /** Code of the failed call, `null` while everything is fine. */
  error: ApiCode | null;
}

/**
 * Loads both hourly series of `day`.
 *
 * Both are asked at once so switching the chart kind never waits for the backend again; the window
 * is the local calendar day, computed here because a day is a calendar concept.
 */
export function useDayUsage(day: Date): DayUsageState {
  const [state, setState] = useState<DayUsageState>({
    error: null,
    focus: [],
    loading: true,
    usage: [],
  });

  useEffect(() => {
    let cancelled = false;
    const bounds = dayWindow(day);

    setState((current) => ({ ...current, error: null, loading: true }));

    if (!isTauri()) {
      setState({ error: "UNSUPPORTED", focus: [], loading: false, usage: [] });
      return;
    }

    void Promise.all([
      invoke<ApiResponse<HourlyUsage[]>>("app_usage_hours", bounds),
      invoke<ApiResponse<FocusHour[]>>("focus_hours", bounds),
    ])
      .then(([usage, focus]) => {
        if (cancelled) {
          return;
        }

        if (!isOk(usage) || !isOk(focus)) {
          setState({
            error: isOk(usage) ? focus.code : usage.code,
            focus: [],
            loading: false,
            usage: [],
          });
          return;
        }

        setState({ error: null, focus: focus.data, loading: false, usage: usage.data });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ error: "INTERNAL", focus: [], loading: false, usage: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [day]);

  return state;
}
