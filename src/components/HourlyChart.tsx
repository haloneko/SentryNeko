/** The hourly panel: the day's apps, or the categories its focus was filed under, stacked per hour. */

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useI18n } from "../hooks/useI18n";
import type {
  FocusCategoryHour,
  HourlyKind,
  HourlyUsage,
  StackedSlice,
} from "../types/hourly";
import { stackFocus, stackHours } from "../types/hourly";
import analyticsStyles from "../pages/Analytics/analytics.module.css";

/** Room the axis labels need; the plot keeps the rest. */
const MARGIN = { bottom: 0, left: 4, right: 4, top: 8 };

/** Every third hour is labelled, so twenty-four columns keep a readable axis. */
const LABEL_EVERY = 3;

/** Corner of the bar that carries the top of a stack, matched to `--radius-sm`. */
const TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/** A little air above the busiest column, so it never touches the top of the plot. */
const HEADROOM = (max: number): number => max * 1.08;

interface HourlyChartProps {
  kind: HourlyKind;
  usage: readonly HourlyUsage[];
  focusCategories: readonly FocusCategoryHour[];
}

/** One slice of a stacked bar, as the tooltip hands it over. */
interface TooltipRow {
  color?: string;
  dataKey?: string | number;
  name?: string;
  value?: number;
}

interface HourlyTooltipProps {
  active?: boolean;
  label?: number | string;
  payload?: readonly TooltipRow[];
}

/** `0` … `23` as the hour axis prints them. */
function hourTick(value: unknown): string {
  return String(Number(value));
}

/** Slice fill colour: the rank in the category palette, the folded slice in grey. */
function fillOf(slice: StackedSlice, index: number): string {
  return slice.other === true ? "var(--chart-other)" : `var(--chart-${index + 1})`;
}

/** The busiest hour of the day, in seconds; the caption turns it into the scale of the bars. */
function peakOf(rows: readonly Record<string, number>[], slices: readonly StackedSlice[]): number {
  return rows.reduce((peak, row) => {
    const total = slices.reduce((sum, slice) => sum + (row[slice.key] ?? 0), 0);

    return Math.max(peak, total);
  }, 0);
}

/** The tooltip in the app's own surfaces instead of the library's default box. */
function HourlyTooltip({ active, label, payload }: HourlyTooltipProps) {
  const { t } = useI18n();

  if (active !== true || payload === undefined) {
    return null;
  }

  const rows = payload
    .filter((row) => Number(row.value) > 0)
    .sort((left, right) => Number(right.value) - Number(left.value));

  if (rows.length === 0) {
    return null;
  }

  const minutes = (seconds: number): number => Math.round(seconds / 60);
  const total = rows.reduce((sum, row) => sum + Number(row.value), 0);

  return (
    <div className={analyticsStyles.chartTooltip}>
      <p className={analyticsStyles.chartTooltipHead}>
        {`${String(Number(label)).padStart(2, "0")}:00`}
      </p>
      {rows.map((row) => (
        <p className={analyticsStyles.chartTooltipRow} key={row.dataKey}>
          <span className={analyticsStyles.chartDot} style={{ background: row.color }} />
          <span className={analyticsStyles.chartTooltipName}>{row.name}</span>
          <span className={analyticsStyles.chartTooltipValue}>
            {t("analytics.duration.minutes", { minutes: minutes(Number(row.value)) })}
          </span>
        </p>
      ))}
      {rows.length > 1 ? (
        <p className={analyticsStyles.chartTooltipTotal}>
          {t("analytics.hourly.total", { minutes: minutes(total) })}
        </p>
      ) : null}
    </div>
  );
}

/** The legend under the plot: one dot and one name per drawn slice, busiest first. */
function HourlyLegend({ slices }: { slices: readonly StackedSlice[] }) {
  return (
    <ul className={analyticsStyles.chartLegend}>
      {slices.map((slice, index) => (
        <li className={analyticsStyles.chartLegendItem} key={slice.key}>
          <span className={analyticsStyles.chartDot} style={{ background: fillOf(slice, index) }} />
          {slice.name}
        </li>
      ))}
    </ul>
  );
}

/** Renders the chosen measure; a day without records draws as an empty chart, not as a sentence. */
export function HourlyChart({ focusCategories, kind, usage }: HourlyChartProps) {
  const { t } = useI18n();
  // Both measures answer the same shape, so they share one stack and one drawing: the app buckets
  // of the day, or its focus seconds split by the category they were filed under.
  const { rows, slices } =
    kind === "focus"
      ? stackFocus(
          focusCategories,
          t("analytics.hourly.otherCategory"),
          t("pomodoro.category.unnamed"),
        )
      : stackHours(usage, t("analytics.hourly.other"));
  // Nothing recorded means nothing to stack: the axes stay, so the day still reads as a chart.
  const empty = slices.length === 0;
  const peak = empty ? 0 : peakOf(rows, slices);

  // The busiest slice — the first of the legend — is the base of every column; the slice sitting on
  // top of the stack is the one that carries the rounded corners.
  const bars = slices.map((slice, index) => (
    <Bar
      animationDuration={240}
      dataKey={slice.key}
      fill={fillOf(slice, index)}
      key={slice.key}
      name={slice.name}
      radius={index === slices.length - 1 ? TOP_RADIUS : undefined}
      stackId="usage"
    />
  ));

  return (
    <figure className={analyticsStyles.chartFigure}>
      <figcaption className={`${analyticsStyles.chartCaption} muted`}>
        {empty ? null : t("analytics.hourly.peak", { minutes: Math.round(peak / 60) })}
      </figcaption>
      <div className={analyticsStyles.chartPlot}>
        <ResponsiveContainer height="100%" width="100%">
          <BarChart barCategoryGap="10%" data={rows} margin={MARGIN}>
            <XAxis
              axisLine={{ stroke: "var(--border)" }}
              dataKey="hour"
              interval={LABEL_EVERY - 1}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickFormatter={hourTick}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis domain={[0, HEADROOM]} hide niceTicks="none" />
            <Tooltip
              content={<HourlyTooltip />}
              cursor={{ fill: "var(--surface-hover)", fillOpacity: 0.6 }}
            />
            {bars}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {empty ? null : <HourlyLegend slices={slices} />}
    </figure>
  );
}
