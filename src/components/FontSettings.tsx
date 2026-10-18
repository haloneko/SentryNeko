/** Built-in and installed font choices, with a live base-size control. */

import { useId } from "react";

import { useFontSettings } from "../hooks/useFontSettings";
import { useI18n } from "../hooks/useI18n";
import { BUNDLED_FONT_FAMILY, MAX_FONT_SIZE, MIN_FONT_SIZE } from "../types/font";
import { NumericInput } from "./ui/NumericInput";

export function FontSettings() {
  const { t } = useI18n();
  const { families, fontsError, loading, settings, status, update } = useFontSettings();
  const id = useId();
  const systemFamilies = families.filter((family) => family !== BUNDLED_FONT_FAMILY);

  // Keep a saved family selectable if it has since been uninstalled or enumeration failed.
  if (
    settings.family &&
    settings.family !== BUNDLED_FONT_FAMILY &&
    !systemFamilies.includes(settings.family)
  ) {
    systemFamilies.unshift(settings.family);
  }

  return (
    <div className="settings-form font-settings">
      <div className="font-settings-fields">
        <div className="set-field">
          <label htmlFor={`${id}-family`}>{t("font.family")}</label>
          <select
            id={`${id}-family`}
            onChange={(event) => void update({ family: event.target.value || null })}
            value={settings.family ?? ""}
          >
            <optgroup label={t("font.builtIn")}>
              <option value={BUNDLED_FONT_FAMILY}>{BUNDLED_FONT_FAMILY}</option>
            </optgroup>
            <optgroup label={t("font.systemFonts")}>
              <option value="">{t("font.systemDefault")}</option>
              {systemFamilies.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="set-field">
          <label htmlFor={`${id}-size`}>{t("font.size")}</label>
          <NumericInput
            decreaseLabel={t("font.decrease")}
            aria-describedby={`${id}-range`}
            id={`${id}-size`}
            increaseLabel={t("font.increase")}
            max={MAX_FONT_SIZE}
            min={MIN_FONT_SIZE}
            onChange={(size) => void update({ size })}
            value={settings.size}
          />
        </div>
      </div>
      <p className="settings-hint" id={`${id}-range`}>
        {t("font.range", { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE })}
      </p>
      <div aria-live="polite" className="settings-status" role="status">
        {loading ? <span>{t("font.loading")}</span> : null}
        {fontsError ? <span className="todo-error">{t("font.listError")}</span> : null}
        {status !== "idle" ? (
          <span className={status === "error" ? "todo-error" : undefined}>{t(`font.${status}`)}</span>
        ) : null}
      </div>
    </div>
  );
}
