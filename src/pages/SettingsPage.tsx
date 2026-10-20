/** Settings page: the appearance, language, pomodoro durations, alarm defaults and auto-start. */

import { useEffect } from "react";
import type { ReactNode } from "react";

import { AlarmDefaultsSettings } from "../components/AlarmDefaultsSettings";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { AutostartSettings } from "../components/AutostartSettings";
import { DashboardLayoutSettings } from "../components/DashboardLayoutSettings";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PomodoroSettings } from "../components/PomodoroSettings";
import { SidebarLayoutSettings } from "../components/SidebarLayoutSettings";
import { useI18n } from "../hooks/useI18n";
import { usePomodoro } from "../hooks/usePomodoro";
import settingsStyles from "./Settings/settings.module.css";

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
    <section className={settingsStyles.settingsRow}>
      <div className={settingsStyles.settingsLead}>
        <span className={settingsStyles.settingsIndex}>{index}</span>
        <h2>{title}</h2>
        <p className="settings-hint">{hint}</p>
      </div>
      <div className={settingsStyles.settingsBody}>{children}</div>
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
      <div className={settingsStyles.settings}>
        <SettingsRow hint={t("appearance.hint")} index="01" title={t("appearance.title")}>
          <AppearanceSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.language.hint")} index="02" title={t("language.label")}>
          <LanguageSwitcher />
        </SettingsRow>
        <SettingsRow
          hint={t("settings.pomodoro.hint")}
          index="03"
          title={t("pomodoro.settings.title")}
        >
          <PomodoroSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.alarm.hint")} index="04" title={t("alarm.settings.title")}>
          <AlarmDefaultsSettings />
        </SettingsRow>
        <SettingsRow hint={t("settings.autostart.hint")} index="05" title={t("autostart.title")}>
          <AutostartSettings />
        </SettingsRow>
        <SettingsRow
          hint={t("dashboard.layout.rowHint")}
          index="06"
          title={t("dashboard.layout.title")}
        >
          <DashboardLayoutSettings />
        </SettingsRow>
        <SettingsRow hint={t("sidebar.hint")} index="07" title={t("sidebar.title")}>
          <SidebarLayoutSettings />
        </SettingsRow>
      </div>
    </>
  );
}
