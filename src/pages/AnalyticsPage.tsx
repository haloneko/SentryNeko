/**
 * Analytics page: the focus and the screen time trend, then the day at a glance and where its
 * hours went.
 *
 * Each trend is rendered by its own panel and owns its window, so widening one never resets the
 * other, and the day block asks for its two hourly series at once. No block folds rows itself.
 */

import { useState } from "react";

import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { HourlyChart } from "../components/HourlyChart";
import { TrendPanel } from "../components/TrendPanel";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useDayUsage } from "../hooks/useDayUsage";
import { useI18n } from "../hooks/useI18n";
import type { HourlyKind } from "../types/hourly";
import { addDays, dayTotals, HOURLY_KINDS, isSameDay } from "../types/hourly";
import { formatDuration } from "./Analytics/format";
import analyticsStyles from "./Analytics/analytics.module.css";

/** Renders the analytics page. */
export function AnalyticsPage() {
  const { language, t } = useI18n();
  const [day, setDay] = useState(() => new Date());
  const [kind, setKind] = useState<HourlyKind>("apps");
  const {
    busy,
    error: hourlyError,
    focus,
    loading: hourlyLoading,
    usage,
  } = useDayUsage(day);
  const totals = dayTotals(usage, focus);

  const duration = (seconds: number): string => formatDuration(seconds, t);

  return (
    <>
      <h1>{t("nav.analytics")}</h1>
      <TrendPanel metric="focus" />
      <TrendPanel metric="apps" />
      <AnalyticsPanel
        action={
          <div className={analyticsStyles.dayControls}>
            <SegmentedControl
              label={t("analytics.hourly.kind.label")}
              onChange={setKind}
              options={HOURLY_KINDS.map((value) => ({
                label: t(`analytics.hourly.kind.${value}`),
                value,
              }))}
              value={kind}
            />
            <nav className={analyticsStyles.dayNav}>
              <button
                aria-label={t("analytics.hourly.previous")}
                className="btn"
                onClick={() => {
                  setDay((current) => addDays(current, -1));
                }}
                type="button"
              >
                ‹
              </button>
              <span className={analyticsStyles.dayLabel}>
                {day.toLocaleDateString(language, {
                  day: "numeric",
                  month: "short",
                  weekday: "short",
                })}
              </span>
              <button
                aria-label={t("analytics.hourly.next")}
                className="btn"
                disabled={isSameDay(day, new Date())}
                onClick={() => {
                  setDay((current) => addDays(current, 1));
                }}
                type="button"
              >
                ›
              </button>
            </nav>
          </div>
        }
        busy={busy}
        error={hourlyError === null ? null : t("analytics.hourly.error")}
        loading={hourlyLoading}
        title={t("analytics.hourly.title")}
      >
        <div className={analyticsStyles.summary}>
          <div className={analyticsStyles.summaryItem}>
            <span className={analyticsStyles.summaryLabel}>{t("analytics.summary.focus")}</span>
            <span className={analyticsStyles.summaryValue}>{duration(totals.focus)}</span>
          </div>
          <div className={analyticsStyles.summaryItem}>
            <span className={analyticsStyles.summaryLabel}>{t("analytics.summary.apps")}</span>
            <span className={analyticsStyles.summaryValue}>{duration(totals.apps)}</span>
          </div>
          <div className={analyticsStyles.summaryItem}>
            <span className={analyticsStyles.summaryLabel}>{t("analytics.summary.top")}</span>
            <span className={analyticsStyles.summaryValue}>
              {totals.top === null ? "—" : duration(totals.top.seconds)}
            </span>
            <span className={analyticsStyles.summaryNote}>{totals.top?.name ?? ""}</span>
          </div>
        </div>
        <HourlyChart focus={focus} kind={kind} usage={usage} />
      </AnalyticsPanel>
    </>
  );
}
