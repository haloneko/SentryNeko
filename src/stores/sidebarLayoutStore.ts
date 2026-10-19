/** Sidebar preferences: the `sidebar.panels` row of the backend settings table. */
import { create } from "zustand";

import { parseSetting, SETTINGS } from "../types/setting";
import { defaultSidebarLayout, normalizeSidebarLayout } from "../types/sidebar";
import type { SidebarLayout } from "../types/sidebar";
import { requestSetting } from "./settingRow";

/** The row this store owns; the backend stores it as sent. */
const { category, key: SIDEBAR_PANELS_KEY } = SETTINGS.sidebarPanels;

/** Copy kept for the first paint, so the rail never renders in the wrong order. */
export const SIDEBAR_LAYOUT_STORAGE_KEY = "sentryneko.sidebarLayout";

interface SidebarLayoutState {
  layout: SidebarLayout;
  persistenceError: boolean;
  /**
   * Commits the arrangement an editor settled on.
   *
   * The editor holds a draft of its own, so the rail never moves while panels are being dragged
   * or switched; this is the only write path.
   */
  save: (layout: SidebarLayout) => Promise<void>;
}

function readCachedLayout(): SidebarLayout {
  try {
    const raw = localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);

    return normalizeSidebarLayout(parsed);
  } catch {
    return defaultSidebarLayout();
  }
}

/** Mirrors the row, answering whether the browser let us keep it. */
function writeCachedLayout(layout: SidebarLayout): boolean {
  try {
    localStorage.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export const useSidebarLayoutStore = create<SidebarLayoutState>((set) => ({
  layout: readCachedLayout(),
  persistenceError: false,

  save: async (layout) => {
    const cached = writeCachedLayout(layout);
    set({ layout, persistenceError: !cached });

    const response = await requestSetting("set_setting", {
      key: SIDEBAR_PANELS_KEY,
      value: JSON.stringify(layout),
      category,
    });

    // `UNSUPPORTED` is the browser preview, where the mirror is the only store there is.
    if (response.code !== "OK" && response.code !== "UNSUPPORTED") {
      set({ persistenceError: true });
    }
  },
}));

/** Reads the row before the first paint; the cached copy answers until it arrives. */
export async function loadSidebarLayout(): Promise<void> {
  const response = await requestSetting("get_setting", { key: SIDEBAR_PANELS_KEY });

  // `UNSUPPORTED` is the browser preview, and an absent row means the rail was never customised.
  if (response.code !== "OK") {
    return;
  }

  const stored = parseSetting<SidebarLayout | null>(response.data, null);

  if (stored === null) {
    return;
  }

  const layout = normalizeSidebarLayout(stored);
  writeCachedLayout(layout);
  useSidebarLayoutStore.setState({ layout });
}
