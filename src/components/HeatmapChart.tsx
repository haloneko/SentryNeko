/** GitHub-style heatmap: one cell per bucket, shaded by the focus time inside it. */

import { memo, useMemo } from "react";

import { useI18n } from "../hooks/useI18n";
import { dateFormatter } from "../utils/intl";
import type { HeatmapBucket, HeatmapGranularity } from "../types/heatmap";
import heatmapStyles from "../pages/Heatmap/heatmap.module.css";

/** Shade steps above an empty cell. */
const LEVELS = 4;

/** Shade of a bucket: empty, then four steps towards the busiest bucket of the window. */
function level(seconds: number, peak: number): number {
  if (seconds <= 0 || peak <= 0) {
    return 0;
  }

  return Math.min(LEVELS, Math.max(1, Math.ceil((seconds / peak) * LEVELS)));
}

/** Peak a bucket is shaded against, so the busiest one always reaches the top step. */
function peakOf(buckets: readonly HeatmapBucket[]): number {
  return buckets.reduce((peak, bucket) => Math.max(peak, bucket.focusSeconds), 0);
}

/** What the tick under a strip's cell spells: a month, or a day of one. */
function tickOptions(granularity: HeatmapGranularity): Intl.DateTimeFormatOptions {
  return granularity === "month"
    ? { month: "short", year: "2-digit" }
    : { day: "numeric", month: "short" };
}

interface HeatmapCellProps {
  /** Shade step, `0` for a bucket without focus time. */
  level: number;
  /** Tooltip copy describing the bucket. */
  title: string;
}

/** One shaded square; the tooltip carries the numbers, because the cell cannot show them. */
const HeatmapCell = memo(function HeatmapCell({ level, title }: HeatmapCellProps) {
  const shade = heatmapStyles[`level${level}`] ?? "";

  return <span className={`${heatmapStyles.heatmapCell} ${shade}`.trim()} title={title} />;
});

interface HeatmapChartProps {
  /** Buckets of the window, oldest first and dense. */
  buckets: readonly HeatmapBucket[];
  granularity: HeatmapGranularity;
}

/**
 * Renders the buckets as a calendar grid for daily use — weeks as columns, Monday at the top —
 * and as a labelled strip once a cell stands for a week or a month.
 */
export function HeatmapChart({ buckets, granularity }: HeatmapChartProps) {
  const { language, t } = useI18n();
  const peak = peakOf(buckets);

  // One entry per bucket, worked out once per window: the shade and the tooltip only move when the
  // buckets do, so a chart that redraws for a reason of its own formats nothing again.
  const cells = useMemo(
    () =>
      buckets.map((bucket) => ({
        bucket,
        shade: level(bucket.focusSeconds, peak),
        title: t("heatmap.cell", {
          date: dateFormatter(language, { dateStyle: "medium" }).format(
            new Date(bucket.start * 1000),
          ),
          minutes: Math.round(bucket.focusSeconds / 60),
          tasks: bucket.completedTasks,
        }),
      })),
    [buckets, language, peak, t],
  );

  const legend = (
    <div className={heatmapStyles.heatmapLegend}>
      <span className="muted">{t("heatmap.legend.less")}</span>
      {Array.from({ length: LEVELS + 1 }, (_, step) => (
        <span className={`${heatmapStyles.heatmapCell} ${heatmapStyles[`level${step}`] ?? ""}`.trim()} key={step} />
      ))}
      <span className="muted">{t("heatmap.legend.more")}</span>
    </div>
  );

  if (granularity === "day") {
    // The first bucket sits in its weekday row, so the columns stay aligned with the calendar.
    const first = buckets[0];
    const leading = first === undefined ? 0 : (new Date(first.start * 1000).getDay() + 6) % 7;

    return (
      <>
        <div className={heatmapStyles.heatmapCalendar}>
          {Array.from({ length: leading }, (_, blank) => (
            <span className={heatmapStyles.heatmapBlank} key={`blank-${blank}`} />
          ))}
          {cells.map(({ bucket, shade, title }) => (
            <HeatmapCell key={bucket.start} level={shade} title={title} />
          ))}
        </div>
        {legend}
      </>
    );
  }

  return (
    <>
      <ol className={heatmapStyles.heatmapStrip}>
        {cells.map(({ bucket, shade, title }) => (
          <li key={bucket.start}>
            <HeatmapCell level={shade} title={title} />
            <span className={heatmapStyles.heatmapTick}>
              {dateFormatter(language, tickOptions(granularity)).format(
                new Date(bucket.start * 1000),
              )}
            </span>
          </li>
        ))}
      </ol>
      {legend}
    </>
  );
}
