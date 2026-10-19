/** Pomodoro state store: the running phase, its durations and the session row behind it. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { isOk } from "../types";
import type { ApiCode, ApiResponse, NotificationOutcome } from "../types";
import type { PomodoroDurations, PomodoroPhase, PomodoroSession } from "../types/pomodoro";
import { phaseAfter, phaseSeconds } from "../types/pomodoro";
import { parseSetting, POMODORO_DURATIONS_KEY } from "../types/setting";
import type { Setting } from "../types/setting";

export interface PomodoroState {
  phase: PomodoroPhase;
  durations: PomodoroDurations;
  /** Epoch milliseconds the running phase ends at; `null` while paused or idle. */
  endsAt: number | null;
  /** Milliseconds left, kept current by `tick`. */
  remainingMs: number;
  /** Row backing the running phase; `null` while nothing is running. */
  sessionId: number | null;
  /** Focus phases finished since the app started, which decides when a long break comes. */
  focusCount: number;
  loading: boolean;
  /** Code of the last failed call, `null` while everything is fine. */
  error: ApiCode | null;
  load: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
  reset: () => Promise<void>;
  /** Jumps to a phase by hand; a running phase is closed with the time it already spent. */
  selectPhase: (phase: PomodoroPhase) => Promise<void>;
  saveDurations: (durations: PomodoroDurations) => Promise<boolean>;
  /** Advances the clock; the page calls it on an interval, so render throttling cannot drift it. */
  tick: (now: number) => Promise<void>;
}

/** Applied until the stored durations arrive, so the clock never starts at zero. */
const DEFAULT_DURATIONS: PomodoroDurations = {
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
};

/** Runs a command, answering `UNSUPPORTED` outside Tauri so the UI can react the same way. */
async function request<T>(command: string, args: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  return invoke<ApiResponse<T>>(command, args);
}

/** How often the clock is sampled; the remaining time comes from the timestamp, not the ticks. */
const TICK_INTERVAL_MS = 250;

let ticker: number | null = null;

/**
 * Runs the clock outside React: the countdown keeps going while another page is mounted, so a
 * finished phase still notifies and hands over to the next one.
 */
function startTicker(): void {
  if (ticker !== null) {
    return;
  }

  ticker = window.setInterval(() => {
    const state = usePomodoroStore.getState();

    if (state.endsAt === null) {
      stopTicker();
      return;
    }

    void state.tick(Date.now());
  }, TICK_INTERVAL_MS);
}

function stopTicker(): void {
  if (ticker === null) {
    return;
  }

  window.clearInterval(ticker);
  ticker = null;
}

export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  phase: "focus",
  durations: DEFAULT_DURATIONS,
  endsAt: null,
  remainingMs: DEFAULT_DURATIONS.focusSeconds * 1000,
  sessionId: null,
  focusCount: 0,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });

    // An absent key answers `null` in `data`, which `parseSetting` reads as "use the defaults".
    const response = await request<Setting>("get_setting", { key: POMODORO_DURATIONS_KEY });

    if (!isOk(response)) {
      set({ loading: false, error: response.code });
      return;
    }

    const durations = parseSetting(response.data, DEFAULT_DURATIONS);
    const { endsAt, phase, remainingMs, sessionId } = get();
    const idle = endsAt === null && sessionId === null;

    set({
      durations,
      loading: false,
      remainingMs: idle ? phaseSeconds(durations, phase) * 1000 : remainingMs,
    });
  },

  start: async () => {
    const { endsAt, phase, remainingMs, sessionId } = get();

    if (endsAt !== null) {
      return;
    }

    set({ error: null });

    let id = sessionId;

    if (id === null) {
      // The row is opened once per phase, so a pause and a resume stay inside the same session.
      const response = await request<PomodoroSession>("start_pomodoro_session", {
        phase,
        plannedSeconds: Math.max(1, Math.round(remainingMs / 1000)),
      });

      if (!isOk(response)) {
        set({ error: response.code });
        return;
      }

      id = response.data.id;
    }

    set({ endsAt: Date.now() + get().remainingMs, sessionId: id });
    startTicker();
  },

  pause: () => {
    const { endsAt } = get();

    if (endsAt === null) {
      return;
    }

    set({ endsAt: null, remainingMs: Math.max(0, endsAt - Date.now()) });
    stopTicker();
  },

  reset: async () => {
    const { durations, phase, remainingMs, sessionId } = get();
    const totalMs = phaseSeconds(durations, phase) * 1000;
    const spent = Math.max(0, Math.round((totalMs - remainingMs) / 1000));

    set({ error: null, endsAt: null, remainingMs: totalMs });
    stopTicker();

    if (sessionId === null) {
      return;
    }

    set({ sessionId: null });

    const response = await request<PomodoroSession>("finish_pomodoro_session", {
      actualSeconds: spent,
      id: sessionId,
    });

    if (!isOk(response)) {
      set({ error: response.code });
    }
  },

  selectPhase: async (phase) => {
    const { durations, endsAt, phase: current, remainingMs, sessionId } = get();

    if (phase === current) {
      return;
    }

    const totalMs = phaseSeconds(durations, current) * 1000;
    const left = endsAt === null ? remainingMs : Math.max(0, endsAt - Date.now());
    const spent = Math.max(0, Math.round((totalMs - left) / 1000));

    // The chosen phase starts from its full length; a running one is closed with what it spent.
    set({
      endsAt: null,
      error: null,
      phase,
      remainingMs: phaseSeconds(durations, phase) * 1000,
      sessionId: null,
    });
    stopTicker();

    if (sessionId === null) {
      return;
    }

    const response = await request<PomodoroSession>("finish_pomodoro_session", {
      actualSeconds: spent,
      id: sessionId,
    });

    if (!isOk(response)) {
      set({ error: response.code });
    }
  },

  saveDurations: async (durations) => {
    set({ error: null });

    const response = await request<Setting>("set_setting", {
      key: POMODORO_DURATIONS_KEY,
      value: JSON.stringify(durations),
    });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    // The backend validates the durations, so the echo is the value actually in force.
    const saved = parseSetting(response.data, durations);
    const { endsAt, phase, sessionId } = get();
    const idle = endsAt === null && sessionId === null;

    set({
      durations: saved,
      remainingMs: idle ? phaseSeconds(saved, phase) * 1000 : get().remainingMs,
    });

    return true;
  },

  tick: async (now) => {
    const { endsAt } = get();

    if (endsAt === null) {
      return;
    }

    const left = endsAt - now;

    if (left > 0) {
      set({ remainingMs: left });
      return;
    }

    // Cleared before the first await, so the next tick of the interval cannot run this twice.
    set({ endsAt: null, remainingMs: 0 });

    const { durations, focusCount, phase, sessionId } = get();
    const finishedFocus = phase === "focus" ? focusCount + 1 : focusCount;
    const next = phaseAfter(phase, finishedFocus);
    const nextMs = phaseSeconds(durations, next) * 1000;
    let failure: ApiCode | null = null;

    // The phase ran to its end, so the stored row records the full planned length.
    if (sessionId !== null) {
      const response = await request<PomodoroSession>("finish_pomodoro_session", {
        actualSeconds: phaseSeconds(durations, phase),
        id: sessionId,
      });

      if (!isOk(response)) {
        failure = response.code;
      }
    }

    const notified = await request<NotificationOutcome>("notify_pomodoro_phase", { phase });

    if (!isOk(notified) && failure === null) {
      failure = notified.code;
    }

    // A reset or a phase pick while the calls were in flight wins over the hand-over.
    if (get().sessionId !== sessionId) {
      return;
    }

    // The next phase opens its own row and starts running, so nobody has to press anything.
    const started = await request<PomodoroSession>("start_pomodoro_session", {
      phase: next,
      plannedSeconds: Math.max(1, Math.round(nextMs / 1000)),
    });

    if (!isOk(started)) {
      set({
        error: failure ?? started.code,
        focusCount: finishedFocus,
        phase: next,
        remainingMs: nextMs,
      });
      stopTicker();
      return;
    }

    set({
      endsAt: Date.now() + nextMs,
      error: failure,
      focusCount: finishedFocus,
      phase: next,
      remainingMs: nextMs,
      sessionId: started.data.id,
    });
  },
}));
