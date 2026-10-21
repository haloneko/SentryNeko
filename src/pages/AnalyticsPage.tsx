/**
 * Analytics page: the focus trend of a window, then the day at a glance and where its hours went.
 *
 * Each block asks the backend for one aggregated answer, so a switch never waits on a second
 * request and the page never folds rows itself.
 */

import { useState } from "react";

import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { FocusTrendChart } from "../components/FocusTrendChart";
import { HourlyChart } from "../components/HourlyChart";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useDayUsage } from "../hooks/useDayUsage";
import { useFocusTrend } from "../hooks/useFocusTrend";
import { useI18n } from "../hooks/useI18n";
import type { HeatmapGranularity } from "../types/heatmap";
import type { HourlyKind } from "../types/hourly";
import { addDays, dayTotals, HOURLY_KINDS, isSameDay } from "../types/hourly";
import { TREND_GRANULARITIES } from "../types/trend";
import analyticsStyles from "./Analytics/analytics.module.css";

/** The copy a duration is written with, so every block of the page shares one formatter. */
const DURATION = {
  hours: "analytics.duration.hours",
  minutes: "analytics.duration.minutes",
};

/** Renders the analytics page. */
export function AnalyticsPage() {
  const { language, t } = useI18n();
  const [granularity, setGranularity] = useState<HeatmapGranularity>("day");
  const [day, setDay] = useState(() => new Date());
  const [kind, setKind] = useState<HourlyKind>("apps");
  const {
    error: hourlyError,
    focus,
    loading: hourlyLoading,
    usage,
  } = useDayUsage(day);
  const {
    buckets,
    error: trendError,
    loading: trendLoading,
    totalSeconds,
  } = useFocusTrend(granularity);
  const totals = dayTotals(usage, focus);

  /** Hours are only shown once there are any, so a short span reads as plain minutes. */
  const duration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);

    return hours > 0 ? t(DURATION.hours, { hours, minutes }) : t(DURATION.minutes, { minutes });
  };

  return (
    <>
      <h1>{t("nav.analytics")}</h1>
      <AnalyticsPanel
        action={
          <SegmentedControl
            label={t("analytics.trend.granularity.label")}
            onChange={setGranularity}
            options={TREND_GRANULARITIES.map((value) => ({
              label: t(`analytics.trend.granularity.${value}`),
              value,
            }))}
            value={granularity}
          />
        }
        error={trendError === null ? null : t("analytics.trend.error")}
        loading={trendLoading}
        title={t("analytics.trend.title")}
      >
        <FocusTrendChart buckets={buckets} granularity={granularity} />
        {totalSeconds > 0 ? (
          <p className={`muted ${analyticsStyles.chartTotal}`}>
            {t("analytics.trend.total", { duration: duration(totalSeconds) })}
          </p>
        ) : null}
      </AnalyticsPanel>
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
