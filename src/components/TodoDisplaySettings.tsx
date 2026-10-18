/** Selects the task layout, keeping the current choice if saving fails. */

import { useI18n } from "../hooks/useI18n";
import { useTodoDisplay } from "../hooks/useTodoDisplay";
import { TODO_DISPLAY_MODES } from "../types/todoDisplay";
import { SegmentedControl } from "./ui/SegmentedControl";

export function TodoDisplaySettings() {
  const { t } = useI18n();
  const { mode, saving, error, setMode } = useTodoDisplay();

  return (
    <div className="settings-form" aria-busy={saving}>
      <SegmentedControl
        disabled={saving}
        label={t("todo.display.title")}
        onChange={(next) => void setMode(next)}
        options={TODO_DISPLAY_MODES.map((value) => ({
          label: t(`todo.display.${value}`),
          value,
        }))}
        value={mode}
      />
      <p className="settings-hint">{t(`todo.display.description.${mode}`)}</p>
      {error && (
        <p className="todo-error" role="alert">{t("todo.display.error")}</p>
      )}
    </div>
  );
}
