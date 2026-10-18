/** Segmented switch whose highlight slides to the chosen option. */

import { useLayoutEffect, useRef, useState } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  /** Already translated copy. */
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  disabled?: boolean;
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Renders the options in one track and keeps the highlight under the active one. */
export function SegmentedControl<T extends string>({
  disabled = false,
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Stays null until the first measurement, so the highlight is never painted at a default
  // position and animated into place on mount.
  const [highlight, setHighlight] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  /**
   * Measured from the boxes, so padding and border of the track cannot offset the highlight.
   *
   * The numbers come from `offset*` rather than from `getBoundingClientRect`, because the page is
   * scaled up on a wide window: a rect is measured in scaled pixels, and a scaled offset handed to
   * an element inside the scaled page is scaled a second time, which would push the highlight out of
   * the track by as much as the page is enlarged. `offset*` stays in the page's own pixels, and is
   * already measured from the padding box — the space an absolutely placed child is positioned in —
   * so the track's border needs no correcting.
   */
  useLayoutEffect(() => {
    const track = trackRef.current;
    const active = track?.querySelector<HTMLElement>('[aria-pressed="true"]');

    if (!track || !active) {
      return;
    }

    const measure = (): void => {
      const next = {
        height: active.offsetHeight,
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
      };

      setHighlight((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
    };

    measure();
    // Family and size can change outside this component, including after a font finishes loading.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    observer.observe(active);

    return () => observer.disconnect();
  });

  return (
    <div aria-label={label} className="segmented" ref={trackRef} role="group">
      {highlight ? (
        <span
          aria-hidden="true"
          className="segmented-indicator"
          style={{
            height: highlight.height,
            transform: `translate(${highlight.left}px, ${highlight.top}px)`,
            width: highlight.width,
          }}
        />
      ) : null}
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className="segmented-option"
          disabled={disabled}
          key={option.value}
          onClick={() => {
            onChange(option.value);
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
