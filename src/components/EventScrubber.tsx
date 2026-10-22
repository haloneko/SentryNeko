/**
 * The horizontal axis over the stream: a whole day, side to side. The wheel zooms around the
 * pointer, a press and drag slides the window along the day, and a click without a drag puts the
 * playhead on the switch under it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import { useI18n } from "../hooks/useI18n";
import { appColor, axisClock, axisTicks, nextDayStart } from "../pages/Events/events";
import type { AppEvent } from "../types/appEvent";
import eventsStyles from "../pages/Events/events.module.css";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The windows a day can be read through, widest first. One day, then halves down to an hour. */
const ZOOM_STEPS = [86_400, 43_200, 21_600, 10_800, 5_400, 3_600];

/** Pixels a press may travel before it counts as a drag rather than a click. */
const DRAG_SLOP = 3;

interface EventScrubberProps {
  /** Local midnight of the day the axis shows. */
  day: number;
  /** Episodes of that day, newest first. */
  events: readonly AppEvent[];
  /** Moves the stream to the event under the playhead. */
  onSeek: (event: AppEvent) => void;
  /** The event the playhead currently sits on; `null` means the newest one. */
  selectedId: number | null;
}

/**
 * Draws the day as one bar.
 *
 * Every loaded event becomes a stretch inside the current window, cut into a few hundred slices
 * first, so a day of tens of thousands of switches still draws a few hundred marks. The window is
 * the only thing that moves: zooming and sliding change what is seen, never which day was loaded.
 */
export function EventScrubber({ day, events, onSeek, selectedId }: EventScrubberProps) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ moved: boolean; start: number; x: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(0);
  const [windowStart, setWindowStart] = useState(day);

  const dayEnd = nextDayStart(day);
  const span = ZOOM_STEPS[step] ?? 86_400;
  const start = clamp(windowStart, day, Math.max(day, dayEnd - span));
  const end = start + span;
  const selected = events.find((event) => event.id === selectedId) ?? events.at(0);

  // Another day starts as a whole day again.
  useEffect(() => {
    setStep(0);
    setWindowStart(day);
  }, [day]);

  /**
   * Narrows or widens the window by one step, keeping the moment under `anchor` where it is: the
   * wheel zooms around the pointer.
   */
  const zoomTo = useCallback(
    (nextStep: number, anchor: number): void => {
      const bounded = clamp(nextStep, 0, ZOOM_STEPS.length - 1);
      const nextSpan = ZOOM_STEPS[bounded] ?? 86_400;
      const anchorTime = start + anchor * span;

      setStep(bounded);
      setWindowStart(clamp(anchorTime - anchor * nextSpan, day, Math.max(day, dayEnd - nextSpan)));
    },
    [day, dayEnd, span, start],
  );

  // A wheel over the axis belongs to the axis, not to the page behind it; `passive: false` is what
  // lets the handler stop the page from scrolling at all.
  useEffect(() => {
    const element = track.current;

    if (element === null) {
      return;
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const box = element.getBoundingClientRect();
      const anchor = box.width === 0 ? 0.5 : clamp((event.clientX - box.left) / box.width, 0, 1);

      zoomTo(step + (event.deltaY < 0 ? 1 : -1), anchor);
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [step, zoomTo]);

  if (events.length === 0) {
    return null;
  }

  const index = selected === undefined ? 0 : events.findIndex((event) => event.id === selected.id);
  const playhead = selected === undefined ? null : (selected.startedAt - start) / span;
  const ticks = axisTicks(events, start, end);

  const ratioAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();

    return box === undefined || box.width === 0 ? 0 : clamp((clientX - box.left) / box.width, 0, 1);
  };

  const seekNearest = (ratio: number): void => {
    const moment = start + ratio * span;
    const nearest = events.reduce((best, event) =>
      Math.abs(event.startedAt - moment) < Math.abs(best.startedAt - moment) ? event : best,
    );

    onSeek(nearest);
  };

  /** Steps one event; the list is newest first, so a step right is a step towards now. */
  const stepEvent = (direction: -1 | 1): void => {
    const next = events[Math.min(events.length - 1, Math.max(0, index + direction))];

    if (next !== undefined) {
      onSeek(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const oldest = events.at(-1);
    const newest = events.at(0);

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      stepEvent(-1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      stepEvent(1);
    } else if (event.key === "Home" && oldest !== undefined) {
      event.preventDefault();
      onSeek(oldest);
    } else if (event.key === "End" && newest !== undefined) {
      event.preventDefault();
      onSeek(newest);
    }
  };

  const beginPress = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { moved: false, start, x: event.clientX };
    setDragging(true);
  };

  const movePress = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;

    if (current === null) {
      return;
    }

    const travelled = event.clientX - current.x;

    if (!current.moved && Math.abs(travelled) <= DRAG_SLOP) {
      return;
    }

    current.moved = true;

    const width = track.current?.getBoundingClientRect().width ?? 0;

    if (width === 0) {
      return;
    }

    // The bar follows the finger: dragging left shows what came later in the day.
    setWindowStart(
      clamp(
        current.start - (travelled / width) * span,
        day,
        Math.max(day, dayEnd - span),
      ),
    );
  };

  const endPress = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;

    drag.current = null;
    setDragging(false);

    // A press that never travelled is a click: put the playhead on the switch that sits there.
    if (current !== null && !current.moved) {
      seekNearest(ratioAt(event.clientX));
    }
  };

  const cancelPress = (): void => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div className={eventsStyles.scrubber}>
      <div
        aria-label={t("events.timeline.scrubber")}
        aria-orientation="horizontal"
        aria-valuemax={events.length - 1}
        aria-valuemin={0}
        aria-valuenow={index}
        aria-valuetext={
          selected === undefined
            ? undefined
            : `${axisClock(selected.startedAt, dayEnd)} · ${selected.appName}`
        }
        className={eventsStyles.track}
        data-dragging={dragging}
        data-testid="event-scrubber"
        onKeyDown={onKeyDown}
        onPointerCancel={cancelPress}
        onPointerDown={beginPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        ref={track}
        role="slider"
        tabIndex={0}
      >
        <span aria-hidden="true" className={eventsStyles.rail} />
        {ticks.map((tick) => (
          <span
            aria-hidden="true"
            className={eventsStyles.tick}
            data-testid="event-tick"
            key={`${tick.appName}-${tick.start}`}
            style={
              {
                "--event-color": appColor(tick.appName).strong,
                left: `${tick.start * 100}%`,
                width: `${Math.max(0.3, (tick.end - tick.start) * 100)}%`,
              } as CSSProperties
            }
          />
        ))}
        {playhead !== null && playhead >= 0 && playhead <= 1 ? (
          <span
            aria-hidden="true"
            className={eventsStyles.playhead}
            style={{ left: `${playhead * 100}%` }}
          />
        ) : null}
      </div>
      <div className={eventsStyles.scale}>
        <span data-testid="axis-start">{axisClock(start, dayEnd)}</span>
        <span data-testid="axis-end">{axisClock(end, dayEnd)}</span>
      </div>
    </div>
  );
}
