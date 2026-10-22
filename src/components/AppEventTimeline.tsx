/** The foreground stream as one day: a horizontal axis over a list that only draws what is seen. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { EventScrubber } from "./EventScrubber";
import { useI18n } from "../hooks/useI18n";
import { appColor, clock, duration } from "../pages/Events/events";
import type { AppEvent } from "../types/appEvent";
import eventsStyles from "../pages/Events/events.module.css";

/** Height of one row, fixed so the list can jump to a row without measuring anything. */
const ROW_HEIGHT = 36;

/** Rows drawn above and below the viewport, so a fast scroll never shows a blank line. */
const OVERSCAN = 8;

/** How long the row a seek landed on keeps its wash, in milliseconds. */
const FOCUS_MS = 1600;

/** Smooth scrolling unless the system asked for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

interface AppEventTimelineProps {
  /** Local midnight of the day on show. */
  day: number;
  /** Episodes of that day, newest first. */
  events: readonly AppEvent[];
}

/**
 * Draws one day, newest at the top.
 *
 * A day can hold tens of thousands of switches, so the list is virtual: only the rows inside the
 * viewport (plus a margin) exist, and the canvas keeps the full height so the scrollbar still tells
 * the truth. Seeking scrolls by row arithmetic instead of searching the document.
 */
export function AppEventTimeline({ day, events }: AppEventTimelineProps) {
  const { language, t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const fade = useRef<number | null>(null);
  const [height, setHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);

  useEffect(() => {
    const element = viewport.current;

    if (element === null) {
      return;
    }

    const measure = (): void => {
      setHeight(element.clientHeight);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Another day starts at its top, with nothing carried over from the day before.
  useEffect(() => {
    setSelected(null);
    setFocused(null);
    setScrollTop(0);
    viewport.current?.scrollTo({ top: 0 });
  }, [day]);

  useEffect(
    () => () => {
      if (fade.current !== null) {
        window.clearTimeout(fade.current);
      }
    },
    [],
  );

  const seek = useCallback(
    (event: AppEvent): void => {
      const index = events.findIndex((row) => row.id === event.id);
      const element = viewport.current;

      setSelected(event.id);
      setFocused(event.id);

      if (element !== null && index >= 0) {
        const middle = Math.max(0, (element.clientHeight - ROW_HEIGHT) / 2);

        element.scrollTo({
          behavior: scrollBehavior(),
          top: Math.max(0, index * ROW_HEIGHT - middle),
        });
      }

      if (fade.current !== null) {
        window.clearTimeout(fade.current);
      }

      fade.current = window.setTimeout(() => {
        setFocused(null);
      }, FOCUS_MS);
    },
    [events],
  );

  if (events.length === 0) {
    return <p className="muted">{t("events.day.empty")}</p>;
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(events.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = events.slice(first, last);

  return (
    <div className={eventsStyles.timeline}>
      <EventScrubber day={day} events={events} onSeek={seek} selectedId={selected} />
      <div
        className={eventsStyles.viewport}
        data-testid="event-viewport"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        ref={viewport}
      >
        <ol
          className={eventsStyles.canvas}
          style={{ height: `${events.length * ROW_HEIGHT}px` }}
        >
          {visible.map((event, offset) => {
            const color = appColor(event.appName);

            return (
              <li
                className={eventsStyles.row}
                data-event-id={event.id}
                data-focused={focused === event.id}
                data-testid="event-row"
                key={event.id}
                style={
                  {
                    "--event-color": color.strong,
                    "--event-tint": color.tint,
                    top: `${(first + offset) * ROW_HEIGHT}px`,
                  } as CSSProperties
                }
              >
                <time
                  className={eventsStyles.clock}
                  dateTime={new Date(event.startedAt * 1000).toISOString()}
                >
                  {clock(event.startedAt, language)}
                </time>
                <span aria-hidden="true" className={eventsStyles.node} data-testid="event-node" />
                <div className={eventsStyles.body}>
                  <span className={eventsStyles.app}>{event.appName}</span>
                  <span className={eventsStyles.window}>
                    {event.windowTitle ?? t("events.log.untitled")}
                  </span>
                </div>
                <span className={eventsStyles.span}>
                  {event.endedAt === null
                    ? t("events.timeline.now")
                    : duration(event.endedAt - event.startedAt)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
