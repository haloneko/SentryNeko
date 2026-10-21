/** One block of the analytics page: its heading and the states every block shares. */

import type { ReactNode } from "react";

import { useI18n } from "../hooks/useI18n";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

interface AnalyticsPanelProps {
  /** Already translated heading. */
  title: string;
  /** Switch shown beside the heading. */
  action?: ReactNode;
  loading: boolean;
  busy?: boolean;
  /** Already translated failure message, `null` while the block is fine. */
  error: string | null;
  children: ReactNode;
}

/** Renders loading and failure once, so no block can forget one of them. */
export function AnalyticsPanel({
  action,
  busy = false,
  children,
  error,
  loading,
  title,
}: AnalyticsPanelProps) {
  const { t } = useI18n();

  return (
    <section aria-busy={busy} className={analyticsStyles.analyticsSection}>
      <div className={analyticsStyles.analyticsHead}>
        <h2>{title}</h2>
        {action}
      </div>
      {loading ? <p className="muted">{t("analytics.loading")}</p> : null}
      {error !== null ? <p className="error">{error}</p> : null}
      {!loading && error === null ? children : null}
    </section>
  );
}
