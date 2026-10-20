/** Focus trend as an area chart: one point per bucket, peak on the left, span along the bottom. */

import { useI18n } from "../hooks/useI18n";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

/** Drawing box the SVG scales from, so the chart stays sharp at any width. */
const WIDTH = 600;
const HEIGHT = 150;
const PAD = 10;

/** How many tick labels the axis carries at most. */
const TICKS = 6;

interface FocusTrendChartProps {
  /** Buckets of the window, oldest first and dense. */
  buckets: readonly HeatmapBucket[];
  granularity: HeatmapGranularity;
}

/** Renders the buckets as an area, answering the empty state itself. */
export function FocusTrendChart({ buckets, granularity }: FocusTrendChartProps) {
  const { language, t } = useI18n();
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.focusSeconds), 0);

  if (buckets.length === 0 || peak === 0) {
    return <p className="muted">{t("analytics.trend.empty")}</p>;
  }

  const minutes = (seconds: number): number => Math.round(seconds / 60);
  const x = (index: number): number =>
    buckets.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - 2 * PAD)) / (buckets.length - 1);
  const y = (seconds: number): number => HEIGHT - PAD - (seconds / peak) * (HEIGHT - 2 * PAD);

  const line = buckets
    .map((bucket, index) => `${x(index).toFixed(1)},${y(bucket.focusSeconds).toFixed(1)}`)
    .join(" ");
  const area = `${PAD},${HEIGHT - PAD} ${line} ${WIDTH - PAD},${HEIGHT - PAD}`;
  const step = Math.max(1, Math.ceil(buckets.length / TICKS));

  const label = (start: number): string =>
    new Date(start * 1000).toLocaleDateString(
      language,
      granularity === "month"
        ? { month: "short", year: "2-digit" }
        : { day: "numeric", month: "short" },
    );

  return (
    <figure className={analyticsStyles.trend}>
      <figcaption className={`${analyticsStyles.trendPeak} muted`}>
        {t("analytics.trend.peak", { minutes: minutes(peak) })}
      </figcaption>
      <svg
        aria-label={t("analytics.trend.title")}
        className={analyticsStyles.trendChart}
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <polygon className={analyticsStyles.trendArea} points={area} />
        <polyline className={analyticsStyles.trendLine} points={line} />
        {buckets.map((bucket, index) => (
          <circle
            className={analyticsStyles.trendPoint}
            cx={x(index)}
            cy={y(bucket.focusSeconds)}
            key={bucket.start}
            r={3}
          >
            <title>
              {t("analytics.trend.point", {
                date: label(bucket.start),
                minutes: minutes(bucket.focusSeconds),
              })}
            </title>
          </circle>
        ))}
      </svg>
      <div className={analyticsStyles.trendTicks}>
        {buckets.map((bucket, index) => {
          const isLast = index === buckets.length - 1;

          // The last label is always drawn, so a regular tick that would crowd it is dropped.
          if (!isLast && (index % step !== 0 || buckets.length - 1 - index < step)) {
            return null;
          }

          // The first and last labels sit against the edge instead of running past it; a lone
          // bucket falls between the two and stays centred.
          const left = (x(index) / WIDTH) * 100;
          const edge = (PAD / WIDTH) * 100;
          const shift = left <= edge ? 0 : left >= 100 - edge ? -100 : -50;

          return (
            <span
              className="muted"
              key={bucket.start}
              style={{ left: `${left}%`, transform: `translateX(${shift}%)` }}
            >
              {label(bucket.start)}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
