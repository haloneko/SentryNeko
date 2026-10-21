/** Hourly usage hook: the app stacks and the focus buckets of one local day. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { FocusHour, HourlyUsage } from "../types/hourly";
import { dayWindow } from "../types/hourly";

export interface DayUsageState {
  usage: readonly HourlyUsage[];
  focus: readonly FocusHour[];
  loading: boolean;
  busy: boolean;
  error: ApiCode | null;
}

export function useDayUsage(day: Date): DayUsageState {
  const [state, setState] = useState<DayUsageState>({
    busy: false,
    error: null,
    focus: [],
    loading: true,
    usage: [],
  });
  // Whether a first answer ever landed, so an empty day is not mistaken for a pending one.
  const answered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const bounds = dayWindow(day);

    setState((current) => ({
      ...current,
      busy: true,
      error: null,
      loading: !answered.current,
    }));

    if (!isTauri()) {
      answered.current = true;
      setState({ busy: false, error: "UNSUPPORTED", focus: [], loading: false, usage: [] });
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

        answered.current = true;

        if (!isOk(usage) || !isOk(focus)) {
          setState({
            busy: false,
            error: isOk(usage) ? focus.code : usage.code,
            focus: [],
            loading: false,
            usage: [],
          });
          return;
        }

        setState({ busy: false, error: null, focus: focus.data, loading: false, usage: usage.data });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        answered.current = true;
        setState({ busy: false, error: "INTERNAL", focus: [], loading: false, usage: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [day]);

  return state;
}
