/** Sidebar layout entry; the modal owns all editing controls. */
import { useCallback, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { useSidebarLayoutStore } from "../stores/sidebarLayoutStore";
import { ActionIcon } from "./ui/ActionIcon";
import { SidebarLayoutEditor } from "./SidebarLayoutEditor";

export function SidebarLayoutSettings() {
  const { t } = useI18n();
  const { layout, persistenceError } = useSidebarLayoutStore();
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);
  return <div className="settings-form">
    <div className="layout-entry">
      <span className="layout-summary">{t("sidebar.summary", {
        visible: layout.filter((panel) => panel.visible).length, total: layout.length,
      })}</span>
      <button className="btn" onClick={() => setEditing(true)} type="button">
        <ActionIcon name="edit" />{t("sidebar.edit")}
      </button>
    </div>
    {persistenceError ? <p className="todo-error" role="alert">{t("sidebar.saveError")}</p> : null}
    {editing ? <SidebarLayoutEditor onClose={close} /> : null}
  </div>;
}
