/** Custom phase lengths, edited in minutes and stored as soon as they settle. */

import { useEffect, useState } from "react";

import { useI18n } from "../hooks/useI18n";
import { usePomodoro } from "../hooks/usePomodoro";
import { MAX_PHASE_SECONDS, MIN_PHASE_SECONDS } from "../types/pomodoro";
import type { PomodoroDurations } from "../types/pomodoro";
import { NumericInput } from "./ui/NumericInput";
import pomodoroStyles from "../pages/Pomodoro/pomodoro.module.css";
import settingsStyles from "../pages/Settings/settings.module.css";
import todosStyles from "../pages/Todos/todos.module.css";

/** Wait after the last keystroke, so typing `25` writes once. */
const SAVE_DELAY_MS = 600;

/** How long the "saved" note stays after a write. */
const SAVED_NOTE_MS = 2_000;

interface Draft {
  focus: number;
  shortBreak: number;
  longBreak: number;
}

/** Three minute fields and the ratio they add up to; every change saves itself. */
export function PomodoroSettings() {
  const { t } = useI18n();
  const { active, durations, endsAt, error, saveDurations } = usePomodoro();
  const [draft, setDraft] = useState<Draft>(() => toDraft(durations));
  const [saved, setSaved] = useState(false);

  // The stored values land after the first render; every save answers with the stored row too.
  useEffect(() => {
    setDraft(toDraft(durations));
  }, [durations]);

  useEffect(() => {
    if (!saved) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSaved(false);
    }, SAVED_NOTE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [saved]);

  const idle = endsAt === null && !active;
  const next: PomodoroDurations = {
    focusSeconds: draft.focus * 60,
    longBreakSeconds: draft.longBreak * 60,
    shortBreakSeconds: draft.shortBreak * 60,
  };
  const stored =
    next.focusSeconds === durations.focusSeconds &&
    next.longBreakSeconds === durations.longBreakSeconds &&
    next.shortBreakSeconds === durations.shortBreakSeconds;

  const save = (): void => {
    if (!idle || stored) {
      return;
    }

    void saveDurations(next).then(setSaved);
  };

  useEffect(() => {
    if (!idle || stored) {
      return;
    }

    const timer = window.setTimeout(save, SAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
    // The three fields are the inputs the save reads.
  }, [draft.focus, draft.shortBreak, draft.longBreak, idle, stored, saveDurations]);

  const phases = [
    { key: "focus", value: draft.focus },
    { key: "shortBreak", value: draft.shortBreak },
    { key: "longBreak", value: draft.longBreak },
  ] as const;
  const total = phases.reduce((sum, phase) => sum + phase.value, 0);

  const update = (key: keyof Draft) => (value: number) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className={settingsStyles.settingsForm}>
      <div className={pomodoroStyles.phaseGrid}>
        {phases.map((phase) => {
          const label = t(`pomodoro.settings.${phase.key}`);
          const id = `pomodoro-${phase.key}`;

          return (
            <div className={settingsStyles.setField} key={phase.key}>
              <label htmlFor={id}>{label}</label>
              <NumericInput
                decreaseLabel={t("numericInput.decrease", { label })}
                disabled={!idle}
                id={id}
                increaseLabel={t("numericInput.increase", { label })}
                max={MAX_PHASE_SECONDS / 60}
                min={MIN_PHASE_SECONDS / 60}
                onBlur={save}
                onChange={update(phase.key)}
                value={phase.value}
              />
            </div>
          );
        })}
      </div>
      {total > 0 ? (
        <div aria-hidden="true" className={pomodoroStyles.phaseBar}>
          {phases.map((phase) => (
            <span
              className={pomodoroStyles.phaseSlice}
              data-phase={phase.key}
              key={phase.key}
              style={{ flexGrow: phase.value }}
            />
          ))}
        </div>
      ) : null}
      <p className={pomodoroStyles.phaseKeys}>
        {phases.map((phase) => {
          const name = t(`pomodoro.phase.${phase.key}`);

          return (
            <span
              className={pomodoroStyles.phaseKey}
              data-phase={phase.key}
              key={phase.key}
              title={t("pomodoro.settings.slice", { minutes: phase.value, phase: name })}
            >
              <span aria-hidden="true" className={pomodoroStyles.phaseDot} />
              {name}
            </span>
          );
        })}
      </p>
      {!idle || error !== null || saved ? (
        <p className={settingsStyles.settingsStatus}>
          {!idle ? <span className="muted">{t("pomodoro.settings.locked")}</span> : null}
          {idle && error !== null ? (
            <span className={todosStyles.todoError}>{t("pomodoro.settings.error")}</span>
          ) : null}
          {idle && error === null && saved ? (
            <span className="muted">{t("pomodoro.settings.saved")}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function toDraft(durations: PomodoroDurations): Draft {
  return {
    focus: Math.round(durations.focusSeconds / 60),
    longBreak: Math.round(durations.longBreakSeconds / 60),
    shortBreak: Math.round(durations.shortBreakSeconds / 60),
  };
}
