/** Heatmap page: the last year of focus time and completed tasks. */

import { useState } from "react";

import { HeatmapChart } from "../components/HeatmapChart";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useHeatmap } from "../hooks/useHeatmap";
import { useI18n } from "../hooks/useI18n";
import { HEATMAP_GRANULARITIES } from "../types/heatmap";
import type { HeatmapGranularity } from "../types/heatmap";
import heatmapStyles from "./Heatmap/heatmap.module.css";

/** Renders the heatmap with its granularity switch and the totals of the window. */
export function HeatmapPage() {
  const { t } = useI18n();
  const [granularity, setGranularity] = useState<HeatmapGranularity>("day");
  const { buckets, error, loading } = useHeatmap(granularity);

  const focusSeconds = buckets.reduce((total, bucket) => total + bucket.focusSeconds, 0);
  const completedTasks = buckets.reduce((total, bucket) => total + bucket.completedTasks, 0);

  const duration = (): string => {
    const hours = Math.floor(focusSeconds / 3_600);
    const minutes = Math.floor((focusSeconds % 3_600) / 60);

    return hours > 0
      ? t("heatmap.hours", { hours, minutes })
      : t("heatmap.minutes", { minutes });
  };

  return (
    <>
      <h1>{t("nav.heatmap")}</h1>
      <section className={heatmapStyles.heatmapSection}>
        <div className={heatmapStyles.heatmapHead}>
          <h2>{t("heatmap.title")}</h2>
          <SegmentedControl
            label={t("heatmap.granularity.label")}
            onChange={setGranularity}
            options={HEATMAP_GRANULARITIES.map((value) => ({
              label: t(`heatmap.granularity.${value}`),
              value,
            }))}
            value={granularity}
          />
        </div>
        {loading ? <p className="muted">{t("heatmap.loading")}</p> : null}
        {error !== null ? <p className="error">{t("heatmap.error")}</p> : null}
        {!loading && error === null ? (
          <>
            <HeatmapChart buckets={buckets} granularity={granularity} />
            <p className="muted">
              {t("heatmap.summary", { duration: duration(), tasks: completedTasks })}
            </p>
          </>
        ) : null}
        {!loading && error === null && focusSeconds === 0 && completedTasks === 0 ? (
          <p className="muted">{t("heatmap.empty")}</p>
        ) : null}
      </section>
    </>
  );
}
