/**
 * The date navigator on its own: a day, the arrows either side of it, and the calendar under it.
 * `?min=1` closes the past to three days, which is how a bounded navigator is exercised.
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import { DateNavigator } from "../src/components/ui/DateNavigator";
import i18n from "../src/i18n";
import { useI18nStore } from "../src/stores/i18nStore";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

/** Local midnight of a date, which is how every day travels through the app. */
function dayStart(date: Date): number {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
}

function shift(day: number, days: number): number {
  const date = new Date(day * 1000);

  date.setDate(date.getDate() + days);

  return dayStart(date);
}

/** The day as `YYYY-MM-DD`, so a test can compare it without depending on the locale's wording. */
function iso(day: number): string {
  const date = new Date(day * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${dateOfMonth}`;
}

const today = dayStart(new Date());
const min = params.get("min") === "1" ? shift(today, -3) : undefined;

function Fixture() {
  const [day, setDay] = useState(today);

  return (
    <>
      <DateNavigator
        label={params.get("label") ?? "Choose a day"}
        max={today}
        min={min}
        onChange={setDay}
        value={day}
      />
      <p data-testid="chosen" style={{ marginTop: 16 }}>
        {iso(day)}
      </p>
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <Fixture />
    </I18nProvider>
  </StrictMode>,
);
