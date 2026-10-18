/** Settings page for persisted appearance, task, timer and system preferences. */

import { useEffect } from "react";
import type { ReactNode } from "react";

import { AlarmDefaultsSettings } from "../components/AlarmDefaultsSettings";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { AutostartSettings } from "../components/AutostartSettings";
import { DashboardLayoutSettings } from "../components/DashboardLayoutSettings";
import { FontSettings } from "../components/FontSettings";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PomodoroSettings } from "../components/PomodoroSettings";
import { SidebarLayoutSettings } from "../components/SidebarLayoutSettings";
import { TodoDisplaySettings } from "../components/TodoDisplaySettings";
import { useI18n } from "../hooks/useI18n";
import { usePomodoro } from "../hooks/usePomodoro";

interface SettingsRowProps {
  /** Two-digit ordinal shown above the title, so the page reads as one list. */
  index: string;
  title: string;
  /** One line saying what the row changes. */
  hint: string;
  children: ReactNode;
}

/** One numbered row: the label sits in a rail, the controls stand beside it. */
function SettingsRow({ children, hint, index, title }: SettingsRowProps) {
  return (
    <section className="settings-row">
      <div className="settings-lead">
        <span className="settings-index">{index}</span>
        <h2>{title}</h2>
        <p className="settings-hint">{hint}</p>
      </div>
      <div className="settings-body">{children}</div>
    </section>
  );
}

/** Renders the settings the app persists. */
export function SettingsPage() {
  const { t } = useI18n();
  const { load } = usePomodoro();

  // Read here as well, so the form shows the stored values without opening the timer first.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>{t("nav.settings")}</h1>
      <div className="settings">
        <SettingsRow hint={t("appearance.hint")} index="01" title={t("appearance.title")}>
          <AppearanceSettings />
        </SettingsRow>
        <SettingsRow hint={t("font.hint")} index="02" title={t("font.title")}>
          <FontSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.language.hint")} index="03" title={t("language.label")}>
          <LanguageSwitcher />
        </SettingsRow>
        <SettingsRow
          hint={t("settings.pomodoro.hint")}
          index="04"
          title={t("pomodoro.settings.title")}
        >
          <PomodoroSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.alarm.hint")} index="05" title={t("alarm.settings.title")}>
          <AlarmDefaultsSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.autostart.hint")} index="06" title={t("autostart.title")}>
          <AutostartSettings />
        </SettingsRow>
        <SettingsRow
          hint={t("dashboard.layout.rowHint")}
          index="07"
          title={t("dashboard.layout.title")}
        >
          <DashboardLayoutSettings />
        </SettingsRow>
        <SettingsRow hint={t("todo.display.hint")} index="08" title={t("todo.display.title")}>
          <TodoDisplaySettings />
        </SettingsRow>
        <SettingsRow hint={t("sidebar.hint")} index="09" title={t("sidebar.title")}>
          <SidebarLayoutSettings />
        </SettingsRow>
      </div>
    </>
  );
}
