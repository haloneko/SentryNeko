/** Custom window title bar: the drag area plus minimize, maximize or restore, and close. */

import { useI18n } from "../hooks/useI18n";
import { useWindowControls } from "../hooks/useWindowControls";
import appStyles from "../App.module.css";

/** Replaces the system decorations: drag strip plus the three window buttons. */
export function TitleBar() {
  const { t } = useI18n();
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <header className={appStyles.titlebar} data-tauri-drag-region>
      <div className={appStyles.titlebarControls}>
        <button
          aria-label={t("window.minimize")}
          className={appStyles.titlebarButton}
          onClick={minimize}
          title={t("window.minimize")}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 10 10">
            <path d="M1 5h8" />
          </svg>
        </button>
        <button
          aria-label={maximized ? t("window.restore") : t("window.maximize")}
          className={appStyles.titlebarButton}
          onClick={toggleMaximize}
          title={maximized ? t("window.restore") : t("window.maximize")}
          type="button"
        >
          {maximized ? (
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <path d="M3 3V1h6v6H7" />
              <rect height="6" width="6" x="1" y="3" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 10 10">
              <rect height="8" width="8" x="1" y="1" />
            </svg>
          )}
        </button>
        <button
          aria-label={t("window.close")}
          className={appStyles.titlebarButton}
          data-kind="close"
          onClick={close}
          title={t("window.close")}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
    </header>
  );
}
