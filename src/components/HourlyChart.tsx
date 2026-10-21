/** The hourly panel: the day's apps stacked per hour, or its focus minutes as an area. */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useI18n } from "../hooks/useI18n";
import type { FocusHour, HourlyKind, HourlyUsage, StackedApp } from "../types/hourly";
import { focusRows, stackHours } from "../types/hourly";
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
  focus: readonly FocusHour[];
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

/** Hour fill colour: the rank in the category palette, the folded slice in grey. */
function fillOf(app: StackedApp, index: number): string {
  return app.other === true ? "var(--chart-other)" : `var(--chart-${index + 1})`;
}

/** The busiest hour of the day, in seconds; the caption turns it into the scale of the bars. */
function peakOf(rows: readonly Record<string, number>[], apps: readonly StackedApp[]): number {
  return rows.reduce((peak, row) => {
    const total = apps.reduce((sum, app) => sum + (row[app.key] ?? 0), 0);

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
function HourlyLegend({ apps }: { apps: readonly StackedApp[] }) {
  return (
    <ul className={analyticsStyles.chartLegend}>
      {apps.map((app, index) => (
        <li className={analyticsStyles.chartLegendItem} key={app.key}>
          <span className={analyticsStyles.chartDot} style={{ background: fillOf(app, index) }} />
          {app.name}
        </li>
      ))}
    </ul>
  );
}

/** Renders the chosen measure; the empty state is answered here, not by the page. */
export function HourlyChart({ focus, kind, usage }: HourlyChartProps) {
  const { t } = useI18n();
  const caption = (seconds: number): string =>
    t("analytics.hourly.peak", { minutes: Math.round(seconds / 60) });

  if (kind === "focus") {
    const rows = focusRows(focus);
    const peak = rows.reduce((best, row) => Math.max(best, row.seconds), 0);

    if (peak === 0) {
      return <p className="muted">{t("analytics.hourly.empty")}</p>;
    }

    return (
      <figure className={analyticsStyles.chartFigure}>
        <figcaption className={`${analyticsStyles.chartCaption} muted`}>
          {caption(peak)}
        </figcaption>
        <div className={analyticsStyles.chartPlot}>
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={rows} margin={MARGIN}>
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
              <Area
                animationDuration={240}
                dataKey="seconds"
                fill="var(--accent)"
                fillOpacity={0.18}
                name={t("analytics.hourly.focusMinutes")}
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

  const { apps, rows } = stackHours(usage, t("analytics.hourly.other"));

  if (apps.length === 0) {
    return <p className="muted">{t("analytics.hourly.empty")}</p>;
  }

  // The busiest app — the first of the legend — is the base of every column; the slice sitting on
  // top of the stack is the one that carries the rounded corners.
  const bars = apps.map((app, index) => (
    <Bar
      animationDuration={240}
      dataKey={app.key}
      fill={fillOf(app, index)}
      key={app.key}
      name={app.name}
      radius={index === apps.length - 1 ? TOP_RADIUS : undefined}
      stackId="usage"
    />
  ));

  return (
    <figure className={analyticsStyles.chartFigure}>
      <figcaption className={`${analyticsStyles.chartCaption} muted`}>
        {caption(peakOf(rows, apps))}
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
      <HourlyLegend apps={apps} />
    </figure>
  );
}
