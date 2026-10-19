/** Dashboard: the arranged grid of panels, each loading its own data. */

import { useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import { ContextMenu } from "../../components/ui/ContextMenu";
import type { ContextMenuItem } from "../../components/ui/ContextMenu";
import { useDashboardLayout } from "../../hooks/useDashboardLayout";
import { useI18n } from "../../hooks/useI18n";
import { hideWidget, hiddenWidgets, showWidget, visibleWidgets } from "../../types/dashboard";
import type { DashboardWidgetId } from "../../types/dashboard";
import { DASHBOARD_PANELS } from "./panels";
import { addWidgetItems, removeWidgetItem } from "./widgetMenu";

/** Where the right-click menu was opened, and what it was opened on. */
interface WidgetMenu {
  /** Pointer position in viewport pixels, which is what the menu is anchored to. */
  at: { x: number; y: number };
  /** The panel under the pointer, or `null` when the grid itself was clicked. */
  id: DashboardWidgetId | null;
}

/**
 * Renders the dashboard in the grid the user arranged in the layout editor.
 *
 * Panels can also be taken off the grid and put back from a right-click, which saves as it goes:
 * arranging is the editor's job, this is for the one panel that got in the way.
 *
 * Cells are as wide as the page allows, so the panels are the real thing at their real size: the
 * page grows with the window rather than being scaled to it, and nothing here shrinks the text.
 */
export function Dashboard() {
  const { t } = useI18n();
  const { layout, save } = useDashboardLayout();
  const [menu, setMenu] = useState<WidgetMenu | null>(null);

  const visible = visibleWidgets(layout);

  /** Right-click on a panel: the menu offers to take that panel off the dashboard. */
  const openPanelMenu = (event: ReactMouseEvent<HTMLElement>, id: DashboardWidgetId): void => {
    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, id });
  };

  /** Right-click on the grid itself: the menu offers the panels that are not on it. */
  const openGridMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    // Panels cover the grid, so a right-click anywhere else belongs to a panel's own menu.
    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, id: null });
  };

  /** What the menu offers, wherever it was opened. */
  const menuItems = (): ContextMenuItem[] => {
    if (menu === null) {
      return [];
    }

    if (menu.id !== null) {
      const { id } = menu;

      return [
        removeWidgetItem(id, t, () => {
          void save(hideWidget(layout, id));
        }),
      ];
    }

    return addWidgetItems(hiddenWidgets(layout), layout.columns, t, (id) => {
      void save(showWidget(layout, id));
    });
  };

  return (
    <>
      <h1>{t("nav.dashboard")}</h1>
      <div className="dash-grid">
        <div
          className="dash-cells"
          onContextMenu={openGridMenu}
          style={{ "--dash-columns": layout.columns } as CSSProperties}
        >
          {visible.length === 0 ? (
            <div
              className="dash-empty"
              onContextMenu={openGridMenu}
              style={{ gridColumn: "1 / -1", gridRow: "span 2" }}
            >
              {t("dashboard.layout.emptyPage")}
            </div>
          ) : null}
          {visible.map((id) => {
            const placement = layout.placements[id];
            const Panel = DASHBOARD_PANELS[id];

            return (
              <div
                className="dash-slot"
                key={id}
                onContextMenu={(event) => {
                  openPanelMenu(event, id);
                }}
                style={{
                  gridColumn: `${placement.x + 1} / span ${placement.w}`,
                  gridRow: `${placement.y + 1} / span ${placement.h}`,
                }}
              >
                <Panel />
              </div>
            );
          })}
        </div>
      </div>
      {menu === null ? null : (
        <ContextMenu
          at={menu.at}
          items={menuItems()}
          label={menu.id === null ? t("dashboard.layout.menuAdd") : t(`dashboard.widget.${menu.id}`)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}
