/**
 * A modal window: the overlay, the frame, and the header and footer rows, with the behaviour every
 * dialog needs.
 *
 * What is inside is the caller's; what is around it is not. Escape and a click outside leave the
 * window the same way everywhere, the page behind stops scrolling, focus moves in on open and back
 * to whatever held it on close, and the leave animation runs before the caller unmounts anything.
 * Size and spacing are the caller's too: the frame carries no layout of its own beyond one column
 * and a scrolling body.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

import styles from "./ModalDialog.module.css";

/** How long the leave animation runs before the window is unmounted. */
const LEAVE_MS = 160;

export interface ModalDialogProps {
  /** Heading the window is named by. */
  title: string;
  /** One line under the heading saying how the window is used. */
  description?: string;
  /** Extra control in the header, between the heading and the actions. */
  toolbar?: ReactNode;
  /** The header's buttons, handed the one way to leave the window. */
  actions: (close: () => void) => ReactNode;
  /** The window's own content. */
  children: ReactNode;
  /** The scrolling body, for a caller that has to scroll it from a pointer handler. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Note under the content, above the save error. */
  note?: ReactNode;
  /** Text pinned to the far side of the footer, such as the shortcuts. */
  trailing?: ReactNode;
  /** Message shown when the last save failed. */
  error?: string | null;
  /** Width of the window: pixels, or any CSS length. Capped by the viewport. */
  width: number | string;
  /** Height of the window: pixels, or any CSS length. Capped by the viewport. */
  height: number | string;
  /** Class for the window itself, for a caller that brings its own spacing. */
  className?: string;
  /** Selector of the element to focus on open; the window itself when omitted. */
  initialFocus?: string;
  /** Runs before the window leaves, e.g. to settle a drag still in flight. */
  beforeClose?: () => void;
  /** Keys the window answers itself; `true` means the press was used. */
  onKeyDown?: (event: KeyboardEvent, close: () => void) => boolean;
  onClose: () => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The elements Tab can reach inside `element`, in document order. */
function focusableIn(element: HTMLElement | null): HTMLElement[] {
  if (element === null) {
    return [];
  }

  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  return [...element.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null,
  );
}

export function ModalDialog({
  actions,
  beforeClose,
  bodyRef,
  children,
  className,
  description,
  error,
  height,
  initialFocus,
  note,
  onClose,
  onKeyDown,
  title,
  toolbar,
  trailing,
  width,
}: ModalDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  /** Whether the window is already on its way out, so a second Escape changes nothing. */
  const leaving = useRef(false);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => {
    if (leaving.current) {
      return;
    }

    leaving.current = true;
    beforeClose?.();

    if (prefersReducedMotion()) {
      onClose();
      return;
    }

    setClosing(true);
    leaveTimer.current = window.setTimeout(onClose, LEAVE_MS);
  }, [beforeClose, onClose]);

  // The page behind must not scroll, and must not be reached by the pointer or by Tab, while the
  // window owns the screen; focus comes back to whatever opened it.
  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    const app = document.getElementById("root");
    const target = initialFocus === undefined ? null : element?.querySelector<HTMLElement>(initialFocus);

    (target ?? element)?.focus();
    document.body.style.overflow = "hidden";
    app?.setAttribute("inert", "");

    return () => {
      window.clearTimeout(leaveTimer.current);
      document.body.style.overflow = overflow;
      app?.removeAttribute("inert");

      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [initialFocus]);

  // Escape belongs to the window; a menu opened inside it dismisses first, which is why it listens
  // in the capture phase and stops the press there.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "Tab" && keepFocusInside(event)) {
        return;
      }

      onKeyDown?.(event, close);
    };

    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [close, onKeyDown]);

  /** Wraps Tab around the window, which `inert` alone does not do: it only frees the page behind. */
  function keepFocusInside(event: KeyboardEvent): boolean {
    const entries = focusableIn(dialog.current);

    if (entries.length === 0) {
      event.preventDefault();
      dialog.current?.focus();
      return true;
    }

    const first = entries[0];
    const last = entries[entries.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && entries.includes(active);

    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last?.focus();
      return true;
    }

    if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first?.focus();
      return true;
    }

    return false;
  }

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(event) => {
        // The window fills the middle of the overlay, so a click that lands on the overlay itself is
        // a click outside it.
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={className === undefined ? styles.dialog : `${styles.dialog} ${className}`}
        data-closing={closing}
        ref={dialog}
        role="dialog"
        style={{ height, width }}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.lead}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          {toolbar === undefined ? null : <div className={styles.toolbar}>{toolbar}</div>}
          <div className={styles.actions}>{actions(close)}</div>
        </header>
        <div className={styles.body} ref={bodyRef}>
          {children}
        </div>
        <footer className={styles.foot}>
          <div className={styles.notes}>
            {note}
            {error === null || error === undefined ? null : (
              <p className={styles["dialog-error"]} role="alert">
                {error}
              </p>
            )}
          </div>
          {trailing === undefined ? null : <span className={styles.trailing}>{trailing}</span>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
