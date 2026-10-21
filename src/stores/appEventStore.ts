/** Foreground application events pushed by the collector. */

import { create } from "zustand";

import type { AppEvent } from "../types/appEvent";

/** How many pushes the live tail keeps; the paged history reads the database instead. */
export const LIVE_EVENT_LIMIT = 20;

interface AppEventState {
  /** Latest switches, newest first; the head grows while the app in front stays there. */
  live: readonly AppEvent[];
  /** Puts one push at the head, or replaces the row it carries when the id is already known. */
  record: (event: AppEvent) => void;
}

export const useAppEventStore = create<AppEventState>((set) => ({
  live: [],
  record: (event) => {
    set((state) => {
      const index = state.live.findIndex((known) => known.id === event.id);

      // The collector rewrites the stretch in progress: the same id arrives again with a later
      // end, and the line has to be updated where it stands instead of being added twice.
      if (index === -1) {
        return { live: [event, ...state.live].slice(0, LIVE_EVENT_LIMIT) };
      }

      const next = [...state.live];
      next[index] = event;

      return { live: next };
    });
  },
}));
