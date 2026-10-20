/**
 * Right-click menu: a short list of actions anchored to the pointer.
 *
 * It is mounted on `body` rather than inside whatever opened it, because the layout editor is a
 * window-sized overlay and the menu has to sit above it; and because it is placed in viewport
 * pixels, which is the frame the pointer itself lives in.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import contextMenuStyles from "./ContextMenu.module.css";

export interface ContextMenuItem {
  label: string;
  /** What the item does; a disabled item is shown but cannot be picked. */
  onSelect: () => void;
  /** Drawing shown before the label. */
  icon?: ReactNode;
  /** Right-aligned hint, such as the cells a panel would take. */
  hint?: string;
  /** Draws the item as the destructive one. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  /** Where the pointer was, in viewport pixels. */
  at: { x: number; y: number };
  items: readonly ContextMenuItem[];
  /** Heading above the items, and the name a screen reader announces for the menu. */
  label?: string;
  onClose: () => void;
}

/** How close to the window edge the menu may come before it is pulled back. */
const EDGE = 8;

export function ContextMenu({ at, items, label, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: at.x, top: at.y });

  // Whatever had focus gets it back when the menu closes, so a keyboard user is not dropped at the
  // top of the page after dismissing one.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
      previous?.focus();
    };
  }, []);

  // The pointer says where the menu wants to be; the window says where it can be.
  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (menu === null) {
      return;
    }

    const box = menu.getBoundingClientRect();

    setPosition({
      left: Math.max(EDGE, Math.min(at.x, window.innerWidth - box.width - EDGE)),
      top: Math.max(EDGE, Math.min(at.y, window.innerHeight - box.height - EDGE)),
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const buttons = (): HTMLButtonElement[] => [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? []),
    ];

    // The first item takes focus, so the menu can be walked with the arrow keys straight away.
    buttons()[0]?.focus();

    const closeOnPointerDown = (event: Event): void => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) {
        onClose();
      }
    };

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        // The dialog behind stays open: the menu is what Escape dismisses first.
        event.stopPropagation();
        onClose();
        return;
      }

      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }

      const entries = buttons();

      if (entries.length === 0) {
        return;
      }

      event.preventDefault();

      const focused = entries.findIndex((button) => button === document.activeElement);
      const step = event.key === "ArrowUp" ? -1 : 1;
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? entries.length - 1
            : (focused + step + entries.length) % entries.length;

      entries[index]?.focus();
    };

    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", handleKey, true);
    // A menu pinned to the pointer is in the wrong place as soon as the page moves under it.
    document.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      aria-label={label}
      className={contextMenuStyles.contextMenu}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {label === undefined ? null : (
        <p aria-hidden="true" className={contextMenuStyles.contextMenuLabel}>
          {label}
        </p>
      )}
      {items.map((item) => (
        <button
          className={contextMenuStyles.contextMenuItem}
          data-danger={item.danger === true ? "" : undefined}
          disabled={item.disabled === true}
          key={item.label}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.icon === undefined ? null : (
            <span aria-hidden="true" className={contextMenuStyles.contextMenuIcon}>
              {item.icon}
            </span>
          )}
          <span className={contextMenuStyles.contextMenuText}>{item.label}</span>
          {item.hint === undefined ? null : <span className={contextMenuStyles.contextMenuHint}>{item.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
