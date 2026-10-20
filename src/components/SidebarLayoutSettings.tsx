/** Sidebar layout entry; the modal owns all editing controls. */
import { useCallback, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { useSidebarLayoutStore } from "../stores/sidebarLayoutStore";
import { ActionIcon } from "./ui/ActionIcon";
import { SidebarLayoutEditor } from "./SidebarLayoutEditor";
import dashboardLayoutEditorStyles from "../pages/Dashboard/DashboardLayoutEditor.module.css";
import settingsStyles from "../pages/Settings/settings.module.css";
import todosStyles from "../pages/Todos/todos.module.css";

export function SidebarLayoutSettings() {
  const { t } = useI18n();
  const { layout, persistenceError } = useSidebarLayoutStore();
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  return <div className={settingsStyles.settingsForm}>
    <div className={dashboardLayoutEditorStyles.layoutEntry}>
      <span className={dashboardLayoutEditorStyles.layoutSummary}>{t("sidebar.summary", {
        visible: layout.filter((panel) => panel.visible).length, total: layout.length,
      })}</span>
      <button aria-label={t("sidebar.edit")} className="icon-btn" onClick={() => setEditing(true)}
        title={t("sidebar.edit")} type="button">
        <ActionIcon name="edit" />
      </button>
    </div>
    {persistenceError ? <p className={todosStyles.todoError} role="alert">{t("sidebar.saveError")}</p> : null}
    {editing ? <SidebarLayoutEditor onClose={close} /> : null}
  </div>;
}
