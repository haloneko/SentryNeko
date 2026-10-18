/** Completion rate hook: how many tasks of one scope are done. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { isOk } from "../types";
import type { ApiCode, ApiResponse } from "../types";
import type { CompletionScope, TaskCompletion } from "../types/todo";
import { BACKEND_EVENTS, useTauriEvent } from "./useTauriEvent";

export interface CompletionRateState {
  /** Both counts are zero until the call answers. */
  completion: TaskCompletion;
  loading: boolean;
  /** Code of the failed call, `null` while everything is fine. */
  error: ApiCode | null;
}

/** Loads the rate of `scope` again whenever the scope changes. */
export function useCompletionRate(scope: CompletionScope): CompletionRateState {
  const [revision, setRevision] = useState(0);
  useTauriEvent<null>(BACKEND_EVENTS.todosChanged, () => setRevision((value) => value + 1));
  const [state, setState] = useState<CompletionRateState>({
    completion: { completed: 0, total: 0 },
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    setState((current) => ({ ...current, error: null, loading: true }));

    if (!isTauri()) {
      setState({
        completion: { completed: 0, total: 0 },
        error: "UNSUPPORTED",
        loading: false,
      });
      return;
    }

    void invoke<ApiResponse<TaskCompletion>>("completion_rate", { scope })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setState(
          isOk(response)
            ? { completion: response.data, error: null, loading: false }
            : { completion: { completed: 0, total: 0 }, error: response.code, loading: false },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            completion: { completed: 0, total: 0 },
            error: "INTERNAL",
            loading: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scope, revision]);

  return state;
}
