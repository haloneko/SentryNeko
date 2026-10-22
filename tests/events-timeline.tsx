import { mockIPC } from "@tauri-apps/api/mocks";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import i18n from "../src/i18n";
import { dayStart, dayStep } from "../src/pages/Events/events";
import { EventsPage } from "../src/pages/EventsPage";
import { useI18nStore } from "../src/stores/i18nStore";
import type { AppEvent } from "../src/types/appEvent";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

Object.defineProperty(window, "isTauri", { value: true });

const APPS = ["chrome", "code", "slack"];
const today = dayStart(Math.floor(Date.now() / 1000));

/**
 * A day busy enough to matter: a switch every 30 seconds, 2 880 rows, newest first. Every clock
 * minute therefore starts on a multiple of 30, which lets a test seek to a named time.
 */
const busyDay: readonly AppEvent[] = Array.from({ length: 2_880 }, (_, index) => {
  const startedAt = today + index * 30;

  return {
    appName: APPS[index % APPS.length] ?? "chrome",
    endedAt: startedAt + 25,
    id: 10_000 + index,
    startedAt,
    windowTitle: `Window ${index}`,
  };
}).reverse();

/** A quiet day: twelve rows, enough to show the arrows move by a day. */
const quietDay: readonly AppEvent[] = Array.from({ length: 12 }, (_, index) => {
  const startedAt = dayStep(today, -1) + index * 3_600;

  return {
    appName: APPS[index % APPS.length] ?? "chrome",
    endedAt: startedAt + 3_000,
    id: 20_000 + index,
    startedAt,
    windowTitle: `Yesterday ${index}`,
  };
}).reverse();

const days = new Map<number, readonly AppEvent[]>([
  [today, busyDay],
  [dayStep(today, -1), quietDay],
]);

mockIPC((command, payload) => {
  if (command === "list_app_events_between") {
    const { from } = payload as { from: number };
    const events = days.get(from) ?? [];

    return {
      code: "OK",
      data: { events, more: from === today && params.get("truncated") === "1" },
      details: null,
      message: "OK",
    };
  }

  return { code: "OK", data: null, details: null, message: "OK" };
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <div className="content-inner">
        <EventsPage />
      </div>
    </I18nProvider>
  </StrictMode>,
);
