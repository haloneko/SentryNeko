/**
 * Line drawings for icon-only buttons. The button carries the label through `title` and
 * `aria-label`, so the drawing only has to be recognisable, not self-explanatory.
 */

import type { ReactNode } from "react";

export type ActionIconName =
  | "cancel"
  | "check"
  | "delete"
  | "edit"
  | "grip"
  | "plus"
  | "remove"
  | "reset"
  | "undo";

const DRAWINGS: Record<ActionIconName, ReactNode> = {
  // Two columns of dots: the row itself is what moves, and the dots are filled rather than stroked.
  grip: [5.9, 12, 18.1].flatMap((cy) => [8.6, 15.4].map((cx) => (
    <circle cx={cx} cy={cy} fill="currentColor" key={`${cx}-${cy}`} r="1.9" stroke="none" />
  ))),
  // Pencil over a corner: the button opens an editor.
  edit: (
    <>
      <path d="M4 20h4L19.5 8.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </>
  ),
  // Arrow curving back on itself: step the last change back.
  undo: (
    <>
      <path d="M4 9h10a5 5 0 0 1 0 10h-5" />
      <path d="M8 5 4 9l4 4" />
    </>
  ),
  // Circular arrow: start the arrangement over.
  reset: (
    <>
      <path d="M20 12a8 8 0 1 1-2.7-6" />
      <path d="M20 3.5V9h-5.5" />
    </>
  ),
  // Bin with a lid: the task is about to be thrown away.
  delete: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.4 6.5l.7 12.6a1.6 1.6 0 0 0 1.6 1.4h6.6a1.6 1.6 0 0 0 1.6-1.4l.7-12.6" />
      <path d="M10.2 10.5v6M13.8 10.5v6" />
    </>
  ),
  // Cross: leave without keeping the draft.
  cancel: <path d="M6 6l12 12M18 6 6 18" />,
  // Tick: keep it.
  check: <path d="M5 12.5 10 17.5 19 7" />,
  // Plus: drop a parked panel back onto the grid.
  plus: <path d="M12 5v14M5 12h14" />,
  // Minus in a circle: take a panel off the grid.
  remove: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h8" />
    </>
  ),
};

/** Draws one action icon; size, colour and stroke come from `.action-icon`. */
export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg aria-hidden="true" className="action-icon" viewBox="0 0 24 24">
      {DRAWINGS[name]}
    </svg>
  );
}
