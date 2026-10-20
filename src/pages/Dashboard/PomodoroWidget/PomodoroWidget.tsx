/** Pomodoro panel: the running phase and how far into it the timer is. */

import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../../../hooks/useI18n";
import { usePomodoro } from "../../../hooks/usePomodoro";
import { phaseSeconds } from "../../../types/pomodoro";
import { countdown } from "../format";
import dashboardStyles from "../dashboard.module.css";

/** The timer block, kept apart so its quarter-second tick re-renders only these lines. */
export function PomodoroWidget() {
  const { t } = useI18n();
  const { durations, endsAt, load, phase, remainingMs } = usePomodoro();

  useEffect(() => {
    void load();
  }, [load]);

  const total = phaseSeconds(durations, phase) * 1000;
  const done = total === 0 ? 0 : Math.min(100, Math.round(((total - remainingMs) / total) * 100));

  return (
    <section className={dashboardStyles.dashPanel} data-dash-panel>
      <p className={dashboardStyles.dashKicker}>{t("dashboard.pomodoro.title")}</p>
      <p className={dashboardStyles.dashTimer}>{countdown(remainingMs)}</p>
      <p className={dashboardStyles.dashNote}>
        {t(`pomodoro.phase.${phase}`)}
        {" · "}
        {endsAt === null ? t("dashboard.pomodoro.idle") : t("dashboard.pomodoro.running")}
      </p>
      <span aria-hidden="true" className="meter">
        <span style={{ width: `${done}%` }} />
      </span>
      <Link className={dashboardStyles.dashLink} to="/pomodoro">
        {t("dashboard.pomodoro.open")}
      </Link>
    </section>
  );
}
