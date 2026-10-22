/** One trend chart on its own, drawn from buckets the fixture makes up. */

import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import { TrendChart } from "../src/components/TrendChart";
import i18n from "../src/i18n";
import { useI18nStore } from "../src/stores/i18nStore";
import type { HeatmapBucket } from "../src/types/heatmap";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

/** Two weeks of a focus curve, so the plot has a shape to point at. */
const buckets: readonly HeatmapBucket[] = Array.from({ length: 14 }, (_, index) => ({
  appSeconds: 3_600 + index * 420,
  completedTasks: index % 3,
  focusSeconds: 1_800 + ((index * 7) % 5) * 900,
  start: Math.floor(new Date(2026, 9, 1 + index).getTime() / 1000),
}));

function Fixture() {
  return (
    <div style={{ height: 320, width: 640 }}>
      <TrendChart buckets={buckets} granularity="day" metric="focus" />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>,
);
