/** Alarms page: the list, and one form that adds a new alarm or edits the chosen one. */

import { useState } from "react";
import type { FormEvent } from "react";

import { AlarmList } from "../components/AlarmList";
import { useAlarmDefaults } from "../hooks/useAlarmDefaults";
import { useAlarms } from "../hooks/useAlarms";
import { useI18n } from "../hooks/useI18n";
import { BACKEND_EVENTS, useTauriEvent } from "../hooks/useTauriEvent";
import {
  METHOD_LABELS,
  WEEKDAYS,
  clockTime,
  defaultTime,
  maskDays,
  maskOf,
  parseClock,
  toggleDay,
} from "../types/alarm";
import type { Alarm, AlarmDraft, Weekday } from "../types/alarm";
import alarmsStyles from "./Alarms/alarms.module.css";

/** Renders the form, then the alarms it maintains. */
export function AlarmsPage() {
  const { t } = useI18n();
  const { add, alarms, error, loading, refresh, remove, setEnabled, update } = useAlarms();
  const { defaults } = useAlarmDefaults();
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [time, setTime] = useState<string>(defaultTime);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<readonly Weekday[]>([]);
  const [saving, setSaving] = useState(false);

  // A one-off switches itself off when it rings, so the row the backend pushes changes the list.
  useTauriEvent<Alarm>(BACKEND_EVENTS.alarmTriggered, () => {
    void refresh();
  });

  const parsed = parseClock(time);
  const draft: AlarmDraft | null =
    parsed === null ? null : { label, minute: parsed.minute, hour: parsed.hour, repeatDays: maskOf(days) };

  const reset = () => {
    setEditing(null);
    setTime(defaultTime());
    setLabel("");
    setDays([]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (draft === null || saving) {
      return;
    }

    setSaving(true);
    const stored = editing === null ? await add(draft) : await update(editing.id, draft);
    setSaving(false);

    if (stored) {
      reset();
    }
  };

  const startEdit = (alarm: Alarm) => {
    setEditing(alarm);
    setTime(clockTime(alarm.hour, alarm.minute));
    setLabel(alarm.label);
    setDays(maskDays(alarm.repeatDays));
  };

  return (
    <>
      <h1>{t("nav.alarms")}</h1>
      <form
        className={alarmsStyles.alarmForm}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className={alarmsStyles.alarmFields}>
          <label className={alarmsStyles.alarmField}>
            <span>{t("alarm.time")}</span>
            <input
              onChange={(event) => {
                setTime(event.target.value);
              }}
              required
              type="time"
              value={time}
            />
          </label>
          <label className={`${alarmsStyles.alarmField} ${alarmsStyles.alarmFieldGrow}`}>
            <span>{t("alarm.label")}</span>
            <input
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              placeholder={t("alarm.labelPlaceholder")}
              type="text"
              value={label}
            />
          </label>
        </div>
        <fieldset className={alarmsStyles.alarmDays}>
          <legend>{t("alarm.repeat.label")}</legend>
          {WEEKDAYS.map((day) => (
            <button
              aria-pressed={days.includes(day)}
              className={alarmsStyles.alarmDay}
              key={day}
              onClick={() => {
                setDays(toggleDay(days, day));
              }}
              type="button"
            >
              {t(`alarm.weekday.${day}`)}
            </button>
          ))}
          {days.length === 0 ? (
            <span className={alarmsStyles.alarmHint}>{t("alarm.repeat.once")}</span>
          ) : null}
        </fieldset>
        <div className={alarmsStyles.alarmFormActions}>
          <button
            className="btn pomodoro-primary"
            disabled={draft === null || saving}
            type="submit"
          >
            {editing === null ? t("alarm.add") : t("alarm.save")}
          </button>
          {editing === null ? null : (
            <button className="btn" onClick={reset} type="button">
              {t("alarm.cancel")}
            </button>
          )}
        </div>
      </form>

      <p className={alarmsStyles.alarmHint}>
        {t("alarm.inherits", {
          method: t(METHOD_LABELS[defaults.method]),
          seconds: defaults.ringSeconds,
        })}
      </p>

      {loading ? <p className="muted">{t("alarm.loading")}</p> : null}
      {error !== null ? <p className="error">{t("alarm.error")}</p> : null}
      {!loading && error === null ? (
        <AlarmList
          alarms={alarms}
          onDelete={(alarm) => {
            void remove(alarm.id);
          }}
          onEdit={startEdit}
          onToggle={(alarm, enabled) => {
            void setEnabled(alarm, enabled);
          }}
        />
      ) : null}
    </>
  );
}
