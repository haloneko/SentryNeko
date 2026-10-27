/** One hourly chart on its own, drawn from the buckets the fixture makes up. */

import { createRoot } from "react-dom/client";

import { HourlyChart } from "../src/components/HourlyChart";
import { I18nProvider } from "../src/components/I18nProvider";
import i18n from "../src/i18n";
import { useI18nStore } from "../src/stores/i18nStore";
import type { FocusCategoryHour, HourlyKind, HourlyUsage } from "../src/types/hourly";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";
const kind: HourlyKind = params.get("kind") === "focus" ? "focus" : "apps";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

const midnight = Math.floor(new Date(2026, 9, 21).getTime() / 1000);
const at = (hour: number): number => midnight + hour * 3600;

/** Four apps, so the stack keeps them all apart without folding anything. */
const usage: readonly HourlyUsage[] = [
  { appName: "Code", hourStart: at(9), seconds: 2_400 },
  { appName: "Chrome", hourStart: at(9), seconds: 900 },
  { appName: "Code", hourStart: at(10), seconds: 1_800 },
  { appName: "Slack", hourStart: at(10), seconds: 600 },
  { appName: "Terminal", hourStart: at(11), seconds: 1_200 },
];

/** More categories than a stack keeps, so the last legend entry is the folded slice. */
const focusCategories: readonly FocusCategoryHour[] = [
  { category: "writing", hourStart: at(9), seconds: 1_800 },
  { category: "reading", hourStart: at(9), seconds: 600 },
  { category: "", hourStart: at(9), seconds: 300 },
  { category: "writing", hourStart: at(10), seconds: 900 },
  { category: "reviewing", hourStart: at(10), seconds: 450 },
  { category: "planning", hourStart: at(11), seconds: 400 },
  { category: "pairing", hourStart: at(11), seconds: 350 },
  { category: "testing", hourStart: at(12), seconds: 300 },
  { category: "documenting", hourStart: at(12), seconds: 250 },
];

createRoot(document.getElementById("root") as HTMLElement).render(
  <I18nProvider>
    <div className="content-inner" style={{ padding: 16, width: 720 }}>
      <HourlyChart focusCategories={focusCategories} kind={kind} usage={usage} />
    </div>
  </I18nProvider>,
);
