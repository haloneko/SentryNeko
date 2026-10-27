/**
 * Analytics page: the focus and the screen time trend, then the day at a glance and where its
 * hours went.
 *
 * Each trend is rendered by its own panel and owns its window, so widening one never resets the
 * other, and the day block asks for its two hourly series at once. No block folds rows itself.
 */

import { useMemo, useState } from "react";

import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { HourlyChart } from "../components/HourlyChart";
import { TrendPanel } from "../components/TrendPanel";
import { DateNavigator } from "../components/ui/DateNavigator";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useDayUsage } from "../hooks/useDayUsage";
import { useI18n } from "../hooks/useI18n";
import type { HourlyKind } from "../types/hourly";
import { dayTotals, HOURLY_KINDS } from "../types/hourly";
import { formatDuration } from "./Analytics/format";
import analyticsStyles from "./Analytics/analytics.module.css";

/** Local midnight of today, in epoch seconds: the last day the page may show. */
function todayStart(): number {
  return Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
}

/** Renders the analytics page. */
export function AnalyticsPage() {
  const { t } = useI18n();
  const [dayStart, setDayStart] = useState(todayStart);
  const [kind, setKind] = useState<HourlyKind>("apps");
  // The hook reads a `Date`, but the day itself is one number: midnight on the calendar.
  const day = useMemo(() => new Date(dayStart * 1000), [dayStart]);
  const {
    busy,
    error: hourlyError,
    focusCategories,
    loading: hourlyLoading,
    usage,
  } = useDayUsage(day);
  const totals = dayTotals(usage, focusCategories);

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
            <DateNavigator
              align="end"
              label={t("analytics.day.label")}
              max={todayStart()}
              onChange={setDayStart}
              value={dayStart}
            />
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
        <HourlyChart focusCategories={focusCategories} kind={kind} usage={usage} />
      </AnalyticsPanel>
    </>
  );
}
