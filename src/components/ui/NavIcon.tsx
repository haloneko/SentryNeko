/**
 * Line drawings for the sidebar entries. Each icon has to stay readable on its own, because the
 * collapsed sidebar shows nothing but the icon; size, colour and stroke come from `.nav-icon`.
 */

import type { ReactNode } from "react";

/** Every drawing the sidebar can ask for; the keys mirror the `icon` field of each page. */
export type NavIconName =
  | "analytics"
  | "assistance"
  | "alarms"
  | "dashboard"
  | "events"
  | "heatmap"
  | "pomodoro"
  | "settings"
  | "todos";

/** Exported so a dashboard panel that means the same thing can reuse the drawing verbatim. */
export const NAV_DRAWINGS: Record<NavIconName, ReactNode> = {
  assistance: (
    <>
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" />
      <path d="M20 2v4M18 4h4" />
    </>
  ),
  // Four tiles: the landing page that summarises everything else.
  dashboard: (
    <>
      <rect height="7" rx="2" width="7" x="3" y="3" />
      <rect height="7" rx="2" width="7" x="14" y="3" />
      <rect height="7" rx="2" width="7" x="3" y="14" />
      <rect height="7" rx="2" width="7" x="14" y="14" />
    </>
  ),
  // A card with a tick: a task that can be completed.
  todos: (
    <>
      <rect height="17" rx="4" width="18" x="3" y="3.5" />
      <path d="M8 12l2.6 2.6L16 8.7" />
    </>
  ),
  // A stopwatch, knob and hand included: the countdown.
  pomodoro: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.8v3.7l2.5 1.4" />
      <path d="M9.4 2.6h5.2" />
    </>
  ),
  // A calendar dotted like a year of cells: the heatmap.
  heatmap: (
    <>
      <rect height="16" rx="4" width="18" x="3" y="4.5" />
      <path d="M3 9.6h18M8 2.6v3.4M16 2.6v3.4" />
      <path d="M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 16.8h.01M12 16.8h.01" />
    </>
  ),
  // A bell: the page that schedules reminders.
  alarms: (
    <>
      <path d="M6.2 10a5.8 5.8 0 0 1 11.6 0c0 3.6 1.2 5 1.2 5H5s1.2-1.4 1.2-5Z" />
      <path d="M9.8 18.4a2.3 2.3 0 0 0 4.4 0" />
    </>
  ),
  // Timestamped rows: the live foreground-app stream.
  events: (
    <>
      <path d="M4.6 7h.01M4.6 12h.01M4.6 17h.01" />
      <path d="M8.8 7h11M8.8 12h11M8.8 17h6.4" />
    </>
  ),
  // Three columns: the aggregated numbers.
  analytics: (
    <>
      <rect height="8" rx="1.5" width="4" x="4" y="12" />
      <rect height="15.5" rx="1.5" width="4" x="10" y="4.5" />
      <rect height="11" rx="1.5" width="4" x="16" y="9" />
    </>
  ),
  // Sliders: preferences rather than data.
  settings: (
    <>
      <path d="M4 8h7.9M16.1 8H20M4 16h3.9M12.1 16H20" />
      <circle cx="14" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </>
  ),
};

/** Draws one sidebar icon at the size and stroke the stylesheet picks for the current mode. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
      {NAV_DRAWINGS[name]}
    </svg>
  );
}
