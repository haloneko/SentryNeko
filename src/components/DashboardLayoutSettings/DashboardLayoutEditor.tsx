/** Layout editor: the real dashboard panels, dragged into shape and saved as a whole. */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { useDashboardLayout } from "../../hooks/useDashboardLayout";
import { useI18n } from "../../hooks/useI18n";
import { DASHBOARD_PANELS } from "../../pages/Dashboard/panels";
import { addWidgetItems, removeWidgetItem } from "../../pages/Dashboard/widgetMenu";
import {
  DASHBOARD_COLUMNS,
  DASHBOARD_WIDGETS,
  clampPlacement,
  hiddenWidgets,
  minSizeOf,
  visibleWidgets,
  wantedPlacement,
} from "../../types/dashboard";
import type { DashboardWidgetId, WidgetPlacement } from "../../types/dashboard";
import { ActionIcon } from "../ui/ActionIcon";
import { ContextMenu } from "../ui/ContextMenu";
import type { ContextMenuItem } from "../ui/ContextMenu";
import { SegmentedControl } from "../ui/SegmentedControl";
import { WidgetIcon } from "../ui/WidgetIcon";
import { useCanvasScale } from "./useCanvasScale";
import { useDraftLayout } from "./useDraftLayout";
import dashboardStyles from "../../pages/Dashboard/dashboard.module.css";
import dashboardLayoutEditorStyles from "../../pages/Dashboard/DashboardLayoutEditor.module.css";
import todosStyles from "../../pages/Todos/todos.module.css";

interface DashboardLayoutEditorProps {
  onClose: () => void;
}

interface DragState {
  id: DashboardWidgetId;
  mode: "move" | "resize" | "add";
  pointerId: number;
  /** Pointer position when the gesture started. */
  clientX: number;
  clientY: number;
  /** The panel's rectangle when the gesture started, so every frame measures from the same origin. */
  origin: WidgetPlacement;
  /** Where the ghost sits right now, in pixels relative to the grid. */
  ghostX: number;
  ghostY: number;
}

/** Where the right-click menu was opened, and what it was opened on. */
interface WidgetMenu {
  /** Pointer position in viewport pixels, which is what the menu is anchored to. */
  at: { x: number; y: number };
  /** The panel under the pointer, or `null` when the canvas itself was clicked. */
  id: DashboardWidgetId | null;
  /** Cell the canvas was clicked on: where a panel picked from the menu lands. */
  cell: { x: number; y: number };
}

/**
 * A panel never changes while a drag runs, so keeping it out of the re-render loop leaves the
 * pointer frames cheap even with six live panels on screen.
 */
const EditorPanel = memo(function EditorPanel({ id }: { id: DashboardWidgetId }) {
  const Panel = DASHBOARD_PANELS[id];

  return <Panel />;
});

/** Push-away timing: quick off the mark, soft landing. */
const SHIFT_MS = 240;
const SHIFT_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Box of one panel inside the grid, in pixels. */
interface CellRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

function samePlacement(a: WidgetPlacement, b: WidgetPlacement): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Panel box derived from its cells rather than measured from the DOM.
 *
 * Measuring would read boxes mid-animation, which is exactly when they are wrong; the cells are
 * already enough to know where a panel starts and ends.
 */
function rectOf(placement: WidgetPlacement, cell: number, gap: number): CellRect {
  return {
    height: placement.h * cell + (placement.h - 1) * gap,
    left: placement.x * (cell + gap),
    top: placement.y * (cell + gap),
    width: placement.w * cell + (placement.w - 1) * gap,
  };
}

/** Full-window editor; the grid is the dashboard itself, one pointer drop away from the layout. */
export function DashboardLayoutEditor({ onClose }: DashboardLayoutEditorProps) {
  const { t } = useI18n();
  const { layout: saved, persistenceError, save } = useDashboardLayout();
  const draft = useDraftLayout(saved);
  const { layout } = draft;

  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** Latest draft for the pointer handlers, which fire between renders. */
  const layoutRef = useRef(layout);
  /** Cell the panel would land on; rendered as a dashed placeholder, never applied mid-drag. */
  const [preview, setPreview] = useState<WidgetPlacement | null>(null);
  const previewRef = useRef<WidgetPlacement | null>(null);
  /** The dashed placeholder itself, moved straight from the pointer handler. */
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  // The canvas is laid out at a fixed size and scaled to the room it has, so every measurement
  // here is in canvas pixels: the scale is what turns them into pixels on screen.
  const { frameRef, gridRef, metrics } = useCanvasScale(layout.columns);
  const [dragging, setDragging] = useState<DashboardWidgetId | null>(null);
  const [menu, setMenu] = useState<WidgetMenu | null>(null);
  /** One node per panel, for the push-away animation and the pointer-follow transform. */
  const slotRefs = useRef<Partial<Record<DashboardWidgetId, HTMLDivElement | null>>>({});
  /** Panel boxes at the last render, so the next render knows where they came from. */
  const rectsRef = useRef<Record<DashboardWidgetId, CellRect> | null>(null);

  layoutRef.current = layout;

  /*
   * Push-away: a panel that had to move or resize slides from where it was to where it is now, the
   * way icons make room on a phone home screen. It runs on the drop and nowhere else, because the
   * layout itself only changes on the drop — while a drag is live every panel stays put and only
   * the ghost moves.
   */
  useLayoutEffect(() => {
    const { cell, gap } = metrics;

    if (cell <= 0) {
      return;
    }

    const next = {} as Record<DashboardWidgetId, CellRect>;

    for (const id of DASHBOARD_WIDGETS) {
      next[id] = rectOf(layout.placements[id], cell, gap);
    }

    const previous = rectsRef.current;

    rectsRef.current = next;

    if (previous === null || prefersReducedMotion()) {
      return;
    }

    for (const id of DASHBOARD_WIDGETS) {
      const slot = slotRefs.current[id];

      if (slot === null || slot === undefined) {
        continue;
      }

      const from = previous[id];
      const to = next[id];
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const sx = to.width === 0 ? 1 : from.width / to.width;
      const sy = to.height === 0 ? 1 : from.height / to.height;

      if (
        Math.abs(dx) < 0.5 &&
        Math.abs(dy) < 0.5 &&
        Math.abs(sx - 1) < 0.005 &&
        Math.abs(sy - 1) < 0.005
      ) {
        continue;
      }

      slot.getAnimations().forEach((animation) => {
        animation.cancel();
      });
      slot.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transform: "none" },
        ],
        { duration: SHIFT_MS, easing: SHIFT_EASE },
      );
    }
  }, [layout, metrics]);

  const commit = useCallback(() => {
    void save(layoutRef.current);
    onClose();
  }, [onClose, save]);

  // Ctrl+S saves, Ctrl+Z undoes one step, Escape leaves the draft untouched.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        commit();
        return;
      }

      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        draft.undo();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [commit, draft.undo, onClose]);

  // The page behind must not scroll while the editor owns the window.
  useEffect(() => {
    const previous = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /** One cell of travel in canvas pixels, which is the space the ghost and its rectangle live in. */
  const cellStep = metrics.cell + metrics.gap;
  /** The same cell on screen, which is the space the pointer moves in. */
  const step = cellStep * metrics.scale;

  /** Shows where the panel would land, without touching the layout. */
  const showPreview = (placement: WidgetPlacement): void => {
    if (previewRef.current !== null && samePlacement(previewRef.current, placement)) {
      return;
    }

    previewRef.current = placement;
    setPreview(placement);
  };

  /** The ghost is dragged by hand: writing the transform keeps React out of the pointer frames. */
  const placeGhost = (x: number, y: number): void => {
    const ghost = ghostRef.current;

    if (ghost === null) {
      return;
    }

    ghost.style.transform = `translate(${x}px, ${y}px)`;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const state = dragRef.current;

    if (!state || event.pointerId !== state.pointerId || step <= 0) {
      return;
    }

    const deltaX = event.clientX - state.clientX;
    const deltaY = event.clientY - state.clientY;
    const dx = Math.round(deltaX / step);
    const dy = Math.round(deltaY / step);
    const min = minSizeOf(state.id);

    if (state.mode === "add") {
      const grid = gridRef.current;

      if (grid !== null) {
        const scale = metrics.scale || 1;
        const rect = grid.getBoundingClientRect();
        const ghost = rectOf(state.origin, metrics.cell, metrics.gap);

        // The pointer moves on screen and the ghost lives in canvas pixels, so the scale comes off
        // before the two are compared. The panel is centred on the pointer, then pinned inside the
        // canvas so it cannot glide off it.
        const x = Math.max(
          0,
          Math.min(grid.offsetWidth - ghost.width, (event.clientX - rect.left) / scale - ghost.width / 2),
        );
        const y = Math.max(
          0,
          Math.min(grid.offsetHeight - ghost.height, (event.clientY - rect.top) / scale - ghost.height / 2),
        );
        const target = clampPlacement(
          state.id,
          { ...state.origin, x: Math.round(x / cellStep), y: Math.round(y / cellStep) },
          layoutRef.current.columns,
        );

        state.ghostX = x;
        state.ghostY = y;
        placeGhost(x, y);
        showPreview(target);
      }

      return;
    }

    if (state.mode === "move") {
      const target = clampPlacement(
        state.id,
        { ...state.origin, x: state.origin.x + dx, y: state.origin.y + dy },
        layoutRef.current.columns,
      );

      /*
       * The ghost glides with the pointer and hangs off the cell it is over by at most half a cell,
       * so it never runs away when the placement is pinned at the edge of the grid.
       */
      const scale = metrics.scale || 1;
      const slack = cellStep / 2;
      const offX = Math.max(
        -slack,
        Math.min(slack, deltaX / scale - (target.x - state.origin.x) * cellStep),
      );
      const offY = Math.max(
        -slack,
        Math.min(slack, deltaY / scale - (target.y - state.origin.y) * cellStep),
      );

      state.ghostX = target.x * cellStep + offX;
      state.ghostY = target.y * cellStep + offY;
      placeGhost(state.ghostX, state.ghostY);

      showPreview(target);
      return;
    }

    const size = {
      h: Math.max(min.h, state.origin.h + dy),
      w: Math.min(
        layoutRef.current.columns - state.origin.x,
        Math.max(min.w, state.origin.w + dx),
      ),
    };

    showPreview({ ...state.origin, h: size.h, w: size.w });
  };

  /**
   * Starts a drag from the library: the ghost only appears once the pointer has moved far enough
   * to leave the card, so a plain click still lands as a one-click add to the first gap.
   */
  const beginLibraryDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: DashboardWidgetId): void => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      ghostX: 0,
      ghostY: 0,
      id,
      mode: "add",
      origin: wantedPlacement(id, layoutRef.current.columns),
      pointerId: event.pointerId,
    };
    // The preview is created by the first pointer move, not by the press.
    previewRef.current = null;
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    id: DashboardWidgetId,
    mode: DragState["mode"],
  ): void => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const origin = layoutRef.current.placements[id];

    dragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      ghostX: origin.x * cellStep,
      ghostY: origin.y * cellStep,
      id,
      mode,
      origin,
      pointerId: event.pointerId,
    };
    // The ghost only exists once there is a preview, so it starts as the panel's own rectangle.
    previewRef.current = null;
    showPreview(origin);
    setDragging(id);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const state = dragRef.current;

    if (state === null) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const target = previewRef.current;

    dragRef.current = null;
    previewRef.current = null;
    setDragging(null);
    setPreview(null);

    if (target === null) {
      // A press without travel: the click that follows handles a library card, the ghost just
      // disappears for a panel.
      return;
    }

    if (state.mode === "add") {
      const grid = gridRef.current;
      const rect = grid?.getBoundingClientRect();

      // Dropped back on the library or outside the canvas counts as a cancel, so a wayward card
      // never parks a panel where the pointer was not.
      if (rect !== undefined && rect !== null) {
        const inside =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;

        if (inside) {
          draft.add(state.id, target);
        }
      }

      return;
    }

    const current = layoutRef.current.placements[state.id];

    // Dropped on the cell it already had: the ghost just disappears, nothing moved.
    if (samePlacement(current, target)) {
      return;
    }

    // The drop is the only moment the layout changes, so every panel moves once, together.
    if (state.mode === "move") {
      draft.move(state.id, target);
      return;
    }

    draft.resize(state.id, { h: target.h, w: target.w });
  };

  /** Arrow keys nudge a panel; holding shift resizes it instead. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>, id: DashboardWidgetId): void => {
    const placement = layout.placements[id];
    const min = minSizeOf(id);
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";

    if (!horizontal && !vertical) {
      return;
    }

    event.preventDefault();

    const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;

    if (event.shiftKey) {
      const size = { h: placement.h, w: placement.w };

      if (horizontal) {
        size.w = Math.min(layout.columns - placement.x, Math.max(min.w, placement.w + sign));
      } else {
        size.h = Math.max(min.h, placement.h + sign);
      }

      draft.resize(id, size);
      return;
    }

    draft.move(
      id,
      clampPlacement(
        id,
        {
          ...placement,
          x: horizontal ? placement.x + sign : placement.x,
          y: vertical ? placement.y + sign : placement.y,
        },
        layout.columns,
      ),
    );
  };

  const visible = visibleWidgets(layout);
  const parked = hiddenWidgets(layout);

  /**
   * The cell a click on the canvas landed on.
   *
   * The pointer moves in screen pixels while the grid is laid out in canvas pixels, so the scale
   * comes off first; a click past the last column is pulled back onto the grid when the panel is
   * added, because `clampPlacement` trims the rectangle it is given.
   */
  const cellAt = (event: ReactMouseEvent<HTMLElement>): { x: number; y: number } => {
    const grid = gridRef.current;

    if (grid === null || step <= 0) {
      return { x: 0, y: 0 };
    }

    const rect = grid.getBoundingClientRect();

    return {
      x: Math.floor((event.clientX - rect.left) / step),
      y: Math.floor((event.clientY - rect.top) / step),
    };
  };

  /** Right-click on a panel: the menu offers to take that panel off the grid. */
  const openPanelMenu = (event: ReactMouseEvent<HTMLElement>, id: DashboardWidgetId): void => {
    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, cell: { x: 0, y: 0 }, id });
  };

  /** Right-click on the canvas itself: the menu offers the parked panels, at the cell clicked. */
  const openCanvasMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    // Panels cover the canvas, so a right-click anywhere else belongs to a panel's own menu.
    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, cell: cellAt(event), id: null });
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
          draft.remove(id);
        }),
      ];
    }

    const { cell } = menu;

    return addWidgetItems(parked, layout.columns, t, (id) => {
      draft.add(
        id,
        clampPlacement(id, { ...wantedPlacement(id, layout.columns), ...cell }, layout.columns),
      );
    });
  };
  const ghost = preview === null ? null : rectOf(preview, metrics.cell, metrics.gap);
  const ghostLabel = dragRef.current?.id ?? null;

  // The ghost mounts with the drag, so its resting place has to be written after the first render.
  useLayoutEffect(() => {
    const state = dragRef.current;
    const element = ghostRef.current;

    if (state === null || element === null) {
      return;
    }

    element.style.transform = `translate(${state.ghostX}px, ${state.ghostY}px)`;
  }, [preview]);

  return createPortal(
    <div className={dashboardLayoutEditorStyles.editorOverlay}>
      <div
        aria-label={t("dashboard.layout.title")}
        aria-modal="true"
        className={dashboardLayoutEditorStyles.editorDialog}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={dashboardLayoutEditorStyles.editorHead}>
          <div className={dashboardLayoutEditorStyles.editorLead}>
            <h2>{t("dashboard.layout.title")}</h2>
            <p className={dashboardLayoutEditorStyles.editorSub}>{t("dashboard.layout.rowHint")}</p>
          </div>
          <div className={dashboardLayoutEditorStyles.editorColumns}>
            <span className={dashboardLayoutEditorStyles.layoutLabel}>{t("dashboard.layout.columns")}</span>
            <SegmentedControl
              label={t("dashboard.layout.columns")}
              onChange={(next) => {
                draft.setColumns(Number(next));
              }}
              options={DASHBOARD_COLUMNS.map((value) => ({
                label: String(value),
                value: String(value),
              }))}
              value={String(layout.columns)}
            />
          </div>
          <div className={dashboardLayoutEditorStyles.editorActions}>
            <button
              aria-label={t("dashboard.layout.undo")}
              className="icon-btn"
              disabled={!draft.canUndo}
              onClick={draft.undo}
              title={t("dashboard.layout.undo")}
              type="button"
            >
              <ActionIcon name="undo" />
            </button>
            <button
              aria-label={t("dashboard.layout.reset")}
              className="icon-btn"
              onClick={draft.reset}
              title={t("dashboard.layout.reset")}
              type="button"
            >
              <ActionIcon name="reset" />
            </button>
            <button
              aria-label={t("dashboard.layout.cancel")}
              className="icon-btn"
              onClick={onClose}
              title={t("dashboard.layout.cancel")}
              type="button"
            >
              <ActionIcon name="cancel" />
            </button>
            <button
              aria-label={t("dashboard.layout.save")}
              className="icon-btn"
              data-variant="primary"
              disabled={!draft.dirty}
              onClick={commit}
              title={t("dashboard.layout.save")}
              type="button"
            >
              <ActionIcon name="check" />
            </button>
          </div>
        </header>

        <div className={dashboardLayoutEditorStyles.editorBody}>
          <div className={dashboardLayoutEditorStyles.editorCanvas}>
            {visible.length === 0 ? (
              <div className={dashboardLayoutEditorStyles.editorEmpty}>{t("dashboard.layout.empty")}</div>
            ) : null}
            <div
              className={dashboardStyles.dashCanvas}
              ref={frameRef}
              style={{ height: metrics.height * metrics.scale }}
            >
              <div
                className={dashboardStyles.dashCanvasStage}
                style={{ "--canvas-scale": metrics.scale } as CSSProperties}
              >
              <div
                aria-label={t("dashboard.layout.canvas")}
                className={dashboardStyles.dashCells}
                onContextMenu={openCanvasMenu}
                ref={gridRef}
                style={{ "--dash-columns": layout.columns } as CSSProperties}
              >
                {ghost === null ? null : (
                  <span
                    aria-hidden="true"
                    className={dashboardLayoutEditorStyles.editorGhost}
                    ref={ghostRef}
                    style={{ height: ghost.height, width: ghost.width }}
                  >
                    {ghostLabel === null ? null : (
                      <span className={dashboardLayoutEditorStyles.editorGhostLabel}>{t(`dashboard.widget.${ghostLabel}`)}</span>
                    )}
                  </span>
                )}
                {visible.map((id) => {
                  const placement = layout.placements[id];

                  return (
                    <div
                      className={`${dashboardStyles.dashSlot} ${dashboardLayoutEditorStyles.editorSlot}`}
                      data-dragging={dragging === id}
                      key={id}
                      onContextMenu={(event) => {
                        openPanelMenu(event, id);
                      }}
                      ref={(element) => {
                        slotRefs.current[id] = element;
                      }}
                      style={{
                        gridColumn: `${placement.x + 1} / span ${placement.w}`,
                        gridRow: `${placement.y + 1} / span ${placement.h}`,
                      }}
                    >
                      <EditorPanel id={id} />
                      <span
                        aria-label={t("dashboard.widget.move", {
                          name: t(`dashboard.widget.${id}`),
                        })}
                        className={dashboardLayoutEditorStyles.editorMask}
                        onKeyDown={(event) => {
                          handleKeyDown(event, id);
                        }}
                        onPointerCancel={endDrag}
                        onPointerDown={(event) => {
                          beginDrag(event, id, "move");
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={endDrag}
                        role="button"
                        tabIndex={0}
                      />
                      <button
                        aria-label={t("dashboard.layout.remove", {
                          name: t(`dashboard.widget.${id}`),
                        })}
                        className={dashboardLayoutEditorStyles.editorRemove}
                        onClick={(event) => {
                          event.stopPropagation();
                          draft.remove(id);
                        }}
                        title={t("dashboard.layout.remove", {
                          name: t(`dashboard.widget.${id}`),
                        })}
                        type="button"
                      >
                        <ActionIcon name="remove" />
                      </button>
                      <span
                        aria-hidden="true"
                        className={dashboardLayoutEditorStyles.editorGrip}
                        onPointerCancel={endDrag}
                        onPointerDown={(event) => {
                          beginDrag(event, id, "resize");
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={endDrag}
                      />
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          </div>
          <aside className={dashboardLayoutEditorStyles.editorLibrary} aria-label={t("dashboard.layout.library")}>
            <header className={dashboardLayoutEditorStyles.editorLibraryHead}>
              <h3>{t("dashboard.layout.library")}</h3>
              <span className={dashboardLayoutEditorStyles.editorLibraryCount} aria-hidden="true">
                {visible.length}/{visible.length + parked.length}
              </span>
            </header>
            {parked.length === 0 ? (
              <p className={dashboardLayoutEditorStyles.editorLibraryEmpty}>{t("dashboard.layout.libraryAll")}</p>
            ) : (
              <div className={dashboardLayoutEditorStyles.editorLibraryList}>
                {parked.map((id) => (
                  <button
                    aria-label={t("dashboard.layout.add", {
                      name: t(`dashboard.widget.${id}`),
                    })}
                    className={dashboardLayoutEditorStyles.libraryCard}
                    key={id}
                    onClick={() => {
                      draft.add(id);
                    }}
                    onPointerCancel={endDrag}
                    onPointerDown={(event) => {
                      beginLibraryDrag(event, id);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    title={t("dashboard.layout.add", {
                      name: t(`dashboard.widget.${id}`),
                    })}
                    type="button"
                  >
                    <span className={dashboardLayoutEditorStyles.libraryGlyph} aria-hidden="true">
                      <WidgetIcon id={id} />
                    </span>
                    <span className={dashboardLayoutEditorStyles.libraryMeta}>
                      <span className={dashboardLayoutEditorStyles.libraryName}>{t(`dashboard.widget.${id}`)}</span>
                      <span className={dashboardLayoutEditorStyles.librarySize}>
                        {t("dashboard.widget.size", {
                          h: wantedPlacement(id, layout.columns).h,
                          w: wantedPlacement(id, layout.columns).w,
                        })}
                      </span>
                    </span>
                    <span className={dashboardLayoutEditorStyles.libraryPlus} aria-hidden="true">
                      <ActionIcon name="plus" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className={dashboardLayoutEditorStyles.editorLibraryNote}>{t("dashboard.layout.libraryEmpty")}</p>
          </aside>
        </div>

        <footer className={dashboardLayoutEditorStyles.editorFoot}>
          <span className="editor-note">{t("dashboard.layout.hint")}</span>
          {persistenceError ? (
            <p className={todosStyles.todoError} role="alert">{t("dashboard.layout.saveError")}</p>
          ) : null}
          <span className={dashboardLayoutEditorStyles.editorShortcuts}>{t("dashboard.layout.shortcuts")}</span>
        </footer>
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
    </div>,
    document.body,
  );
}
