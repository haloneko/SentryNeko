/** Pomodoro phase and session types; the phase name mirrors `models/pomodoro.rs`. */

export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

/** Durations in seconds, as the `pomodoro.durations` row stores them. */
export interface PomodoroDurations {
  focusSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
}

/** Shortest and longest phase the settings page offers, in seconds. */
export const MIN_PHASE_SECONDS = 60;
export const MAX_PHASE_SECONDS = 240 * 60;

/** What a phase lasts until the user says otherwise. */
export const DEFAULT_DURATIONS: PomodoroDurations = {
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
};

/**
 * Reads a stored value as the three durations, field by field.
 *
 * The row is the frontend's to check: the backend stores what it is handed, so a duration outside
 * `1..=240` minutes falls back to the default for that phase instead of timing the timer.
 */
export function normalizeDurations(value: unknown): PomodoroDurations {
  if (value === null || typeof value !== "object") {
    return DEFAULT_DURATIONS;
  }

  const stored = value as Partial<Record<keyof PomodoroDurations, unknown>>;

  return {
    focusSeconds: phaseLength(stored.focusSeconds, DEFAULT_DURATIONS.focusSeconds),
    shortBreakSeconds: phaseLength(
      stored.shortBreakSeconds,
      DEFAULT_DURATIONS.shortBreakSeconds,
    ),
    longBreakSeconds: phaseLength(stored.longBreakSeconds, DEFAULT_DURATIONS.longBreakSeconds),
  };
}

/** One stored duration, or `fallback` when it is not a length the settings page could produce. */
function phaseLength(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PHASE_SECONDS &&
    value <= MAX_PHASE_SECONDS
    ? value
    : fallback;
}

/** The stretch the backend is timing; mirrors `Running` in `models/pomodoro.rs`. */
export interface RunningPomodoro {
  phase: PomodoroPhase;
  /** UTC epoch seconds. */
  startedAt: number;
  plannedSeconds: number;
}

/** Every phase, in the order the segmented control shows them. */
export const POMODORO_PHASES = [
  "focus",
  "shortBreak",
  "longBreak",
] as const satisfies readonly PomodoroPhase[];

/** The key of `PomodoroDurations` that holds the length of one phase. */
const DURATION_KEYS: Record<PomodoroPhase, keyof PomodoroDurations> = {
  focus: "focusSeconds",
  shortBreak: "shortBreakSeconds",
  longBreak: "longBreakSeconds",
};

/** How long one phase lasts, in seconds. */
export function phaseSeconds(durations: PomodoroDurations, phase: PomodoroPhase): number {
  return durations[DURATION_KEYS[phase]];
}

/** Focus phases per cycle before the long break takes over. */
export const PHASES_PER_CYCLE = 4;

/**
 * The phase that follows a finished one: a focus phase leads to a break — long on every fourth —
 * and any break leads back to focus.
 */
export function phaseAfter(phase: PomodoroPhase, finishedFocus: number): PomodoroPhase {
  if (phase !== "focus") {
    return "focus";
  }

  return finishedFocus % PHASES_PER_CYCLE === 0 ? "longBreak" : "shortBreak";
}
