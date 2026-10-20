/** Ring duration and notification method, saved as they change and inherited by every alarm. */

import { useEffect, useState } from "react";

import { useAlarmDefaults } from "../hooks/useAlarmDefaults";
import { useI18n } from "../hooks/useI18n";
import {
  MAX_RING_SECONDS,
  METHOD_LABELS,
  MIN_RING_SECONDS,
  NOTIFICATION_METHODS,
} from "../types/alarm";
import type { NotificationMethod } from "../types/alarm";
import { NumericInput } from "./ui/NumericInput";
import { SegmentedControl } from "./ui/SegmentedControl";
import settingsStyles from "../pages/Settings/settings.module.css";
import todosStyles from "../pages/Todos/todos.module.css";

/** Wait after the last keystroke, so typing `10` writes once. */
const SAVE_DELAY_MS = 600;

/** How long the "saved" note stays after a write. */
const SAVED_NOTE_MS = 2_000;

/** One duration field and the method switch; both write straight through. */
export function AlarmDefaultsSettings() {
  const { t } = useI18n();
  const { defaults, error, loading, save } = useAlarmDefaults();
  const [seconds, setSeconds] = useState(defaults.ringSeconds);
  const [method, setMethod] = useState<NotificationMethod>(defaults.method);
  const [saved, setSaved] = useState(false);

  // The stored values land after the first render; every save answers with the stored row too.
  useEffect(() => {
    setSeconds(defaults.ringSeconds);
    setMethod(defaults.method);
  }, [defaults]);

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

  const stored = seconds === defaults.ringSeconds && method === defaults.method;

  const write = (): void => {
    if (loading || stored) {
      return;
    }

    void save({ method, ringSeconds: seconds }).then((result) => {
      setSaved(result !== null);
    });
  };

  useEffect(() => {
    if (loading || stored) {
      return;
    }

    const timer = window.setTimeout(write, SAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [seconds, method, loading, stored, save]);

  return (
    <div className={settingsStyles.settingsForm}>
      <div className={settingsStyles.settingsPair}>
        <div className={settingsStyles.setField}>
          <label htmlFor="alarm-ring-seconds">{t("alarm.settings.ring")}</label>
          <NumericInput
            decreaseLabel={t("numericInput.decrease", { label: t("alarm.settings.ring") })}
            disabled={loading}
            id="alarm-ring-seconds"
            increaseLabel={t("numericInput.increase", { label: t("alarm.settings.ring") })}
            max={MAX_RING_SECONDS}
            min={MIN_RING_SECONDS}
            onBlur={write}
            onChange={(value) => {
              setSaved(false);
              setSeconds(value);
            }}
            value={seconds}
          />
        </div>
        <div className={settingsStyles.setField}>
          <span>{t("alarm.settings.method")}</span>
          <SegmentedControl
            label={t("alarm.settings.method")}
            onChange={(value) => {
              setSaved(false);
              setMethod(value);
            }}
            options={NOTIFICATION_METHODS.map((value) => ({
              label: t(METHOD_LABELS[value]),
              value,
            }))}
            value={method}
          />
        </div>
      </div>
      {error !== null || saved ? (
        <p className={settingsStyles.settingsStatus}>
          {error !== null ? (
            <span className={todosStyles.todoError}>{t("alarm.settings.error")}</span>
          ) : null}
          {error === null && saved ? (
            <span className="muted">{t("alarm.settings.saved")}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
