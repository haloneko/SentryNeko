/** Sidebar preferences are window chrome, persisted alongside the collapsed flag. */
import { create } from "zustand";

import { defaultSidebarLayout, normalizeSidebarLayout, reorderSidebarLayout } from "../types/sidebar";
import type { SidebarLayout, SidebarPanelId } from "../types/sidebar";

export const SIDEBAR_LAYOUT_STORAGE_KEY = "sentryneko.sidebarLayout";

interface SidebarLayoutState {
  layout: SidebarLayout;
  persistenceError: boolean;
  setVisible: (id: SidebarPanelId, visible: boolean) => void;
  move: (id: SidebarPanelId, direction: -1 | 1) => void;
  reset: () => void;
  reorder: (id: SidebarPanelId, target: SidebarPanelId) => void;
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

export const useSidebarLayoutStore = create<SidebarLayoutState>((set, get) => {
  function save(layout: SidebarLayout): void {
    let persistenceError = false;

    try {
      localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      persistenceError = true;
    }

    set({ layout, persistenceError });
  }

  return {
    layout: readLayout(),
    persistenceError: false,
    setVisible: (id, visible) => {
      save(get().layout.map((panel) => (panel.id === id ? { ...panel, visible } : panel)));
    },
    move: (id, direction) => {
      const layout = [...get().layout];
      const index = layout.findIndex((panel) => panel.id === id);
      const target = index + direction;
      const panel = layout[index];
      const neighbor = layout[target];

      if (!panel || !neighbor) {
        return;
      }

      layout[index] = neighbor;
      layout[target] = panel;
      save(layout);
    },
    reset: () => save(defaultSidebarLayout()),
    reorder: (id, target) => save(reorderSidebarLayout(get().layout, id, target)),
  };
});
