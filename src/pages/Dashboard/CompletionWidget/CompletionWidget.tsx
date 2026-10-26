/** Completion panel: how many tasks were finished today. */

import { useEffect } from "react";

import { useI18n } from "../../../hooks/useI18n";
import { useTodoActions, useTodoCompletions } from "../../../hooks/useTodos";
import dashboardStyles from "../dashboard.module.css";

/** Today's finished count, with the lifetime count as its note. */
export function CompletionWidget() {
  const { t } = useI18n();
  const { completions, error, loading } = useTodoCompletions();
  const { refreshCompletions } = useTodoActions();

  useEffect(() => {
    void refreshCompletions();
  }, [refreshCompletions]);

  return (
    <section className={dashboardStyles.dashPanel} data-dash-panel>
      <p className={dashboardStyles.dashKicker}>{t("dashboard.done.title")}</p>
      {loading ? <p className={dashboardStyles.dashMuted}>{t("dashboard.loading")}</p> : null}
      {error !== null ? <p className="error">{t("dashboard.error")}</p> : null}
      {!loading && error === null ? (
        <>
          <p className={dashboardStyles.dashCount}>
            {completions.today}
            <span className={dashboardStyles.dashUnit}>{t("dashboard.done.unit")}</span>
          </p>
          <p className={dashboardStyles.dashNote}>{t("dashboard.done.total", { count: completions.all })}</p>
          {completions.today === 0 ? (
            <p className={dashboardStyles.dashMuted}>{t("dashboard.done.empty")}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
