/** Completion panel: how many tasks were finished today. */

import { useEffect } from "react";

import { useI18n } from "../../../hooks/useI18n";
import { useTodos } from "../../../hooks/useTodos";

/** Today's finished count, with the lifetime count as its note. */
export function CompletionWidget() {
  const { t } = useI18n();
  const { completions, completionsError, completionsLoading, refreshCompletions } = useTodos();

  useEffect(() => {
    void refreshCompletions();
  }, [refreshCompletions]);

  return (
    <section className="dash-panel">
      <p className="dash-kicker">{t("dashboard.done.title")}</p>
      {completionsLoading ? <p className="dash-muted">{t("dashboard.loading")}</p> : null}
      {completionsError !== null ? <p className="error">{t("dashboard.error")}</p> : null}
      {!completionsLoading && completionsError === null ? (
        <>
          <p className="dash-count">
            {completions.today}
            <span className="dash-unit">{t("dashboard.done.unit")}</span>
          </p>
          <p className="dash-note">{t("dashboard.done.total", { count: completions.all })}</p>
          {completions.today === 0 ? (
            <p className="dash-muted">{t("dashboard.done.empty")}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
