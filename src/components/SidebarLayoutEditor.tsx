/** A modal pointer and keyboard editor with animated reordering. */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../hooks/useI18n";
import { useSidebarLayoutStore } from "../stores/sidebarLayoutStore";
import { SIDEBAR_PANELS } from "../types/sidebar";
import type { SidebarPanelId } from "../types/sidebar";
import { NavIcon } from "./ui/NavIcon";

interface Gesture {
  id: SidebarPanelId;
  pointerId: number;
  startY: number;
  originTop: number;
  currentY: number;
}

export function SidebarLayoutEditor({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { layout, persistenceError, setVisible, reorder, reset } = useSidebarLayoutStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useRef(new Map<SidebarPanelId, HTMLLIElement>());
  const positions = useRef(new Map<SidebarPanelId, number>());
  const gesture = useRef<Gesture | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [dragged, setDragged] = useState<SidebarPanelId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [closing, setClosing] = useState(false);

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

  function close(): void {
    if (closing) return;
    finishDrag();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 160);
  }

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(closeTimer.current);
      element?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  function announceMove(id: SidebarPanelId, target: SidebarPanelId): void {
    reorder(id, target);
    const updated = useSidebarLayoutStore.getState().layout;
    setAnnouncement(t("sidebar.reordered", {
      panel: t(SIDEBAR_PANELS[id].label),
      position: updated.findIndex((panel) => panel.id === id) + 1, total: updated.length,
    }));
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
    const ordered = useSidebarLayoutStore.getState().layout;
    const target = ordered.reduce((nearest, panel) => {
      const row = rows.current.get(panel.id);
      const current = rows.current.get(nearest.id);
      if (!row || !current) return nearest;
      return Math.abs(row.offsetTop + row.offsetHeight / 2 - center) <
        Math.abs(current.offsetTop + current.offsetHeight / 2 - center) ? panel : nearest;
    }, ordered[0] ?? { id: active.id, visible: true });
    if (target.id !== active.id) announceMove(active.id, target.id);
    const bounds = dialog.current?.getBoundingClientRect();
    if (bounds && event.clientY > bounds.bottom - 64) dialog.current?.scrollBy(0, 12);
    if (bounds && event.clientY < bounds.top + 64) dialog.current?.scrollBy(0, -12);
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
  }, [layout]);

  return createPortal(<dialog aria-labelledby="sidebar-editor-title" aria-describedby="sidebar-editor-hint"
    className="sidebar-editor" data-closing={closing} ref={dialog}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) close();
    }}>
    <header className="sidebar-editor-header">
      <h2 id="sidebar-editor-title">{t("sidebar.edit")}</h2>
      <p className="settings-hint" id="sidebar-editor-hint">{t("sidebar.editorHint")}</p>
    </header>
    <p className="sr-only" id="sidebar-keyboard-hint">{t("sidebar.keyboardHint")}</p>
    <ol aria-label={t("sidebar.title")} className="sidebar-editor-list">
      {layout.map(({ id, visible }, index) => {
        const label = t(SIDEBAR_PANELS[id].label);
        return <li className="sidebar-editor-row" data-dragging={dragged === id} data-visible={visible} key={id}
          ref={(element) => { if (element) rows.current.set(id, element); else rows.current.delete(id); }}>
          <button type="button" className="sidebar-drag-handle" aria-label={t("sidebar.drag", { panel: label })}
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
                event.key === "Home" ? 0 : event.key === "End" ? layout.length - 1 : null;
              if (targetIndex === null) return;
              event.preventDefault();
              const target = layout[targetIndex];
              if (target && target.id !== id) announceMove(id, target.id);
            }}>
            <svg aria-hidden="true" viewBox="0 0 16 20">
              {[5, 10, 15].flatMap((cy) => [5, 11].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" />))}
            </svg>
          </button>
          <span className="sidebar-editor-panel"><NavIcon name={id} /><span>{label}</span></span>
          <input role="switch" className="toggle" type="checkbox" checked={visible}
            aria-label={t("sidebar.show", { panel: label })}
            onChange={(event) => setVisible(id, event.currentTarget.checked)} />
        </li>;
      })}
    </ol>
    <p aria-live="polite" className="sr-only">{announcement}</p>
    <footer className="sidebar-editor-footer">
      <p className="settings-hint">{t("sidebar.settingsAlwaysVisible")}</p>
      {persistenceError ? <p className="todo-error" role="alert">{t("sidebar.saveError")}</p> : null}
      <div className="sidebar-editor-buttons">
        <button className="btn btn-quiet" onClick={reset} type="button">{t("sidebar.reset")}</button>
        <button className="btn" onClick={close} type="button">{t("sidebar.done")}</button>
      </div>
    </footer>
  </dialog>, document.body);
}
