/**
 * Line drawings for icon-only buttons. The button carries the label through `title` and
 * `aria-label`, so the drawing only has to be recognisable, not self-explanatory.
 */

import type { ReactNode } from "react";

export type ActionIconName =
  | "cancel"
  | "check"
  | "down"
  | "edit"
  | "plus"
  | "remove"
  | "reset"
  | "undo"
  | "up";

const DRAWINGS: Record<ActionIconName, ReactNode> = {
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
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
