/** Alarm panel: the next reminder that will ring. */

import { Link } from "react-router-dom";

import { useAlarms } from "../../../hooks/useAlarms";
import { useI18n } from "../../../hooks/useI18n";
import { ALL_DAYS, clockTime, isOneOff, maskDays } from "../../../types/alarm";
import type { Alarm } from "../../../types/alarm";
import { nextRing } from "../nextRing";
import dashboardStyles from "../dashboard.module.css";

/** The next armed alarm, or that none is switched on. */
export function AlarmWidget() {
  const { t } = useI18n();
  const { alarms, error, loading } = useAlarms();

  const next = nextRing(alarms, new Date());

  /** How often an alarm comes back, in words. */
  const repeat = (alarm: Alarm): string => {
    if (isOneOff(alarm)) {
      return t("dashboard.alarm.once");
    }

    if (alarm.repeatDays === ALL_DAYS) {
      return t("dashboard.alarm.everyday");
    }

    return maskDays(alarm.repeatDays)
      .map((day) => t(`alarm.weekday.${day}`))
      .join(" ");
  };

  return (
    <section className={dashboardStyles.dashPanel} data-dash-panel>
      <p className={dashboardStyles.dashKicker}>{t("dashboard.alarm.title")}</p>
      {loading ? <p className={dashboardStyles.dashMuted}>{t("dashboard.loading")}</p> : null}
      {error !== null ? <p className="error">{t("dashboard.error")}</p> : null}
      {!loading && error === null ? (
        next === null ? (
          <p className={dashboardStyles.dashMuted}>{t("dashboard.alarm.empty")}</p>
        ) : (
          <div className={dashboardStyles.dashAlarm}>
            <span className={dashboardStyles.dashAlarmTime}>{clockTime(next.alarm.hour, next.alarm.minute)}</span>
            <span className={dashboardStyles.dashAlarmLabel}>
              {next.alarm.label || t("dashboard.alarm.untitled")}
            </span>
            <span className={dashboardStyles.dashNote}>{repeat(next.alarm)}</span>
            <Link className={dashboardStyles.dashLink} to="/alarms">
              {t("dashboard.alarm.open")}
            </Link>
          </div>
        )
      ) : null}
    </section>
  );
}
