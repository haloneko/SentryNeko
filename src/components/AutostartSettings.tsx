/** The login-entry switch: Windows starts the app in the tray when the user signs in. */

import { useAutostart } from "../hooks/useAutostart";
import { useI18n } from "../hooks/useI18n";
import settingsStyles from "../pages/Settings/settings.module.css";

/** One switch and the explanation of what it registers. */
export function AutostartSettings() {
  const { t } = useI18n();
  const { enabled, error, loading, setEnabled } = useAutostart();

  return (
    <div className={settingsStyles.autostart}>
      <label className="switch">
        <input
          checked={enabled}
          disabled={loading}
          onChange={(event) => {
            void setEnabled(event.target.checked);
          }}
          type="checkbox"
        />
        <span aria-hidden="true" className="switch-track" />
        <span className="switch-label">{t("autostart.toggle")}</span>
      </label>
      {error !== null ? <p className="error">{t("autostart.error")}</p> : null}
    </div>
  );
}
