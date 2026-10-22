/** Foreground application event stream page: one local day, drawn as a timeline. */

import { useState } from "react";

import { AppEventTimeline } from "../components/AppEventTimeline";
import { ActionIcon } from "../components/ui/ActionIcon";
import { DAY_LIMIT, useAppEventDay } from "../hooks/useAppEventDay";
import { useI18n } from "../hooks/useI18n";
import { useAppEventStore } from "../stores/appEventStore";
import { dayStart, dayStep, nextDayStart } from "./Events/events";
import eventsStyles from "./Events/events.module.css";

/**
 * Renders one day of the stream at a time.
 *
 * The day is the unit of loading and of the axis: the page asks for a whole day, the axis shows
 * that day, and the arrows walk to the day before or after. Switches the shell pushes in while the
 * page is open join the day they belong to.
 */
export function EventsPage() {
  const { language, t } = useI18n();
  const now = Math.floor(Date.now() / 1000);
  const today = dayStart(now);
  const [day, setDay] = useState(today);
  const { error, events, loading, truncated } = useAppEventDay(day);
  const live = useAppEventStore((state) => state.live);

  const end = nextDayStart(day);
  const known = new Set(events.map((event) => event.id));
  const rows = [
    ...live.filter(
      (event) => event.startedAt >= day && event.startedAt < end && !known.has(event.id),
    ),
    ...events,
  ];

  const label = new Date(day * 1000).toLocaleDateString(language, {
    day: "numeric",
    month: "long",
    weekday: "short",
  });

  return (
    <>
      <section className="card">
        <h2 className={eventsStyles.logHead}>{t("events.log.title")}</h2>
        <div className={eventsStyles.dayNav}>
          <button
            aria-label={t("events.day.previous")}
            className={eventsStyles.dayButton}
            onClick={() => {
              setDay((current) => dayStep(current, -1));
            }}
            type="button"
          >
            <ActionIcon name="previous" />
          </button>
          <span className={eventsStyles.dayTitle}>{label}</span>
          <button
            aria-label={t("events.day.next")}
            className={eventsStyles.dayButton}
            disabled={day >= today}
            onClick={() => {
              setDay((current) => dayStep(current, 1));
            }}
            type="button"
          >
            <ActionIcon name="next" />
          </button>
          {day === today ? null : (
            <button
              className={eventsStyles.dayJump}
              onClick={() => {
                setDay(today);
              }}
              type="button"
            >
              {t("events.day.today")}
            </button>
          )}
        </div>
        {loading ? <p className="muted">{t("events.loading")}</p> : null}
        {error !== null ? <p className="error">{t("events.error")}</p> : null}
        {!loading && error === null ? (
          <>
            <AppEventTimeline day={day} events={rows} />
            {truncated ? (
              <p className="muted">{t("events.truncated", { limit: DAY_LIMIT })}</p>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  );
}
