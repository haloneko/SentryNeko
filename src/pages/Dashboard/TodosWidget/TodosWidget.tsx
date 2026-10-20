/** Todos panel: what is still open today. */

import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useI18n } from "../../../hooks/useI18n";
import { useTodos } from "../../../hooks/useTodos";
import dashboardStyles from "../dashboard.module.css";

/** Remaining task count with a link to the full list. */
export function TodosWidget() {
  const { t } = useI18n();
  const { counts, refresh } = useTodos();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className={dashboardStyles.dashPanel} data-dash-panel>
      <p className={dashboardStyles.dashKicker}>{t("dashboard.todos.title")}</p>
      <p className={dashboardStyles.dashCount}>
        {counts.remaining}
        <span className={dashboardStyles.dashUnit}>{t("dashboard.todos.remaining")}</span>
      </p>
      <p className={dashboardStyles.dashNote}>{t("dashboard.todos.completed", { count: counts.completed })}</p>
      <Link className={dashboardStyles.dashLink} to="/todos">
        {t("dashboard.todos.open")}
      </Link>
    </section>
  );
}
