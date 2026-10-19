/** Dashboard preferences: the `dashboard.grid` row of the backend settings table. */
import { create } from "zustand";

import { defaultLayout, normalizeLayout } from "../types/dashboard";
import type { DashboardLayout } from "../types/dashboard";
import { parseSetting, SETTINGS } from "../types/setting";
import { requestSetting } from "./settingRow";

/** The row this store owns; the backend stores it as sent. */
const { category, key: DASHBOARD_GRID_KEY } = SETTINGS.dashboardGrid;

/** Copy kept for the first paint, so the grid never renders in the wrong arrangement. */
export const DASHBOARD_LAYOUT_STORAGE_KEY = "sentryneko.dashboardLayout";

interface DashboardLayoutState {
  layout: DashboardLayout;
  persistenceError: boolean;
  /**
   * Stores the layout the editor settled on.
   *
   * The editor keeps its own draft, so the page only ever renders a layout the user saved.
   */
  save: (layout: DashboardLayout) => Promise<void>;
}

/** The mirrored copy, or the built-in grid when there is nothing readable to mirror. */
function readCachedLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);

    if (raw === null) {
      return defaultLayout();
    }

    const parsed: unknown = JSON.parse(raw);

    // Layouts saved before the library existed are missing the parked list; normalization adds it.
    return normalizeLayout(parsed) ?? defaultLayout();
  } catch {
    // Storage disabled or holding junk: fall back to the default grid.
    return defaultLayout();
  }
}

/** Mirrors the row, answering whether the browser let us keep it. */
function writeCachedLayout(layout: DashboardLayout): boolean {
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export const useDashboardLayoutStore = create<DashboardLayoutState>((set) => ({
  layout: readCachedLayout(),
  persistenceError: false,

  save: async (layout) => {
    const cached = writeCachedLayout(layout);
    set({ layout, persistenceError: !cached });

    const response = await requestSetting("set_setting", {
      key: DASHBOARD_GRID_KEY,
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
export async function loadDashboardLayout(): Promise<void> {
  const response = await requestSetting("get_setting", { key: DASHBOARD_GRID_KEY });

  // `UNSUPPORTED` is the browser preview, and an absent row means the grid was never customised.
  if (response.code !== "OK") {
    return;
  }

  const stored = parseSetting<DashboardLayout | null>(response.data, null);

  if (stored === null) {
    return;
  }

  const layout = normalizeLayout(stored);

  if (layout === null) {
    return;
  }

  writeCachedLayout(layout);
  useDashboardLayoutStore.setState({ layout });
}
