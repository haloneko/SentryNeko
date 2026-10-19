/** Sidebar preferences are window chrome, persisted alongside the collapsed flag. */
import { create } from "zustand";

import { defaultSidebarLayout, normalizeSidebarLayout } from "../types/sidebar";
import type { SidebarLayout } from "../types/sidebar";

export const SIDEBAR_LAYOUT_STORAGE_KEY = "sentryneko.sidebarLayout";

interface SidebarLayoutState {
  layout: SidebarLayout;
  persistenceError: boolean;
  /**
   * Commits the arrangement an editor settled on.
   *
   * The editor holds a draft of its own, so the rail never moves while panels are being dragged
   * or switched; this is the only write path, and therefore the only thing a restart can see.
   */
  save: (layout: SidebarLayout) => void;
}

function readLayout(): SidebarLayout {
  try {
    const raw = localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);

    return normalizeSidebarLayout(parsed);
  } catch {
    return defaultSidebarLayout();
  }
}

export const useSidebarLayoutStore = create<SidebarLayoutState>((set) => ({
  layout: readLayout(),
  persistenceError: false,
  save: (layout) => {
    let persistenceError = false;

    try {
      localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      persistenceError = true;
    }

    set({ layout, persistenceError });
  },
}));
