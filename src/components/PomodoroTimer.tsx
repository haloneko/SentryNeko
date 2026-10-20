/** The countdown itself: a tick ring, the clock and start / pause / reset. */

import { Link } from "react-router-dom";

import { useI18n } from "../hooks/useI18n";
import { usePomodoro } from "../hooks/usePomodoro";
import { PHASES_PER_CYCLE, POMODORO_PHASES, phaseAfter, phaseSeconds } from "../types/pomodoro";
import { SegmentedControl } from "./ui/SegmentedControl";
import pomodoroStyles from "../pages/Pomodoro/pomodoro.module.css";
import todosStyles from "../pages/Todos/todos.module.css";

/** Centre and reach of the tick ring inside its 240 × 240 viewBox. */
const CENTER = 120;
const OUTER = 112;
const INNER = 102;
const MAJOR_INNER = 96;

/** Renders the clock; the store runs the timer, so leaving this page does not stop it. */
export function PomodoroTimer() {
  const { t } = useI18n();
  const {
    durations,
    endsAt,
    error,
    focusCount,
    pause,
    phase,
    remainingMs,
    reset,
    selectPhase,
    sessionId,
    start,
  } = usePomodoro();

  const running = endsAt !== null;
  const totalMs = Math.max(1, phaseSeconds(durations, phase) * 1000);
  const ratio = Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  // One tick per minute, capped so a long custom phase still leaves a readable ring.
  const ticks = Math.min(60, Math.max(1, Math.round(totalMs / 60_000)));
  const spent = Math.floor(ratio * ticks);

  const done = focusCount % PHASES_PER_CYCLE;
  const nextPhase = phaseAfter(phase, focusCount + (phase === "focus" ? 1 : 0));
  const nextMinutes = Math.round(phaseSeconds(durations, nextPhase) / 60);
  const state = running ? "running" : sessionId === null ? "idle" : "paused";

  return (
    <section className={pomodoroStyles.pomo} data-state={state}>
      <div className={pomodoroStyles.pomoStage}>
        <div className={pomodoroStyles.pomoDial}>
          <svg aria-hidden="true" className={pomodoroStyles.pomoTicks} viewBox="0 0 240 240">
            <circle className={pomodoroStyles.pomoDialLine} cx={CENTER} cy={CENTER} r={84} />
            {Array.from({ length: ticks }, (_, index) => {
              const angle = (index / ticks) * Math.PI * 2 - Math.PI / 2;
              const major = index % 5 === 0;
              const inner = major ? MAJOR_INNER : INNER;

              return (
                <line
                  className={pomodoroStyles.pomoTick}
                  data-major={major}
                  data-spent={index < spent}
                  key={index}
                  x1={CENTER + Math.cos(angle) * inner}
                  x2={CENTER + Math.cos(angle) * OUTER}
                  y1={CENTER + Math.sin(angle) * inner}
                  y2={CENTER + Math.sin(angle) * OUTER}
                />
              );
            })}
          </svg>
          <div className={pomodoroStyles.pomoFace}>
            <p className={pomodoroStyles.pomoPhase}>{t(`pomodoro.phase.${phase}`)}</p>
            <p className={pomodoroStyles.pomoClock} role="timer">
              {formatClock(seconds)}
            </p>
            <p className={pomodoroStyles.pomoState}>{t(`pomodoro.state.${state}`)}</p>
          </div>
        </div>
      </div>
      <aside className={pomodoroStyles.pomoSide}>
        <SegmentedControl
          label={t("pomodoro.phase.label")}
          onChange={(next) => {
            void selectPhase(next);
          }}
          options={POMODORO_PHASES.map((value) => ({
            label: t(`pomodoro.phase.${value}`),
            value,
          }))}
          value={phase}
        />
        <div className={pomodoroStyles.pomoBlock}>
          <p className={pomodoroStyles.pomoKicker}>{t("pomodoro.cycle.label")}</p>
          <p className={pomodoroStyles.pomoValue}>
            {t("pomodoro.cycle.value", { done, total: PHASES_PER_CYCLE })}
          </p>
          <span aria-hidden="true" className={pomodoroStyles.pomoMarks}>
            {Array.from({ length: PHASES_PER_CYCLE }, (_, index) => (
              <span
                className={pomodoroStyles.pomoMark}
                data-active={phase === "focus" && index === done}
                data-done={index < done}
                key={index}
              />
            ))}
          </span>
        </div>
        <div className={pomodoroStyles.pomoBlock}>
          <p className={pomodoroStyles.pomoKicker}>{t("pomodoro.next.label")}</p>
          <p className={pomodoroStyles.pomoValue}>
            {t("pomodoro.next.value", {
              minutes: nextMinutes,
              phase: t(`pomodoro.phase.${nextPhase}`),
            })}
          </p>
        </div>
        <div className={pomodoroStyles.pomoControls}>
          <button
            className={`btn ${pomodoroStyles.pomoPrimary}`}
            onClick={() => {
              if (running) {
                pause();
              } else {
                void start();
              }
            }}
            type="button"
          >
            {running ? t("pomodoro.pause") : t("pomodoro.start")}
          </button>
          <button
            className="btn"
            onClick={() => {
              void reset();
            }}
            type="button"
          >
            {t("pomodoro.reset")}
          </button>
        </div>
        <Link className={pomodoroStyles.pomoLink} to="/settings">
          {t("pomodoro.settings.link")}
        </Link>
        {error !== null ? <p className={todosStyles.todoError}>{t("pomodoro.error")}</p> : null}
      </aside>
    </section>
  );
}

/** `mm:ss`; the minutes are not capped, so a long custom phase still reads correctly. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);

  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
