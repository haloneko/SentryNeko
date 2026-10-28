/** A pointer and keyboard editor for the rail's panels, with animated reordering. */

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { useI18n } from "../hooks/useI18n";
import { useSidebarLayoutStore } from "../stores/sidebarLayoutStore";
import { defaultSidebarLayout, reorderSidebarLayout, SIDEBAR_PANELS } from "../types/sidebar";
import type { SidebarLayout, SidebarPanelId } from "../types/sidebar";
import { ActionIcon } from "./ui/ActionIcon";
import { ModalDialog } from "./ui/ModalDialog";
import { NavIcon } from "./ui/NavIcon";
import sidebarLayoutEditorStyles from "./SidebarLayoutEditor.module.css";

interface Gesture {
  id: SidebarPanelId;
  pointerId: number;
  startY: number;
  originTop: number;
  currentY: number;
}

export function SidebarLayoutEditor({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { layout, persistenceError, save } = useSidebarLayoutStore();
  const rows = useRef(new Map<SidebarPanelId, HTMLLIElement>());
  const positions = useRef(new Map<SidebarPanelId, number>());
  const gesture = useRef<Gesture | null>(null);
  /** The scrolling body of the window, which follows a pointer held near its edge. */
  const body = useRef<HTMLDivElement>(null);
  // The draft is what the rows draw; the rail and the saved layout only change when it is applied.
  const [draft, setDraft] = useState<SidebarLayout>(layout);
  const latest = useRef(draft);
  const [dragged, setDragged] = useState<SidebarPanelId | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function edit(next: SidebarLayout): void {
    latest.current = next;
    setDraft(next);
  }

  function finishDrag(): void {
    const active = gesture.current;
    gesture.current = null;
    if (active) {
      const element = rows.current.get(active.id);
      if (element) {
        const from = element.style.transform;
        element.style.removeProperty("transform");
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          element.animate([{ transform: from }, { transform: "none" }], {
            duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          });
        }
      }
    }
    setDragged(null);
  }

  function announceMove(id: SidebarPanelId, target: SidebarPanelId): void {
    const next = reorderSidebarLayout(latest.current, id, target);
    edit(next);
    setAnnouncement(t("sidebar.reordered", {
      panel: t(SIDEBAR_PANELS[id].label),
      position: next.findIndex((panel) => panel.id === id) + 1, total: next.length,
    }));
  }

  function setVisible(id: SidebarPanelId, visible: boolean): void {
    edit(latest.current.map((panel) => (panel.id === id ? { ...panel, visible } : panel)));
  }

  /** Applies the draft, then leaves: the only path that moves the rail. */
  function apply(close: () => void): void {
    void save(latest.current);
    close();
  }

  const pointerMove = useEffectEvent((event: PointerEvent) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    active.currentY = event.clientY;
    const element = rows.current.get(active.id);
    if (!element) return;
    const desiredTop = active.originTop + event.clientY - active.startY;
    element.style.transform = `translateY(${desiredTop - element.offsetTop}px)`;
    const center = desiredTop + element.offsetHeight / 2;
    const ordered = latest.current;
    const target = ordered.reduce((nearest, panel) => {
      const row = rows.current.get(panel.id);
      const current = rows.current.get(nearest.id);
      if (!row || !current) return nearest;
      return Math.abs(row.offsetTop + row.offsetHeight / 2 - center) <
        Math.abs(current.offsetTop + current.offsetHeight / 2 - center) ? panel : nearest;
    }, ordered[0] ?? { id: active.id, visible: true });
    if (target.id !== active.id) announceMove(active.id, target.id);
    const bounds = body.current?.getBoundingClientRect();
    if (bounds && event.clientY > bounds.bottom - 64) body.current?.scrollBy(0, 12);
    if (bounds && event.clientY < bounds.top + 64) body.current?.scrollBy(0, -12);
  });

  const pointerEnd = useEffectEvent((event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) finishDrag();
  });

  useEffect(() => {
    const move = (event: PointerEvent): void => pointerMove(event);
    const end = (event: PointerEvent): void => pointerEnd(event);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  useLayoutEffect(() => {
    const next = new Map<SidebarPanelId, number>();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rows.current.forEach((element, id) => {
      const before = positions.current.get(id);
      const after = element.offsetTop;
      next.set(id, after);
      const active = gesture.current;
      if (active?.id === id) {
        element.style.transform = `translateY(${active.originTop + active.currentY - active.startY - after}px)`;
      } else if (before !== undefined && before !== after && !reduced) {
        element.getAnimations().forEach((animation) => animation.cancel());
        element.animate([{ transform: `translateY(${before - after}px)` }, { transform: "none" }], {
          duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    });
    positions.current = next;
  }, [draft]);

  return (
    <ModalDialog
      actions={(close) => (
        <>
          <button aria-label={t("sidebar.reset")} className="icon-btn" onClick={() => edit(defaultSidebarLayout())}
            title={t("sidebar.reset")} type="button">
            <ActionIcon name="reset" />
          </button>
          <button aria-label={t("sidebar.close")} className="icon-btn" onClick={close}
            title={t("sidebar.close")} type="button">
            <ActionIcon name="cancel" />
          </button>
          <button aria-label={t("sidebar.done")} className="icon-btn" data-variant="primary" onClick={() => apply(close)}
            title={t("sidebar.done")} type="button">
            <ActionIcon name="check" />
          </button>
        </>
      )}
      beforeClose={finishDrag}
      bodyRef={body}
      description={t("sidebar.editorHint")}
      error={persistenceError ? t("sidebar.saveError") : null}
      height={620}
      initialFocus=".sidebar-drag-handle"
      note={<p className="settings-hint">{t("sidebar.settingsAlwaysVisible")}</p>}
      onClose={onClose}
      title={t("sidebar.edit")}
      width={560}
    >
      <p className="sr-only" id="sidebar-keyboard-hint">{t("sidebar.keyboardHint")}</p>
      <ol aria-label={t("sidebar.title")} className={sidebarLayoutEditorStyles.sidebarEditorList}>
        {draft.map(({ id, visible }, index) => {
          const label = t(SIDEBAR_PANELS[id].label);
          return <li className={sidebarLayoutEditorStyles.sidebarEditorRow} data-dragging={dragged === id} data-testid="sidebar-editor-row" data-visible={visible} key={id}
            ref={(element) => { if (element) rows.current.set(id, element); else rows.current.delete(id); }}>
            <button type="button" className={sidebarLayoutEditorStyles.sidebarDragHandle} aria-label={t("sidebar.drag", { panel: label })}
              aria-describedby="sidebar-keyboard-hint" aria-keyshortcuts="ArrowUp ArrowDown Home End"
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary || gesture.current) return;
                event.preventDefault();
                event.currentTarget.focus();
                const element = rows.current.get(id);
                if (!element) return;
                gesture.current = { id, pointerId: event.pointerId, startY: event.clientY,
                  currentY: event.clientY, originTop: element.offsetTop };
                setDragged(id);
              }}
              onKeyDown={(event) => {
                const targetIndex = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 :
                  event.key === "Home" ? 0 : event.key === "End" ? draft.length - 1 : null;
                if (targetIndex === null) return;
                event.preventDefault();
                const target = draft[targetIndex];
                if (target && target.id !== id) announceMove(id, target.id);
              }}>
              <ActionIcon name="grip" />
            </button>
            <span className={sidebarLayoutEditorStyles.sidebarEditorPanel}><NavIcon name={id} /><span>{label}</span></span>
            <input role="switch" className="toggle" type="checkbox" checked={visible}
              aria-label={t("sidebar.show", { panel: label })}
              onChange={(event) => setVisible(id, event.currentTarget.checked)} />
          </li>;
        })}
      </ol>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </ModalDialog>
  );
}
