/** Inline tag picker: toggles the tags a task carries, and creates new ones on the spot. */

import { useState } from "react";
import type { FormEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import { useTags } from "../../hooks/useTags";
import type { Tag } from "../../types/tag";
import type { Todo } from "../../types/todo";
import todosStyles from "./todos.module.css";

export interface TodoTagEditorProps {
  /** Closes the picker without touching the task. */
  onClose: () => void;
  /** Called with the full list of tag ids the task should carry. */
  onChange: (tagIds: readonly number[]) => void;
  tags: readonly Tag[];
  todo: Todo;
}

export function TodoTagEditor({ onClose, onChange, tags, todo }: TodoTagEditorProps) {
  const { t } = useI18n();
  const { create } = useTags();
  const [draft, setDraft] = useState("");

  const chosen = new Set(todo.tagIds);

  /** Applies the pick as it is made, so the row updates without a save step. */
  const apply = (next: ReadonlySet<number>): void => {
    onChange([...next]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const name = draft.trim();

    if (name === "") {
      return;
    }

    // The new tag is created first and then attached, because the attach call needs its id.
    void create(name).then((created) => {
      if (created !== null) {
        apply(new Set([...chosen, created.id]));
      }

      setDraft("");
    });
  };

  return (
    <div className={todosStyles.todoTagEditor}>
      {tags.length === 0 ? <p className={todosStyles.todoTagHint}>{t("todo.tags.empty")}</p> : null}
      <div className={todosStyles.todoTagChoices}>
        {tags.map((tag) => {
          const on = chosen.has(tag.id);

          return (
            <button
              aria-pressed={on}
              className={todosStyles.todoTagChoice}
              key={tag.id}
              onClick={() => {
                const next = new Set(chosen);

                if (on) {
                  next.delete(tag.id);
                } else {
                  next.add(tag.id);
                }

                apply(next);
              }}
              type="button"
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      <div className={todosStyles.todoTagFoot}>
        <form className={todosStyles.todoTagNew} onSubmit={submit}>
          <input
            aria-label={t("todo.tags.name")}
            className={todosStyles.todoInput}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            placeholder={t("todo.tags.create")}
            value={draft}
          />
          <button className="btn btn-quiet" disabled={draft.trim() === ""} type="submit">
            {t("todo.tags.create")}
          </button>
        </form>
        <button className="btn btn-quiet" onClick={onClose} type="button">
          {t("todo.tags.done")}
        </button>
      </div>
    </div>
  );
}
