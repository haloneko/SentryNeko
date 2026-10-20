/** Focus panel: today's tracked time plus the pulse of the last week. */

import { useFocusTrend } from "../../../hooks/useFocusTrend";
import { useI18n } from "../../../hooks/useI18n";
import { formatSpan, weekday } from "../format";
import dashboardStyles from "../dashboard.module.css";

/** Today's focus at a glance, with the shape of the week behind it. */
export function FocusWidget() {
  const { language, t } = useI18n();
  const { buckets, error, loading } = useFocusTrend("day");

  const today = buckets.at(-1);
  const week = buckets.slice(-7);
  const peakDay = Math.max(...week.map((bucket) => bucket.focusSeconds), 1);
  const average =
    week.length === 0
      ? 0
      : Math.round(week.reduce((sum, bucket) => sum + bucket.focusSeconds, 0) / week.length);
  const focusSeconds = today?.focusSeconds ?? 0;
  const hours = Math.floor(focusSeconds / 3_600);
  const minutes = Math.floor((focusSeconds % 3_600) / 60);

  return (
    <section className={`${dashboardStyles.dashPanel} ${dashboardStyles.dashHero}`} data-dash-panel>
      <p className={dashboardStyles.dashKicker}>{t("dashboard.focus.title")}</p>
      {loading ? <p className={dashboardStyles.dashMuted}>{t("dashboard.loading")}</p> : null}
      {error !== null ? <p className="error">{t("dashboard.error")}</p> : null}
      {!loading && error === null && today !== undefined ? (
        <>
          <p className={dashboardStyles.dashClock}>
            {hours > 0 ? (
              <>
                <span>{hours}</span>
                <span className={dashboardStyles.dashUnit}>{t("dashboard.hours")}</span>
              </>
            ) : null}
            <span>{minutes}</span>
            <span className={dashboardStyles.dashUnit}>{t("dashboard.minutes")}</span>
          </p>
          <p className={dashboardStyles.dashNote}>
            {t("dashboard.focus.completed", { count: today.completedTasks })}
          </p>
          <p className={dashboardStyles.dashNote}>
            {t("dashboard.focus.average", { value: formatSpan(average, t) })}
          </p>
          <div aria-label={t("dashboard.pulse.label")} className={dashboardStyles.dashPulse} role="img">
            {week.map((bucket) => (
              <span
                className={dashboardStyles.dashDay}
                data-today={bucket.start === today.start}
                key={bucket.start}
                title={t("dashboard.pulse.point", {
                  day: weekday(bucket.start, language),
                  minutes: Math.round(bucket.focusSeconds / 60),
                })}
              >
                <span className={dashboardStyles.dashDayTrack}>
                  <span
                    className={dashboardStyles.dashDayBar}
                    style={{
                      height: `${Math.max(
                        2,
                        Math.round((bucket.focusSeconds / peakDay) * 100),
                      )}%`,
                    }}
                  />
                </span>
                <span className={dashboardStyles.dashDayLabel}>{weekday(bucket.start, language)}</span>
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
