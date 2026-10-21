/** Pomodoro state store: the running phase, its durations and the stretch the backend times. */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";

import { isOk } from "../types";
import type { ApiCode, ApiResponse, NotificationOutcome } from "../types";
import type { PomodoroDurations, PomodoroPhase, RunningPomodoro } from "../types/pomodoro";
import {
  DEFAULT_DURATIONS,
  normalizeDurations,
  phaseAfter,
  phaseSeconds,
} from "../types/pomodoro";
import { parseSetting, SETTINGS } from "../types/setting";
import type { Setting } from "../types/setting";

/** The row this store reads its durations from; the backend stores it as sent. */
const { category: DURATIONS_CATEGORY, key: DURATIONS_KEY } = SETTINGS.pomodoroDurations;

export interface PomodoroState {
  phase: PomodoroPhase;
  durations: PomodoroDurations;
  /** Epoch milliseconds the running phase ends at; `null` while paused or idle. */
  endsAt: number | null;
  /** Milliseconds left, kept current by `tick`. */
  remainingMs: number;
  /** Whether the backend holds the running stretch; `false` while idle or paused. */
  active: boolean;
  /** Focus phases finished since the app started, which decides when a long break comes. */
  focusCount: number;
  loading: boolean;
  /** Code of the last failed call, `null` while everything is fine. */
  error: ApiCode | null;
  load: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  reset: () => Promise<void>;
  /** Jumps to a phase by hand; a running phase is closed with the time it already spent. */
  selectPhase: (phase: PomodoroPhase) => Promise<void>;
  saveDurations: (durations: PomodoroDurations) => Promise<boolean>;
  /** Advances the clock; the page calls it on an interval, so render throttling cannot drift it. */
  tick: (now: number) => Promise<void>;
}

/** Runs a command, answering `UNSUPPORTED` outside Tauri so the UI can react the same way. */
async function request<T>(command: string, args: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
  if (!isTauri()) {
    return { code: "UNSUPPORTED", message: command, details: null, data: null };
  }

  return invoke<ApiResponse<T>>(command, args);
}

/**
 * Stops the stretch the backend is timing; answers the code of a failed call, `null` when it
 * worked. The command answers nothing, so there is no payload to narrow.
 */
async function stopStretch(): Promise<ApiCode | null> {
  const response = await request<unknown>("stop_pomodoro_session");

  return response.code === "OK" ? null : response.code;
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
  active: false,
  focusCount: 0,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });

    // An absent key answers `null` in `data`, which `parseSetting` reads as "use the defaults".
    const [response, running] = await Promise.all([
      request<Setting>("get_setting", { key: DURATIONS_KEY }),
      request<RunningPomodoro | null>("get_running_pomodoro_session"),
    ]);

    if (!isOk(response)) {
      set({ loading: false, error: response.code });
      return;
    }

    // The row is the frontend's to check: a duration nobody could have entered falls back.
    const durations = normalizeDurations(parseSetting<unknown>(response.data, null));
    const { endsAt, phase, remainingMs, active } = get();
    const idle = endsAt === null && !active;
    let failure: ApiCode | null = null;

    // A window that opens again finds the stretch the backend kept: the clock is rebuilt from the
    // stretch's own timestamps, so reloading the window does not lose the phase.
    if (idle && isOk(running) && running.data !== null) {
      const stretch = running.data;
      const left = (stretch.startedAt + stretch.plannedSeconds) * 1000 - Date.now();

      if (left > 0) {
        set({
          active: true,
          durations,
          endsAt: Date.now() + left,
          loading: false,
          phase: stretch.phase,
          remainingMs: left,
        });
        startTicker();
        return;
      }

      // The phase ran out while the window was away: the backend settles it at its own end.
      failure = await stopStretch();
    }

    set({
      active: false,
      durations,
      error: failure,
      loading: false,
      remainingMs: idle ? phaseSeconds(durations, phase) * 1000 : remainingMs,
    });
  },

  start: async () => {
    const { endsAt, phase, remainingMs } = get();

    if (endsAt !== null) {
      return;
    }

    set({ error: null });

    // A pause stopped the previous stretch, so starting again opens a new one holding what is left
    // of the phase; a stretch is never resumed in place.
    const response = await request<RunningPomodoro>("start_pomodoro_session", {
      phase,
      plannedSeconds: Math.max(1, Math.round(remainingMs / 1000)),
    });

    if (!isOk(response)) {
      set({ error: response.code });
      return;
    }

    set({ active: true, endsAt: Date.now() + get().remainingMs });
    startTicker();
  },

  pause: async () => {
    const { endsAt, active } = get();

    if (endsAt === null) {
      return;
    }

    set({
      active: false,
      endsAt: null,
      error: null,
      remainingMs: Math.max(0, endsAt - Date.now()),
    });
    stopTicker();

    if (!active) {
      return;
    }

    // Stopping the stretch is what stops the minute tick from counting this phase.
    const failure = await stopStretch();

    if (failure !== null) {
      set({ error: failure });
    }
  },

  reset: async () => {
    const { durations, phase, active } = get();
    const totalMs = phaseSeconds(durations, phase) * 1000;

    set({ active: false, error: null, endsAt: null, remainingMs: totalMs });
    stopTicker();

    if (!active) {
      return;
    }

    const failure = await stopStretch();

    if (failure !== null) {
      set({ error: failure });
    }
  },

  selectPhase: async (phase) => {
    const { durations, phase: current, active } = get();

    if (phase === current) {
      return;
    }

    // The chosen phase starts from its full length; a running one is closed where it stands.
    set({
      active: false,
      endsAt: null,
      error: null,
      phase,
      remainingMs: phaseSeconds(durations, phase) * 1000,
    });
    stopTicker();

    if (!active) {
      return;
    }

    const failure = await stopStretch();

    if (failure !== null) {
      set({ error: failure });
    }
  },

  saveDurations: async (durations) => {
    set({ error: null });

    // The backend stores what it is handed, so the store is where a length is checked: what goes
    // into the row is what came out of the settings page, clamped to a phase it could produce.
    const next = normalizeDurations(durations);
    const response = await request<Setting>("set_setting", {
      key: DURATIONS_KEY,
      value: JSON.stringify(next),
      category: DURATIONS_CATEGORY,
    });

    if (!isOk(response)) {
      set({ error: response.code });
      return false;
    }

    // The echo is what is now in force; normalizing it keeps the clock on a usable length.
    const saved = normalizeDurations(parseSetting<unknown>(response.data, next));
    const { endsAt, phase, active } = get();
    const idle = endsAt === null && !active;

    set({
      durations: saved,
      remainingMs: idle ? phaseSeconds(saved, phase) * 1000 : get().remainingMs,
    });

    return true;
  },

  tick: async (now) => {
    const { active, endsAt } = get();

    if (endsAt === null) {
      return;
    }

    const left = endsAt - now;

    if (left > 0) {
      set({ remainingMs: left });
      return;
    }

    // Cleared before the first await, so the next tick of the interval cannot run this twice.
    set({ active: false, endsAt: null, remainingMs: 0 });

    const { durations, focusCount, phase } = get();
    const finishedFocus = phase === "focus" ? focusCount + 1 : focusCount;
    const next = phaseAfter(phase, finishedFocus);
    const nextMs = phaseSeconds(durations, next) * 1000;
    let failure: ApiCode | null = null;

    // The phase ran to its end, so the backend settles the stretch there.
    if (active) {
      failure = await stopStretch();
    }

    const notified = await request<NotificationOutcome>("notify_pomodoro_phase", { phase });

    if (!isOk(notified) && failure === null) {
      failure = notified.code;
    }

    // A reset, a phase pick or a fresh start while the calls were in flight wins over the
    // hand-over: each of them moves either the clock or the remaining time off the state this
    // tick left behind.
    if (get().endsAt !== null || get().remainingMs !== 0) {
      return;
    }

    // The next phase opens its own stretch and starts running, so nobody has to press anything.
    const started = await request<RunningPomodoro>("start_pomodoro_session", {
      phase: next,
      plannedSeconds: Math.max(1, Math.round(nextMs / 1000)),
    });

    if (!isOk(started)) {
      set({
        active: false,
        error: failure ?? started.code,
        focusCount: finishedFocus,
        phase: next,
        remainingMs: nextMs,
      });
      stopTicker();
      return;
    }

    set({
      active: true,
      endsAt: Date.now() + nextMs,
      error: failure,
      focusCount: finishedFocus,
      phase: next,
      remainingMs: nextMs,
    });
  },
}));
