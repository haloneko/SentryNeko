import { useState } from "react";
import { TodoDatePicker } from "../../components/TodoDatePicker";
import { useI18n } from "../../hooks/useI18n";
import { useTodos } from "../../hooks/useTodos";
import type { Todo } from "../../types/todo";

export function TodoDateEditor({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const { t } = useI18n();
  const { update } = useTodos();
  const [title, setTitle] = useState(todo.title);
  const [dueDate, setDueDate] = useState(todo.dueDate ?? null);
  const [saving, setSaving] = useState(false);
  return <form className="todo-edit-form" aria-busy={saving}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !saving) { event.preventDefault(); onClose(); }
    }}
    onSubmit={(event) => {
      event.preventDefault();
      if (saving || title.trim() === "") return;
      setSaving(true);
      void update(todo.id, title.trim(), dueDate).then((stored) => {
        if (stored) onClose();
      }).finally(() => setSaving(false));
    }}>
    <input className="todo-input" aria-label={t("todo.edit")} autoFocus disabled={saving}
      value={title} onChange={(event) => setTitle(event.target.value)} />
    <TodoDatePicker value={dueDate} onChange={setDueDate} disabled={saving} />
    <div className="todo-edit-actions">
      <button className="btn" type="submit" disabled={saving || title.trim() === ""}>{t("todo.save")}</button>
      <button className="btn" type="button" disabled={saving} onClick={onClose}>{t("todo.cancel")}</button>
    </div>
  </form>;
}
