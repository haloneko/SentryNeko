/** Dashboard layout hook: the saved grid plus the action that replaces it. */

import { useDashboardLayoutStore } from "../stores/dashboardLayoutStore";
import type { DashboardLayout } from "../types/dashboard";

export interface UseDashboardLayoutResult {
  layout: DashboardLayout;
  /** Whether the last write reached the backend; the grid still applies when it did not. */
  persistenceError: boolean;
  save: (layout: DashboardLayout) => Promise<void>;
}

/** Layout and saving for a component. */
export function useDashboardLayout(): UseDashboardLayoutResult {
  const layout = useDashboardLayoutStore((state) => state.layout);
  const persistenceError = useDashboardLayoutStore((state) => state.persistenceError);
  const save = useDashboardLayoutStore((state) => state.save);

  return { layout, persistenceError, save };
}
