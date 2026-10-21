/** Trend chart: one point per bucket, drawn as an area with a minute axis and a hover readout. */

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useI18n } from "../hooks/useI18n";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

/** Room the axis labels need; the plot keeps the rest. */
const MARGIN = { bottom: 0, left: 0, right: 8, top: 8 };

/** The two series a trend can draw, each read from a field of the same bucket. */
export type TrendMetric = "focus" | "apps";

/** One colour per series: focus keeps the accent, screen time borrows a chart hue. */
const STROKE: Record<TrendMetric, string> = {
  apps: "var(--chart-4)",
  focus: "var(--accent)",
};

/** The seconds of a bucket a metric draws. */
function secondsOf(bucket: HeatmapBucket, metric: TrendMetric): number {
  return metric === "focus" ? bucket.focusSeconds : bucket.appSeconds;
}

/** One bucket, ready for the axis and the tooltip. */
interface TrendPoint {
  seconds: number;
  label: string;
}

interface TrendTooltipProps {
  active?: boolean;
  metric: TrendMetric;
  payload?: readonly { payload?: TrendPoint }[];
}

/** Seconds as the minutes the axis and the tooltip print. */
function minuteTick(value: number): string {
  return String(Math.round(value / 60));
}

/** The tooltip in the app's own surfaces instead of the library's default box. */
function TrendTooltip({ active, metric, payload }: TrendTooltipProps) {
  const { t } = useI18n();
  const point = payload?.[0]?.payload;

  if (active !== true || point === undefined) {
    return null;
  }

  return (
    <div className={analyticsStyles.chartTooltip}>
      <p className={analyticsStyles.chartTooltipHead}>{point.label}</p>
      <p className={analyticsStyles.chartTooltipRow}>
        <span className={analyticsStyles.chartDot} style={{ background: STROKE[metric] }} />
        <span className={analyticsStyles.chartTooltipName}>
          {t(`analytics.trend.series.${metric}`)}
        </span>
        <span className={analyticsStyles.chartTooltipValue}>
          {t("analytics.duration.minutes", { minutes: Math.round(point.seconds / 60) })}
        </span>
      </p>
    </div>
  );
}

interface TrendChartProps {
  /** Buckets of the window, oldest first and dense. */
  buckets: readonly HeatmapBucket[];
  granularity: HeatmapGranularity;
  metric: TrendMetric;
}

/** Renders one series of the buckets as an area, answering the empty state itself. */
export function TrendChart({ buckets, granularity, metric }: TrendChartProps) {
  const { language, t } = useI18n();
  // The gradient needs an id; the colons `useId` adds are not valid in an `url(#…)` reference.
  const fillId = `trend-fill-${useId().replace(/:/g, "")}`;
  const peak = buckets.reduce((max, bucket) => Math.max(max, secondsOf(bucket, metric)), 0);
  // An empty window is drawn as an empty chart: the axes stay, the caption has nothing to report.
  const empty = buckets.length === 0 || peak === 0;

  const label = (start: number): string =>
    new Date(start * 1000).toLocaleDateString(
      language,
      granularity === "month"
        ? { month: "short", year: "2-digit" }
        : { day: "numeric", month: "short" },
    );
  const points: TrendPoint[] = buckets.map((bucket) => ({
    label: label(bucket.start),
    seconds: secondsOf(bucket, metric),
  }));

  return (
    <figure className={analyticsStyles.chartFigure}>
      <figcaption className={`${analyticsStyles.chartCaption} muted`}>
        {empty ? null : t("analytics.trend.peak", { minutes: Math.round(peak / 60) })}
      </figcaption>
      <div className={analyticsStyles.chartPlot}>
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={points} margin={MARGIN}>
            <defs>
              <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={STROKE[metric]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={STROKE[metric]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              axisLine={{ stroke: "var(--border)" }}
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={56}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              // A zero window would print a column of `0`s, so it shows no scale at all.
              tick={empty ? false : { fill: "var(--text-muted)", fontSize: 11 }}
              tickFormatter={minuteTick}
              tickLine={false}
              width={34}
            />
            <Tooltip
              content={<TrendTooltip metric={metric} />}
              cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
            />
            {empty ? null : (
              <Area
                animationDuration={240}
                dataKey="seconds"
                fill={`url(#${fillId})`}
                stroke={STROKE[metric]}
                strokeWidth={2}
                type="monotone"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
