/** Inline tag picker: toggles the tags a task carries, and creates new ones on the spot. */

import { useState } from "react";
import type { FormEvent } from "react";

import { Popover } from "../../components/ui/Popover";
import { useI18n } from "../../hooks/useI18n";
import { useTags } from "../../hooks/useTags";
import type { Tag } from "../../types/tag";
import type { Todo } from "../../types/todo";
import tagStyles from "./TodoTagEditor.module.css";

export interface TodoTagEditorProps {
  /** The row's button, which the panel hangs from and gives its focus back to. */
  anchor: HTMLElement | null;
  /** Closes the picker without touching the task. */
  onClose: () => void;
  /** Called with the full list of tag ids the task should carry. */
  onChange: (tagIds: readonly number[]) => void;
  tags: readonly Tag[];
  todo: Todo;
}

export function TodoTagEditor({ anchor, onClose, onChange, tags, todo }: TodoTagEditorProps) {
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
    <Popover
      anchor={anchor}
      eyebrow={t("todo.tags.label")}
      footer={
        <>
          <span className={tagStyles.hint}>{t("todo.tags.hint")}</span>
          <button className={tagStyles.done} onClick={onClose} type="button">
            {t("todo.tags.done")}
          </button>
        </>
      }
      onClose={onClose}
      title={t("todo.tags.chosen", { chosen: chosen.size })}
    >
      {tags.length === 0 ? (
        <p className={tagStyles.emptyState}>{t("todo.tags.empty")}</p>
      ) : (
        <div className={tagStyles.cloud}>
          {tags.map((tag) => {
            const on = chosen.has(tag.id);

            return (
              <button
                aria-pressed={on}
                className={tagStyles.chip}
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
                {on ? (
                  <svg aria-hidden="true" viewBox="0 0 12 12">
                    <path d="M2 6.3l2.6 2.6L10 3.5" />
                  </svg>
                ) : null}
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      <form className={tagStyles.create} onSubmit={submit}>
        <span aria-hidden="true" className={tagStyles.createGlyph}>
          +
        </span>
        <input
          aria-label={t("todo.tags.name")}
          className={tagStyles.createInput}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder={t("todo.tags.create")}
          value={draft}
        />
        <button
          aria-label={t("todo.tags.create")}
          className={tagStyles.createSubmit}
          disabled={draft.trim() === ""}
          type="submit"
        >
          <svg aria-hidden="true" viewBox="0 0 12 12">
            <path d="M2 6h8M6 2v8" />
          </svg>
        </button>
      </form>
    </Popover>
  );
}
