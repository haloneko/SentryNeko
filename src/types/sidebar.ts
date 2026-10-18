/** Available sidebar panels, in the default navigation order. Settings stays reachable separately. */
export const SIDEBAR_PANELS = {
  dashboard: { path: "/", label: "nav.dashboard" },
  todos: { path: "/todos", label: "nav.todos" },
  pomodoro: { path: "/pomodoro", label: "nav.pomodoro" },
  heatmap: { path: "/heatmap", label: "nav.heatmap" },
  alarms: { path: "/alarms", label: "nav.alarms" },
  events: { path: "/events", label: "nav.events" },
  analytics: { path: "/analytics", label: "nav.analytics" },
  assistance: { path: "/assistance", label: "nav.assistance" },
} as const;

export type SidebarPanelId = keyof typeof SIDEBAR_PANELS;

export const SIDEBAR_PANEL_IDS = Object.keys(SIDEBAR_PANELS) as SidebarPanelId[];

export interface SidebarPanel {
  id: SidebarPanelId;
  visible: boolean;
}

export type SidebarLayout = SidebarPanel[];

/** Move a panel to another panel's position while preserving all visibility choices. */
export function reorderSidebarLayout(layout: SidebarLayout, id: SidebarPanelId, target: SidebarPanelId): SidebarLayout {
  const from = layout.findIndex((panel) => panel.id === id);
  const to = layout.findIndex((panel) => panel.id === target);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = [...layout];
  const [panel] = next.splice(from, 1);
  if (!panel) return layout;
  next.splice(to, 0, panel);
  return next;
}

/** First launch shows every panel in the original order. */
export function defaultSidebarLayout(): SidebarLayout {
  return SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true }));
}

/** Discard obsolete/duplicate entries and append panels added since the layout was saved. */
export function normalizeSidebarLayout(value: unknown): SidebarLayout {
  const entries: unknown[] = Array.isArray(value) ? value : [];
  const layout: SidebarLayout = [];
  const seen = new Set<SidebarPanelId>();

  for (const entry of entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !Object.hasOwn(SIDEBAR_PANELS, entry.id)
    ) {
      continue;
    }

    const id = entry.id as SidebarPanelId;

    if (!seen.has(id)) {
      seen.add(id);
      layout.push({
        id,
        visible: "visible" in entry && typeof entry.visible === "boolean" ? entry.visible : true,
      });
    }
  }

  return [...layout, ...defaultSidebarLayout().filter(({ id }) => !seen.has(id))];
}
