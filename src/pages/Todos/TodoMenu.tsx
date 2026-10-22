/**
 * A small card hung under the control that opened it: the status and tag filters, the order of the
 * list. It is a popover, not a modal — placed against its trigger, with an invisible mask behind
 * that only catches the click which means "never mind".
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

import todosStyles from "./todos.module.css";

/** Bubble geometry, in viewport pixels: window edge, gap under the trigger, caret inset. */
const EDGE = 8;
const GAP = 8;
const CARET_INSET = 16;

/** Where the card sits, in viewport pixels, and which way its caret points. */
interface Placement {
  caret: number;
  left: number;
  side: "bottom" | "top";
  top: number;
}

export interface TodoMenuProps {
  /** The control the card is hung from. */
  anchor: HTMLElement | null;
  /** Heading, and the name a screen reader announces for the card. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Draws the card for as long as it is mounted; the caller owns whether it is. */
export function TodoMenu({ anchor, label, onClose, children }: TodoMenuProps) {
  const card = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const labelId = useId();

  // Whatever had focus gets it back when the card closes, so a keyboard user is not left at the top
  // of the page after dismissing one.
  useLayoutEffect(() => {
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
      restoreTo.current?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const element = card.current;

    if (element === null || anchor === null) {
      return;
    }

    const place = (): void => {
      const box = element.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const below = target.bottom + GAP;
      const above = target.top - GAP - box.height;
      const roomBelow = window.innerHeight - EDGE - below;
      // Downward first: the card is opened from a toolbar above the list, and the list can scroll.
      const side: Placement["side"] =
        roomBelow >= box.height || above < EDGE ? "bottom" : "top";
      const left = Math.max(EDGE, Math.min(target.left, window.innerWidth - box.width - EDGE));
      const top = side === "bottom" ? below : above;

      setPlacement({
        // The caret follows the middle of the trigger, even when the card is pulled back inside.
        caret: Math.max(
          CARET_INSET,
          Math.min(target.left + target.width / 2 - left, box.width - CARET_INSET),
        ),
        left,
        side,
        top: Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE)),
      });
    };

    place();
    window.addEventListener("resize", place);
    // A page that scrolls under the card is a page the card no longer points at.
    document.addEventListener("scroll", place, true);

    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  const placed = placement !== null;

  // Only once placed: a hidden element cannot take focus, and the chosen option should get it.
  useEffect(() => {
    if (!placed) {
      return;
    }

    const chosen = card.current?.querySelector<HTMLElement>('[aria-pressed="true"]');

    (chosen ?? card.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [placed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      // Escape belongs to the card while it is open, not to the page behind it.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* Invisible: it only catches the click that means "never mind". */}
      <div aria-hidden="true" className={todosStyles.todoMenuMask} onClick={onClose} />
      <div
        aria-labelledby={labelId}
        className={todosStyles.todoMenu}
        data-placement={placement?.side}
        ref={card}
        role="dialog"
        style={
          placement === null
            ? { left: 0, top: 0, visibility: "hidden" }
            : ({
                "--caret": `${placement.caret}px`,
                left: placement.left,
                top: placement.top,
              } as CSSProperties)
        }
      >
        <p className={todosStyles.todoMenuLabel} id={labelId}>
          {label}
        </p>
        {children}
      </div>
    </>,
    document.body,
  );
}
