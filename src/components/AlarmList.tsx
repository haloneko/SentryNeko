/** Alarm rows: time, repeat days, the on/off switch and the row actions. */

import type { TFunction } from "i18next";

import { useI18n } from "../hooks/useI18n";
import { ALL_DAYS, clockTime, isOneOff, maskDays } from "../types/alarm";
import type { Alarm } from "../types/alarm";
import alarmsStyles from "../pages/Alarms/alarms.module.css";
import todosStyles from "../pages/Todos/todos.module.css";

export interface AlarmListProps {
  alarms: readonly Alarm[];
  onDelete: (alarm: Alarm) => void;
  onEdit: (alarm: Alarm) => void;
  onToggle: (alarm: Alarm, enabled: boolean) => void;
}

/** How the repeat days of one alarm read: once, every day, or the days themselves. */
function repeatCopy(alarm: Alarm, t: TFunction): string {
  if (isOneOff(alarm)) {
    return t("alarm.repeat.once");
  }

  if (alarm.repeatDays === ALL_DAYS) {
    return t("alarm.repeat.every");
  }

  return maskDays(alarm.repeatDays)
    .map((day) => t(`alarm.weekday.${day}`))
    .join(", ");
}

/** Lists the alarms; an empty list says so instead of showing a bare table. */
export function AlarmList({ alarms, onDelete, onEdit, onToggle }: AlarmListProps) {
  const { t } = useI18n();

  if (alarms.length === 0) {
    return (
      <div className="empty">
        <p>{t("alarm.empty")}</p>
      </div>
    );
  }

  return (
    <ul className={alarmsStyles.alarmList}>
      {alarms.map((alarm) => (
        <li className={alarmsStyles.alarmItem} data-enabled={alarm.enabled} key={alarm.id}>
          <span className={alarmsStyles.alarmClock}>{clockTime(alarm.hour, alarm.minute)}</span>
          <span className={alarmsStyles.alarmBody}>
            <span className={alarmsStyles.alarmLabel}>
              {alarm.label === "" ? t("alarm.untitled") : alarm.label}
            </span>
            <span className={alarmsStyles.alarmRepeat}>{repeatCopy(alarm, t)}</span>
          </span>
          <input
            aria-label={t("alarm.toggle")}
            checked={alarm.enabled}
            className={todosStyles.todoCheck}
            onChange={() => {
              onToggle(alarm, !alarm.enabled);
            }}
            type="checkbox"
          />
          <button
            aria-label={t("alarm.edit")}
            className={alarmsStyles.alarmAction}
            onClick={() => {
              onEdit(alarm);
            }}
            title={t("alarm.edit")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12">
              <path d="M8 1.5l2.5 2.5M1 11l.6-3.1L8.4.7l2.9 2.9L4.5 10.4z" />
            </svg>
          </button>
          <button
            aria-label={t("alarm.delete")}
            className="todo-delete"
            onClick={() => {
              onDelete(alarm);
            }}
            title={t("alarm.delete")}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
