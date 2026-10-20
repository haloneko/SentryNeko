/**
 * Asks before an action runs: the trigger opens a small bubble, and only its confirm button acts.
 * A popover, not a modal — placed against the trigger with an invisible mask behind it.
 */

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../hooks/useI18n";
import popconfirmStyles from "./Popconfirm.module.css";

/** Bubble geometry, in viewport pixels: window edge, gap under the trigger, caret inset, right overhang. */
const EDGE = 8;
const GAP = 8;
const CARET_INSET = 14;
const OVERHANG = 12;

export interface PopconfirmProps {
  /** The action button; its own click runs first, and can keep the bubble shut. */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  /** Heading; may stand alone without a body. */
  title?: string;
  /** Drawing shown before the heading. */
  icon?: ReactNode;
  /** Body copy under the heading. */
  content?: string;
  /** Confirm label; the localized "Yes" when left out. */
  confirmText?: string;
  /** Cancel label; the localized "No" when left out. */
  cancelText?: string;
  /** Paints the icon and the confirm button as the destructive pair. */
  danger?: boolean;
  /** Runs when the confirm button is pressed, then the bubble closes. */
  onConfirm: () => void;
}

export function Popconfirm({
  children,
  cancelText,
  confirmText,
  content,
  danger = false,
  icon,
  onConfirm,
  title,
}: PopconfirmProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // The element clicked, kept as the anchor the bubble is placed against.
  const anchor = useRef<HTMLElement | null>(null);

  const trigger = cloneElement(children, {
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    onClick: (event) => {
      children.props.onClick?.(event);

      if (!event.defaultPrevented) {
        anchor.current = event.currentTarget;
        setOpen(true);
      }
    },
  });

  return (
    <>
      {trigger}
      {open ? (
        <PopconfirmPanel
          anchor={anchor.current}
          cancelText={cancelText ?? t("popconfirm.no")}
          confirmText={confirmText ?? t("popconfirm.yes")}
          content={content}
          danger={danger}
          icon={icon}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          title={title}
        />
      ) : null}
    </>
  );
}

/** Where the bubble sits, in viewport pixels, and which way its caret points. */
interface Placement {
  caret: number;
  left: number;
  side: "bottom" | "top";
  top: number;
}

interface PopconfirmPanelProps {
  anchor: HTMLElement | null;
  /** Already resolved, so the bubble never has to know where the copy came from. */
  cancelText: string;
  confirmText: string;
  content?: string;
  danger: boolean;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
}

function PopconfirmPanel({
  anchor,
  cancelText,
  confirmText,
  content,
  danger,
  icon,
  onCancel,
  onConfirm,
  title,
}: PopconfirmPanelProps) {
  const { t } = useI18n();
  const bubble = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const titleId = useId();
  const contentId = useId();

  useLayoutEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    return () => {
      restoreTo.current?.focus();
    };
  }, []);

  /** Only once placed: a hidden element cannot take focus, and the way out should get it. */
  const placed = placement !== null;

  useLayoutEffect(() => {
    if (placed) {
      cancelButton.current?.focus();
    }
  }, [placed]);

  useLayoutEffect(() => {
    const element = bubble.current;

    if (element === null || anchor === null) {
      return;
    }

    const place = (): void => {
      const box = element.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const below = target.bottom + GAP;
      const roomAbove = target.top - GAP - EDGE;
      const roomBelow = window.innerHeight - EDGE - below;
      // Upward first: the room below is often the list itself. Drop below only when above is tight.
      const fitsAbove = roomAbove >= box.height;
      const side: Placement["side"] =
        fitsAbove || (roomBelow < box.height && roomAbove >= roomBelow) ? "top" : "bottom";
      // Hung from the nearer window edge, with a small overhang, so the answers never crowd a corner.
      const hugsRight = target.left > window.innerWidth - target.right;
      const wantedLeft = hugsRight
        ? target.right + OVERHANG - box.width
        : target.left;
      const left = Math.max(EDGE, Math.min(wantedLeft, window.innerWidth - box.width - EDGE));
      const top = side === "top" ? target.top - GAP - box.height : below;

      setPlacement({
        // The caret follows the middle of the trigger, even when the bubble is pulled back inside.
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
    // A page that scrolls under the bubble is a page the bubble no longer points at.
    document.addEventListener("scroll", place, true);

    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      // Escape belongs to the bubble while it is open, not to the page behind it.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onCancel]);

  return createPortal(
    <>
      {/* Invisible: it only catches the click that means "never mind". */}
      <div aria-hidden="true" className={popconfirmStyles.popconfirmMask} onClick={onCancel} />
      <div
        aria-describedby={content === undefined ? undefined : contentId}
        aria-label={title === undefined ? t("popconfirm.label") : undefined}
        aria-labelledby={title === undefined ? undefined : titleId}
        className={popconfirmStyles.popconfirm}
        data-danger={danger ? "" : undefined}
        data-placement={placement?.side}
        ref={bubble}
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
        <div className={popconfirmStyles.popconfirmHead}>
          {icon === undefined ? null : (
            <span aria-hidden="true" className={popconfirmStyles.popconfirmIcon} data-testid="popconfirm-icon">
              {icon}
            </span>
          )}
          {title === undefined ? null : (
            <h2 className={popconfirmStyles.popconfirmTitle} id={titleId}>
              {title}
            </h2>
          )}
          <button
            aria-label={t("popconfirm.close")}
            className={popconfirmStyles.popconfirmClose}
            onClick={onCancel}
            type="button"
          >
            ✕
          </button>
        </div>
        {content === undefined ? null : (
          <p className={popconfirmStyles.popconfirmContent} data-testid="popconfirm-content" id={contentId}>
            {content}
          </p>
        )}
        <div className={popconfirmStyles.popconfirmActions}>
          <button className="btn btn-quiet" onClick={onCancel} ref={cancelButton} type="button">
            {cancelText}
          </button>
          <button className={`btn ${popconfirmStyles.popconfirmConfirm}`} onClick={onConfirm} type="button">
            {confirmText}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
