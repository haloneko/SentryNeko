/**
 * Line drawings for the dashboard panels, so the layout editor can show what a parked panel is
 * without spelling the name out. Size, colour and stroke come from `.widget-icon`.
 */

import type { ReactNode } from "react";

import type { DashboardWidgetId } from "../../types/dashboard";
import { NAV_DRAWINGS } from "./NavIcon";
import dashboardStyles from "../../pages/Dashboard/dashboard.module.css";

const DRAWINGS: Record<DashboardWidgetId, ReactNode> = {
  // Crosshairs: the block that reports where the day's attention went.
  focus: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4" />
    </>
  ),
  // Rows getting shorter: the apps ranked by the time they took.
  usage: (
    <>
      <path d="M4.4 5.8h15.2M4.4 12h8.6M4.4 18.2h11.4" />
    </>
  ),
  // A ring closing on a tick: how much of the day's list is done.
  completion: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.4 12.3 11 14.9l4.8-5.4" />
    </>
  ),
  // Borrowed from the sidebar, so one idea never ends up with two drawings.
  pomodoro: NAV_DRAWINGS.pomodoro,
  todos: NAV_DRAWINGS.todos,
  alarm: NAV_DRAWINGS.alarms,
};

/** Draws the icon of one dashboard panel at the size the stylesheet picks for it. */
export function WidgetIcon({ id }: { id: DashboardWidgetId }) {
  return (
    <svg aria-hidden="true" className={dashboardStyles.widgetIcon} viewBox="0 0 24 24">
      {DRAWINGS[id]}
    </svg>
  );
}
