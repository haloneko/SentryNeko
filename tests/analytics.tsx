/**
 * The analytics page on its own, with the three queries it asks for answered empty. The window the
 * day block asked for is kept on `window` so a test can check which day reached the database.
 */

import { mockIPC } from "@tauri-apps/api/mocks";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import i18n from "../src/i18n";
import { AnalyticsPage } from "../src/pages/AnalyticsPage";
import { useI18nStore } from "../src/stores/i18nStore";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

declare global {
  interface Window {
    /** The `from` of the last hourly query, as epoch seconds. */
    __hourlyFrom?: number;
  }
}

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

Object.defineProperty(window, "isTauri", { value: true });

mockIPC((command, payload) => {
  if (
    command === "app_usage_hours" ||
    command === "focus_hours" ||
    command === "focus_category_hours"
  ) {
    window.__hourlyFrom = (payload as { from: number }).from;
  }

  return { code: "OK", data: [], details: null, message: "OK" };
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <div className="content-inner">
        <AnalyticsPage />
      </div>
    </I18nProvider>
  </StrictMode>,
);
