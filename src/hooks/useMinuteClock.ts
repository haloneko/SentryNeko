/** The wall clock, sampled on every whole minute, in the UTC epoch seconds the API uses. */

import { useEffect, useState } from "react";

/** Milliseconds from now to the next minute boundary. */
function untilNextMinute(): number {
  return 60_000 - (Date.now() % 60_000);
}

/**
 * The current minute, kept in step with the wall clock.
 *
 * A plain `setInterval` counts sixty seconds from whenever it happened to start, so a deadline at
 * 09:00 would turn over up to a minute after the fact and the next one would be further adrift
 * still. Each tick here schedules the next against the clock's own minute boundary, which is also
 * the moment a due time changes from "upcoming" to "passed": the flag flips on the minute rather
 * than some time in the minute.
 *
 * One timer carries the whole page: the rows read the number and compare it with their own stored
 * instants, so nothing else has to be scheduled per task.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let timer = 0;

    const schedule = (): void => {
      timer = window.setTimeout(() => {
        setNow(Math.floor(Date.now() / 1000));
        schedule();
      }, untilNextMinute());
    };

    schedule();

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return now;
}
