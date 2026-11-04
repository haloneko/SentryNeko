/**
 * A panel that hangs off the control that opened it.
 *
 * Placed against the trigger and mounted on `body`, so a row that clips its overflow cannot cut it
 * in half, and a list that scrolls carries the trigger away without taking the panel along. It is
 * a popover, not a modal: the click that lands outside is the click that means "never mind", and
 * Escape closes it — unless something inside has already claimed the key.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../hooks/useI18n";
import popoverStyles from "./Popover.module.css";

/** Panel geometry, in viewport pixels: the least air left at a window edge, and the gap to the trigger. */
const EDGE = 12;
const GAP = 10;

/** Where the panel sits, in viewport pixels, and which side of the trigger it hangs from. */
interface Placement {
  left: number;
  side: "bottom" | "top";
  top: number;
}

export interface PopoverProps {
  /** The control the panel is placed against. */
  anchor: HTMLElement | null;
  /** The panel's own content, between the heading and the footer. */
  children: ReactNode;
  /** Small label above the title, naming what is being edited. */
  eyebrow?: string;
  /** Actions at the foot of the panel, laid out from its start. */
  footer?: ReactNode;
  /** Closes the panel; the caller owns whether it is open. */
  onClose: () => void;
  /** The line under the eyebrow: the state being edited, or the fact that there is none yet. */
  title: ReactNode;
  /** How wide the panel may draw, in pixels; a picker inside it may need more room than usual. */
  width?: number;
}

export function Popover({
  anchor,
  children,
  eyebrow,
  footer,
  onClose,
  title,
  width = 340,
}: PopoverProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const titleId = useId();
  /** Set by the ways out that were asked for, so an outside click keeps the focus where it landed. */
  const wantedOut = useRef(false);

  useLayoutEffect(() => {
    const element = panel.current;

    if (element === null || anchor === null) {
      return;
    }

    const place = (): void => {
      const box = element.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const below = target.bottom + GAP;
      const roomBelow = window.innerHeight - EDGE - below;
      const roomAbove = target.top - GAP - EDGE;
      // Below first: the control it hangs from is usually the last thing above the fold.
      const side: Placement["side"] =
        roomBelow >= box.height || roomBelow >= roomAbove ? "bottom" : "top";
      // The panel's right edge follows the trigger's, which is where the eye already is.
      const left = Math.max(
        EDGE,
        Math.min(target.right - box.width, window.innerWidth - box.width - EDGE),
      );
      const top = side === "bottom" ? below : target.top - GAP - box.height;

      setPlacement({
        left,
        side,
        top: Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE)),
      });
    };

    place();
    window.addEventListener("resize", place);
    // A page that scrolls under the panel is a page the panel no longer points at.
    document.addEventListener("scroll", place, true);
    // The panel's content can grow after it was placed — a panel that steps into a calendar — so
    // its size is watched rather than assumed.
    const watcher = new ResizeObserver(place);
    watcher.observe(element);

    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      watcher.disconnect();
    };
  }, [anchor]);

  /** Only once placed: a hidden element cannot take focus. */
  const placed = placement !== null;

  // The panel takes the focus itself, so Tab walks through it rather than past it into the rows
  // behind: a dialog is where the keyboard is, whatever the pointer did.
  useEffect(() => {
    if (placed) {
      panel.current?.focus({ preventScroll: true });
    }
  }, [placed]);

  // The trigger that opened the panel is where the eye goes back to — but only when the panel was
  // dismissed on purpose: a click that landed elsewhere has already chosen its own focus.
  useEffect(() => {
    return () => {
      if (wantedOut.current) {
        anchor?.focus();
      }
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A picker inside the panel closes itself first; the key was already spent there.
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      wantedOut.current = true;
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* Invisible: it is there to catch the click that means "never mind". */}
      <div aria-hidden="true" className={popoverStyles.popoverMask} onClick={() => onClose()} />
      <div
        aria-labelledby={titleId}
        className={popoverStyles.popover}
        data-side={placement?.side}
        ref={panel}
        role="dialog"
        tabIndex={-1}
        style={
          {
            "--popover-width": `${width}px`,
            left: placement?.left ?? 0,
            top: placement?.top ?? 0,
            visibility: placement === null ? "hidden" : undefined,
          } as CSSProperties
        }
      >
        <div className={popoverStyles.popoverHead}>
          <div className={popoverStyles.popoverHeading}>
            {eyebrow === undefined ? null : (
              <span className={popoverStyles.popoverEyebrow}>{eyebrow}</span>
            )}
            <h2 className={popoverStyles.popoverTitle} id={titleId}>
              {title}
            </h2>
          </div>
          <button
            aria-label={t("popover.close")}
            className={popoverStyles.popoverClose}
            onClick={() => {
              wantedOut.current = true;
              onClose();
            }}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        </div>
        <div className={popoverStyles.popoverBody}>{children}</div>
        {footer === undefined ? null : <div className={popoverStyles.popoverFoot}>{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
