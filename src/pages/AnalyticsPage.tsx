/** Analytics page: app usage ranking, finished task counts and focus trend. */

import { useEffect, useState } from "react";

import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { FocusTrendChart } from "../components/FocusTrendChart";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useAppUsage } from "../hooks/useAppEvents";
import { useFocusTrend } from "../hooks/useFocusTrend";
import { useI18n } from "../hooks/useI18n";
import { useTodos } from "../hooks/useTodos";
import { USAGE_RANGES } from "../types/appEvent";
import type { UsageRange } from "../types/appEvent";
import type { HeatmapGranularity } from "../types/heatmap";
import { TREND_GRANULARITIES } from "../types/trend";

/** The copy a duration is written with, so the usage ranking and the trend share one formatter. */
interface DurationKeys {
  /** Used from one hour on. */
  hours: string;
  minutes: string;
}

const USAGE_DURATION: DurationKeys = {
  hours: "analytics.usage.hours",
  minutes: "analytics.usage.minutes",
};

const TREND_DURATION: DurationKeys = {
  hours: "analytics.trend.totalHours",
  minutes: "analytics.trend.totalMinutes",
};

/**
 * Renders the analytics page.
 *
 * The three blocks load on their own, so switching one range never waits for another, and each
 * switch asks the backend for one aggregated answer instead of the page crunching rows itself.
 */
export function AnalyticsPage() {
  const { t } = useI18n();
  const [range, setRange] = useState<UsageRange>("today");
  const [granularity, setGranularity] = useState<HeatmapGranularity>("day");
  const { error, loading, usage } = useAppUsage(range);
  const {
    completions,
    completionsError,
    completionsLoading,
    refreshCompletions,
  } = useTodos();
  const {
    buckets,
    error: trendError,
    loading: trendLoading,
    totalSeconds,
  } = useFocusTrend(granularity);
  const peak = usage[0]?.seconds ?? 0;

  useEffect(() => {
    void refreshCompletions();
  }, [refreshCompletions]);

  /** Hours are only shown once there are any, so a short span reads as plain minutes. */
  const duration = (seconds: number, keys: DurationKeys): string => {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);

    return hours > 0 ? t(keys.hours, { hours, minutes }) : t(keys.minutes, { minutes });
  };

  return (
    <>
      <h1>{t("nav.analytics")}</h1>
      <AnalyticsPanel
        action={
          <SegmentedControl
            label={t("analytics.range.label")}
            onChange={setRange}
            options={USAGE_RANGES.map((value) => ({
              label: t(`analytics.range.${value}`),
              value,
            }))}
            value={range}
          />
        }
        error={error === null ? null : t("analytics.usage.error")}
        loading={loading}
        title={t("analytics.usage.title")}
      >
        {usage.length === 0 ? (
          <p className="muted">{t("analytics.usage.empty")}</p>
        ) : (
          <ul className="usage-list">
            {usage.map((entry) => (
              <li className="usage-row" key={entry.appName}>
                <span className="usage-app" title={entry.appName}>
                  {entry.appName}
                </span>
                <span className="meter">
                  <span style={{ width: `${Math.round((entry.seconds / peak) * 100)}%` }} />
                </span>
                <span className="usage-time">{duration(entry.seconds, USAGE_DURATION)}</span>
              </li>
            ))}
          </ul>
        )}
      </AnalyticsPanel>
      <AnalyticsPanel
        error={completionsError === null ? null : t("analytics.completion.error")}
        loading={completionsLoading}
        title={t("analytics.completion.title")}
      >
        {completions.all === 0 ? (
          <p className="muted">{t("analytics.completion.empty")}</p>
        ) : (
          <>
            <p className="completion-rate">
              <span className="completion-value">{completions.today}</span>
              <span className="muted">{t("analytics.completion.unit")}</span>
            </p>
            <p className="muted">{t("analytics.completion.total", { count: completions.all })}</p>
          </>
        )}
      </AnalyticsPanel>
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
          <p className="muted">{duration(totalSeconds, TREND_DURATION)}</p>
        ) : null}
      </AnalyticsPanel>
    </>
  );
}
