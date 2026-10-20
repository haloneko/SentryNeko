/** GitHub-style heatmap: one cell per bucket, shaded by the focus time inside it. */

import { useI18n } from "../hooks/useI18n";
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

interface HeatmapCellProps {
  /** Shade step, `0` for a bucket without focus time. */
  level: number;
  /** Tooltip copy describing the bucket. */
  title: string;
}

/** One shaded square; the tooltip carries the numbers, because the cell cannot show them. */
function HeatmapCell({ level, title }: HeatmapCellProps) {
  const shade = heatmapStyles[`level${level}`] ?? "";

  return <span className={`${heatmapStyles.heatmapCell} ${shade}`.trim()} title={title} />;
}

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

  const describe = (bucket: HeatmapBucket): string => {
    const date = new Date(bucket.start * 1000).toLocaleDateString(language, {
      dateStyle: "medium",
    });

    return t("heatmap.cell", {
      date,
      minutes: Math.round(bucket.focusSeconds / 60),
      tasks: bucket.completedTasks,
    });
  };

  const cell = (bucket: HeatmapBucket) => (
    <HeatmapCell
      key={bucket.start}
      level={level(bucket.focusSeconds, peak)}
      title={describe(bucket)}
    />
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
          {buckets.map(cell)}
        </div>
        {legend}
      </>
    );
  }

  return (
    <>
      <ol className={heatmapStyles.heatmapStrip}>
        {buckets.map((bucket) => (
          <li key={bucket.start}>
            {cell(bucket)}
            <span className={heatmapStyles.heatmapTick}>
              {new Date(bucket.start * 1000).toLocaleDateString(
                language,
                granularity === "month"
                  ? { month: "short", year: "2-digit" }
                  : { day: "numeric", month: "short" },
              )}
            </span>
          </li>
        ))}
      </ol>
      {legend}
    </>
  );
}
