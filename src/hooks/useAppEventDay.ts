/** Event stream hook: one local day of foreground events, loaded whole. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { AppEvent, AppEventPage } from "../types/appEvent";
import { nextDayStart } from "../pages/Events/events";

/**
 * Rows the timeline asks one day for.
 *
 * A day holds a few thousand switches at most in normal use; the cap only exists so a pathological
 * day cannot hand the page more than it can draw, and the page says when it was hit.
 */
export const DAY_LIMIT = 20_000;

export interface AppEventDayState {
  /** Newest first. */
  events: readonly AppEvent[];
  /** True when the day held more rows than [`DAY_LIMIT`] and was cut at the newest ones. */
  truncated: boolean;
  /** True only while the day is on its way. */
  loading: boolean;
  /** Code of the failed call, `null` while everything is fine. */
  error: ApiCode | null;
}

/** State after a load that answered no rows. */
function failed(error: ApiCode): AppEventDayState {
  return { error, events: [], loading: false, truncated: false };
}

/** Loads the whole day that starts at `day`; every change of day is one query. */
export function useAppEventDay(day: number): AppEventDayState {
  const [state, setState] = useState<AppEventDayState>({
    error: null,
    events: [],
    loading: true,
    truncated: false,
  });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // The previous day leaves at once: showing its rows under a new date would be a lie.
    setState({ error: null, events: [], loading: true, truncated: false });

    if (!isTauri()) {
      setState(failed("UNSUPPORTED"));
      return;
    }

    void invoke<ApiResponse<AppEventPage>>("list_app_events_between", {
      from: day,
      limit: DAY_LIMIT,
      to: nextDayStart(day),
    })
      .then((response) => {
        if (!alive.current) {
          return;
        }

        if (!isOk(response)) {
          setState(failed(response.code));
          return;
        }

        setState({
          error: null,
          events: response.data.events,
          loading: false,
          truncated: response.data.more,
        });
      })
      .catch(() => {
        if (alive.current) {
          setState(failed("INTERNAL"));
        }
      });

    return () => {
      alive.current = false;
    };
  }, [day]);

  return state;
}
