/** Alarm types: a local time of day plus the weekdays it repeats on. */

/** Weekday abbreviations in mask order: Monday is bit 0, Sunday bit 6. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Every weekday selected; mirrors `models::alarm::ALL_DAYS`. */
export const ALL_DAYS = 0b111_1111;

/** A reminder at a local time of day. */
export interface Alarm {
  id: number;
  /** Free text; empty for an alarm without a name. */
  label: string;
  /** Local hour, `0..=23`. */
  hour: number;
  /** Local minute, `0..=59`. */
  minute: number;
  /** Weekday mask; `0` rings once at the next occurrence instead of repeating. */
  repeatDays: number;
  enabled: boolean;
  createdAt: number;
}

/** What the form and the two write commands carry. */
export interface AlarmDraft {
  label: string;
  hour: number;
  minute: number;
  repeatDays: number;
}

/** How an alarm announces itself; mirrors `models::alarm::Method`. */
export type NotificationMethod = "toast" | "inApp";

/** The methods in the order the settings page offers them. */
export const NOTIFICATION_METHODS = ["toast", "inApp"] as const satisfies
  readonly NotificationMethod[];

/** What an alarm rings with; the shape of the `alarm.defaults` row. */
export interface AlarmDefaults {
  /** How long the tone repeats, in seconds. */
  ringSeconds: number;
  method: NotificationMethod;
}

/** Shortest and longest ring duration the settings page offers, in seconds. */
export const MIN_RING_SECONDS = 1;
export const MAX_RING_SECONDS = 60;

/** The built-in default, shown until the stored one arrives. */
export const DEFAULT_ALARM_DEFAULTS: AlarmDefaults = { method: "toast", ringSeconds: 10 };

/**
 * Reads a stored value as the defaults, field by field.
 *
 * The row is the frontend's to check: the backend stores whatever it is handed, so a duration
 * outside `1..=60` or an unknown method falls back to the default for that field rather than
 * reaching the scheduler.
 */
export function normalizeAlarmDefaults(value: unknown): AlarmDefaults {
  if (value === null || typeof value !== "object") {
    return DEFAULT_ALARM_DEFAULTS;
  }

  const stored = value as Partial<Record<keyof AlarmDefaults, unknown>>;

  return {
    method: NOTIFICATION_METHODS.includes(stored.method as NotificationMethod)
      ? (stored.method as NotificationMethod)
      : DEFAULT_ALARM_DEFAULTS.method,
    ringSeconds: ringSeconds(stored.ringSeconds),
  };
}

/** A whole number of seconds the settings page could have written, or the default. */
function ringSeconds(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RING_SECONDS &&
    value <= MAX_RING_SECONDS
    ? value
    : DEFAULT_ALARM_DEFAULTS.ringSeconds;
}

/** The `t()` key of one notification method. */
export const METHOD_LABELS: Record<NotificationMethod, string> = {
  inApp: "alarm.settings.methodInApp",
  toast: "alarm.settings.methodToast",
};

/** Bit of one weekday in {@link Alarm.repeatDays}. */
export function dayMask(day: Weekday): number {
  return 1 << WEEKDAYS.indexOf(day);
}

/** The weekdays a mask selects, in mask order. */
export function maskDays(mask: number): readonly Weekday[] {
  return WEEKDAYS.filter((day) => (mask & dayMask(day)) !== 0);
}

/** The mask of the weekdays a form has selected. */
export function maskOf(days: readonly Weekday[]): number {
  return days.reduce((mask, day) => mask | dayMask(day), 0);
}

/** Adds or removes one weekday, keeping the mask order. */
export function toggleDay(days: readonly Weekday[], day: Weekday): readonly Weekday[] {
  return days.includes(day) ? days.filter((selected) => selected !== day) : [...days, day];
}

/** Whether the alarm rings once instead of repeating. */
export function isOneOff(alarm: Pick<Alarm, "repeatDays">): boolean {
  return alarm.repeatDays === 0;
}

/** `HH:MM` on the wall clock, which is also what a `time` input reads and writes. */
export function clockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour and minute behind an `HH:MM` value; `null` when it is not a time of day. */
export function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);

  if (match === null) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The next full hour, so a new alarm starts on a time the user is likely to accept. */
export function defaultTime(now = new Date()): string {
  return clockTime((now.getHours() + 1) % 24, 0);
}
