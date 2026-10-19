/** Manual demo for the shared DateTimeField: a typed field with the picker panel behind its button. */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import { DateTimeField } from "../src/components/ui/DateTimeField";
import type { DateTimeMode } from "../src/components/ui/DateTimeField";
import { isoDay } from "../src/components/ui/dueDate";
import i18n from "../src/i18n";
import { useI18nStore } from "../src/stores/i18nStore";
import "../src/styles/app.css";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
const language = params.get("language") === "zh-CN" ? "zh-CN" : "en-US";

document.documentElement.dataset.theme = theme;
document.documentElement.lang = language;
void i18n.changeLanguage(language);
// The app keeps the store and i18next in step; the demo has no switcher to do it.
useI18nStore.setState({ language });

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today at `hour` in the local zone, as the epoch seconds the field works in. */
function atToday(hour: number): number {
  const date = new Date();

  date.setHours(hour, 0, 0, 0);

  return Math.floor(date.getTime() / 1000);
}

/** The stored moment as the reader's own clock reads it, so the epoch beside it can be checked. */
function localText(value: number, mode: DateTimeMode): string {
  const date = new Date(value * 1000);
  const day = isoDay(date);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (mode === "date") {
    return day;
  }

  if (mode === "time") {
    return clock;
  }

  return `${day} ${clock}`;
}

interface ExampleProps {
  initial: number | null;
  mode?: DateTimeMode;
  note: string;
  /** What the open panel calls itself; the caller knows what the field is for. */
  panelLabel: string;
  title: string;
}

/** One field on its own, showing the epoch it answers with and how it reads on this machine. */
function Example({ initial, mode = "datetime", note, panelLabel, title }: ExampleProps) {
  const [value, setValue] = useState<number | null>(initial);

  return (
    <section className="demo-card">
      <h2>{title}</h2>
      <DateTimeField
        label={title}
        mode={mode}
        onChange={setValue}
        panelLabel={panelLabel}
        value={value}
      />
      <p className="demo-note">{note}</p>
      <p className="demo-value">
        epoch: {value ?? "null"}
        {value === null ? "" : ` · local: ${localText(value, mode)}`}
      </p>
    </section>
  );
}

/** The shape the task list uses: two fields held together as one window. */
function WindowExample() {
  const [start, setStart] = useState<number | null>(atToday(9));
  const [end, setEnd] = useState<number | null>(atToday(18));

  return (
    <section className="demo-card">
      <h2>Window · 开始 + 结束</h2>
      <div className="demo-fields">
        <DateTimeField label="开始" onChange={setStart} panelLabel="选择开始时间" value={start} />
        <DateTimeField label="结束" onChange={setEnd} panelLabel="选择结束时间" value={end} />
      </div>
      <p className="demo-note">
        两个字段各管一端；清空某一端就只留下另一端，不会替用户补一个默认时刻。
      </p>
      <p className="demo-value">
        {start === null ? "—" : localText(start, "datetime")} →{" "}
        {end === null ? "—" : localText(end, "datetime")}
      </p>
    </section>
  );
}

function Switches() {
  return (
    <nav aria-label="Demo switches" className="demo-switches">
      <a aria-current={theme === "dark"} href={`?theme=dark&language=${language}`}>
        Dark
      </a>
      <a aria-current={theme === "light"} href={`?theme=light&language=${language}`}>
        Light
      </a>
      <a aria-current={language === "zh-CN"} href={`?theme=${theme}&language=zh-CN`}>
        中文
      </a>
      <a aria-current={language === "en-US"} href={`?theme=${theme}&language=en-US`}>
        English
      </a>
    </nav>
  );
}

function Demo() {
  return (
    <main className="content" style={{ height: "100vh" }}>
      <div className="content-inner">
        <div className="demo-shell">
          <header className="demo-head">
            <div>
              <h1>DateTimeField · 纪元秒</h1>
              <p>
                组件收发 UTC 纪元秒：输入框里的年月日时分只是本地编辑态。
                <br />
                可以直接键入 <code>2026-10-19 09:05</code>（也认 <code>/</code> 与 <code>.</code> 分隔），
                也可以整串连写：<code>202610190900</code> 是日子加时刻、<code>20261019</code> 只有日子、
                <code>905</code> 与 <code>202</code> 只有时刻（读作 9:05 与 2:02）。
                <br />
                或者点右侧图标打开面板挑选；非法日期与时刻会当场拒绝。
              </p>
            </div>
            <Switches />
          </header>

          <Example
            initial={atToday(9)}
            note="键入后按 Enter 落盘，按 Escape 还原；失焦同样会提交。"
            panelLabel="选择日期与时刻"
            title="Date + time"
          />
          <Example
            initial={null}
            mode="date"
            note="只挑日子，时刻固定为本地 00:00。"
            panelLabel="选择日期"
            title="Date only"
          />
          <Example
            initial={atToday(9)}
            mode="time"
            note="只挑时刻，日子取今天。"
            panelLabel="选择时刻"
            title="Time only"
          />
          <WindowExample />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <Demo />
    </I18nProvider>
  </StrictMode>,
);
