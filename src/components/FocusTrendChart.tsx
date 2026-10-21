/** Focus trend: one point per bucket, drawn as an area with a minute axis and a hover readout. */

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useI18n } from "../hooks/useI18n";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

/** Room the axis labels need; the plot keeps the rest. */
const MARGIN = { bottom: 0, left: 0, right: 8, top: 8 };

/** One bucket, ready for the axis and the tooltip. */
interface TrendPoint {
  seconds: number;
  label: string;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: readonly { payload?: TrendPoint }[];
}

/** Seconds as the minutes the axis and the tooltip print. */
function minuteTick(value: number): string {
  return String(Math.round(value / 60));
}

/** The tooltip in the app's own surfaces instead of the library's default box. */
function TrendTooltip({ active, payload }: TrendTooltipProps) {
  const { t } = useI18n();
  const point = payload?.[0]?.payload;

  if (active !== true || point === undefined) {
    return null;
  }

  return (
    <div className={analyticsStyles.chartTooltip}>
      <p className={analyticsStyles.chartTooltipHead}>{point.label}</p>
      <p className={analyticsStyles.chartTooltipRow}>
        <span
          className={analyticsStyles.chartDot}
          style={{ background: "var(--accent)" }}
        />
        <span className={analyticsStyles.chartTooltipName}>
          {t("analytics.trend.focus")}
        </span>
        <span className={analyticsStyles.chartTooltipValue}>
          {t("analytics.duration.minutes", { minutes: Math.round(point.seconds / 60) })}
        </span>
      </p>
    </div>
  );
}

interface FocusTrendChartProps {
  /** Buckets of the window, oldest first and dense. */
  buckets: readonly HeatmapBucket[];
  granularity: HeatmapGranularity;
}

/** Renders the buckets as an area, answering the empty state itself. */
export function FocusTrendChart({ buckets, granularity }: FocusTrendChartProps) {
  const { language, t } = useI18n();
  // The gradient needs an id; the colons `useId` adds are not valid in an `url(#…)` reference.
  const fillId = `trend-fill-${useId().replace(/:/g, "")}`;
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.focusSeconds), 0);

  if (buckets.length === 0 || peak === 0) {
    return <p className="muted">{t("analytics.trend.empty")}</p>;
  }

  const label = (start: number): string =>
    new Date(start * 1000).toLocaleDateString(
      language,
      granularity === "month"
        ? { month: "short", year: "2-digit" }
        : { day: "numeric", month: "short" },
    );
  const points: TrendPoint[] = buckets.map((bucket) => ({
    label: label(bucket.start),
    seconds: bucket.focusSeconds,
  }));

  return (
    <figure className={analyticsStyles.chartFigure}>
      <figcaption className={`${analyticsStyles.chartCaption} muted`}>
        {t("analytics.trend.peak", { minutes: Math.round(peak / 60) })}
      </figcaption>
      <div className={analyticsStyles.chartPlot}>
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={points} margin={MARGIN}>
            <defs>
              <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
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
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickFormatter={minuteTick}
              tickLine={false}
              width={34}
            />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
            />
            <Area
              animationDuration={240}
              dataKey="seconds"
              fill={`url(#${fillId})`}
              stroke="var(--accent)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
