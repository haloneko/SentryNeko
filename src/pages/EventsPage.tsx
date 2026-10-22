/** Foreground application event stream page: one local day, drawn as a timeline. */

import { useState } from "react";

import { AppEventTimeline } from "../components/AppEventTimeline";
import { DateNavigator } from "../components/ui/DateNavigator";
import { DAY_LIMIT, useAppEventDay } from "../hooks/useAppEventDay";
import { useI18n } from "../hooks/useI18n";
import { useAppEventStore } from "../stores/appEventStore";
import { dayStart, nextDayStart } from "./Events/events";
import eventsStyles from "./Events/events.module.css";

export function EventsPage() {
  const { t } = useI18n();
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

  return (
    <section className="card">
      <h2 className={eventsStyles.logHead}>{t("events.log.title")}</h2>
      <DateNavigator label={t("events.day.label")} max={today} onChange={setDay} value={day} />
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
  );
}
