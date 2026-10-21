/** Heatmap types mirrored from `models/heatmap.rs`. */

/** How one heatmap bucket is aggregated. */
export type HeatmapGranularity = "day" | "week" | "month";

/** Every granularity, in the order the switcher shows them. */
export const HEATMAP_GRANULARITIES = [
  "day",
  "week",
  "month",
] as const satisfies readonly HeatmapGranularity[];

/** One bucket: its local start plus what happened inside it. */
export interface HeatmapBucket {
  /** UTC epoch seconds of the local midnight, Monday or first of the month it starts at. */
  start: number;
  /** Seconds of focus from phases that started inside the bucket. */
  focusSeconds: number;
  appSeconds: number;
  completedTasks: number;
}

/** How many days the heatmap looks back, counting today. */
export const HEATMAP_DAYS = 365;

/** Window of the heatmap: local midnight a year ago up to now, in UTC epoch seconds. */
export function heatmapWindow(now = new Date()): { from: number; to: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (HEATMAP_DAYS - 1));

  return { from: Math.floor(start.getTime() / 1000), to: Math.floor(now.getTime() / 1000) };
}
