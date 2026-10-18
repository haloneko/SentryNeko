/** Typography shared with the backend's `models::font::FontSettings`. */

export interface FontSettings {
  /** `null` uses the system UI stack; JetBrains Mono is bundled. */
  family: string | null;
  size: number;
}

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;
export const BUNDLED_FONT_FAMILY = "JetBrains Mono";
export const DEFAULT_FONT_SETTINGS: FontSettings = { family: null, size: 14 };

/** Validate local storage and IPC data before turning either into CSS. */
export function isFontSettings(value: unknown): value is FontSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const { family, size } = value as Record<string, unknown>;

  return (
    typeof size === "number" &&
    Number.isInteger(size) &&
    size >= MIN_FONT_SIZE &&
    size <= MAX_FONT_SIZE &&
    (family === null ||
      (typeof family === "string" &&
        family.length > 0 &&
        family.trim() === family &&
        [...family].length <= 128 &&
        !/\p{Cc}/u.test(family)))
  );
}
