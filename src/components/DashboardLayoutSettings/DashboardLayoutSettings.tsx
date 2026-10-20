/** Dashboard layout settings: the saved column count and the button that opens the editor. */

import { useState } from "react";

import { useDashboardLayout } from "../../hooks/useDashboardLayout";
import { useI18n } from "../../hooks/useI18n";
import { ActionIcon } from "../ui/ActionIcon";
import { DashboardLayoutEditor } from "./DashboardLayoutEditor";
import dashboardLayoutEditorStyles from "../../pages/Dashboard/DashboardLayoutEditor.module.css";

/** One line of context plus the edit button; the editor holds everything else. */
export function DashboardLayoutSettings() {
  const { t } = useI18n();
  const { layout } = useDashboardLayout();
  const [editing, setEditing] = useState(false);

  return (
    <div className={dashboardLayoutEditorStyles.layoutEntry}>
      <span className={dashboardLayoutEditorStyles.layoutSummary}>
        {t("dashboard.layout.summary", { columns: layout.columns })}
      </span>
      <button
        aria-label={t("dashboard.layout.edit")}
        className="icon-btn"
        onClick={() => {
          setEditing(true);
        }}
        title={t("dashboard.layout.edit")}
        type="button"
      >
        <ActionIcon name="edit" />
      </button>
      {editing ? (
        <DashboardLayoutEditor
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </div>
  );
}
