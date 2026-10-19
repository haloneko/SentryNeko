import { mockIPC } from "@tauri-apps/api/mocks";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { AlarmDefaultsSettings } from "../src/components/AlarmDefaultsSettings";
import { I18nProvider } from "../src/components/I18nProvider";
import { PomodoroSettings } from "../src/components/PomodoroSettings";
import { NumericInput } from "../src/components/ui/NumericInput";
import i18n from "../src/i18n";
import type { AlarmDefaults } from "../src/types/alarm";
import type { PomodoroDurations } from "../src/types/pomodoro";
import "../src/styles/app.css";

declare global {
  interface Window {
    numericInputSaves: Array<{ command: string; value: unknown }>;
  }
}

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(params.get("language") ?? "en-US");

window.numericInputSaves = [];
Object.defineProperty(window, "isTauri", { value: true });
let defaults: AlarmDefaults = { method: "toast", ringSeconds: 10 };
let durations: PomodoroDurations = { focusSeconds: 1500, shortBreakSeconds: 300, longBreakSeconds: 900 };
mockIPC((command, args) => {
  let data: unknown = null;
  if (command === "get_setting") {
    const { key } = args as { key: string };
    const stored = key === "alarm.defaults" ? defaults : key === "pomodoro.durations" ? durations : null;
    data = stored === null ? null : { key, value: JSON.stringify(stored), category: "", updatedAt: 0 };
  } else if (command === "set_setting") {
    const { key, value } = args as { key: string; value: string };
    const parsed: unknown = JSON.parse(value);
    if (key === "alarm.defaults") defaults = parsed as AlarmDefaults;
    if (key === "pomodoro.durations") durations = parsed as PomodoroDurations;
    data = { key, value, category: "", updatedAt: 0 };
    window.numericInputSaves.push({ command: key, value: parsed });
  }
  return { code: "OK", data, details: null, message: "OK" };
});

function Fixture() {
  const [value, setValue] = useState(Number(params.get("value") ?? 5));
  const [step, setStep] = useState(Number(params.get("step") ?? 1));
  const [changes, setChanges] = useState<number[]>([]);
  const [shown, setShown] = useState(true);
  const [submits, setSubmits] = useState(0);

  if (params.has("settings")) {
    return (
      <I18nProvider>
        <button onClick={() => setShown(false)} type="button">Unmount settings</button>
        {shown ? <><PomodoroSettings /><AlarmDefaultsSettings /></> : null}
      </I18nProvider>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); setSubmits((count) => count + 1); }}>
      <div className="scroll-box" data-testid="scroll-box">
        <div className="scroll-content">
          {shown ? (
            <div className="demo-field">
              <label htmlFor="test-value">Test value</label>
              <NumericInput
                decreaseLabel="Decrease test value"
                disabled={params.has("disabled")}
                id="test-value"
                increaseLabel="Increase test value"
                max={params.has("unbounded") ? undefined : Number(params.get("max") ?? 100)}
                min={params.has("unbounded") ? undefined : Number(params.get("min") ?? 0)}
                onChange={(next) => {
                  setValue(next);
                  setChanges((current) => [...current, next]);
                }}
                readOnly={params.has("readonly")}
                step={step}
                value={value}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="test-actions">
        <button onClick={() => setValue(42)} type="button">External update</button>
        <button onClick={() => setStep(0.5)} type="button">Change step</button>
        <button onClick={() => setShown(!shown)} type="button">Toggle field</button>
      </div>
      <output data-testid="value">{value}</output>
      <output data-testid="changes">{JSON.stringify(changes)}</output>
      <output data-testid="submits">{submits}</output>
    </form>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StrictMode><Fixture /></StrictMode>);
}
