/** Hourly usage hook: the app stacks and the focus buckets of one local day. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { FocusCategoryHour, HourlyUsage } from "../types/hourly";
import { dayWindow } from "../types/hourly";

export interface DayUsageState {
  usage: readonly HourlyUsage[];
  /** The day's focus seconds, split by category; the stack and the total both read them. */
  focusCategories: readonly FocusCategoryHour[];
  loading: boolean;
  busy: boolean;
  error: ApiCode | null;
}

export function useDayUsage(day: Date): DayUsageState {
  const [state, setState] = useState<DayUsageState>({
    busy: false,
    error: null,
    focusCategories: [],
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
      setState({
        busy: false,
        error: "UNSUPPORTED",
        focusCategories: [],
        loading: false,
        usage: [],
      });
      return;
    }

    void Promise.all([
      invoke<ApiResponse<HourlyUsage[]>>("app_usage_hours", bounds),
      invoke<ApiResponse<FocusCategoryHour[]>>("focus_category_hours", bounds),
    ])
      .then(([usage, categories]) => {
        if (cancelled) {
          return;
        }

        answered.current = true;

        if (!isOk(usage) || !isOk(categories)) {
          setState({
            busy: false,
            error: isOk(usage) ? categories.code : usage.code,
            focusCategories: [],
            loading: false,
            usage: [],
          });
          return;
        }

        setState({
          busy: false,
          error: null,
          focusCategories: categories.data,
          loading: false,
          usage: usage.data,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        answered.current = true;
        setState({
          busy: false,
          error: "INTERNAL",
          focusCategories: [],
          loading: false,
          usage: [],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [day]);

  return state;
}
