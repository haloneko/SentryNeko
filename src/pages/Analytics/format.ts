/** Analytics formatting: the durations every block of the page reads out. */

import type { TFunction } from "i18next";

/** Hours are only shown once there are any, so a short span reads as plain minutes. */
export function formatDuration(seconds: number, t: TFunction): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  return hours > 0
    ? t("analytics.duration.hours", { hours, minutes })
    : t("analytics.duration.minutes", { minutes });
}
