/** Trend panel: one metric of the trend buckets, with its own window switcher. */

import { useState } from "react";

import { AnalyticsPanel } from "./AnalyticsPanel";
import { TrendChart } from "./TrendChart";
import type { TrendMetric } from "./TrendChart";
import { SegmentedControl } from "./ui/SegmentedControl";
import { useI18n } from "../hooks/useI18n";
import { useTrend } from "../hooks/useTrend";
import type { HeatmapGranularity } from "../types/heatmap";
import { TREND_GRANULARITIES } from "../types/trend";
import { formatDuration } from "../pages/Analytics/format";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

/** Heading of each metric, so the panel picks its copy from the metric instead of a branch. */
const TITLES: Record<TrendMetric, string> = {
  apps: "analytics.usageTrend.title",
  focus: "analytics.trend.title",
};

interface TrendPanelProps {
  metric: TrendMetric;
}


export function TrendPanel({ metric }: TrendPanelProps) {
  const { t } = useI18n();
  const [granularity, setGranularity] = useState<HeatmapGranularity>("day");
  const {
    buckets,
    bucketsGranularity,
    busy,
    error,
    loading,
    totalAppSeconds,
    totalFocusSeconds,
  } = useTrend(granularity);
  const total = metric === "focus" ? totalFocusSeconds : totalAppSeconds;

  return (
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
      busy={busy}
      error={error === null ? null : t("analytics.trend.error")}
      loading={loading}
      title={t(TITLES[metric])}
    >
      <TrendChart buckets={buckets} granularity={bucketsGranularity} metric={metric} />
      {total > 0 ? (
        <p className={`muted ${analyticsStyles.chartTotal}`}>
          {t("analytics.trend.total", { duration: formatDuration(total, t) })}
        </p>
      ) : null}
    </AnalyticsPanel>
  );
}
