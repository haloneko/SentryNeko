/** Form for creating a new todo task. */

import { useState } from "react";
import type { FormEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import { useTodos } from "../../hooks/useTodos";
import todosStyles from "./todos.module.css";

/** Stores the typed title and clears the field once it landed. */
export function AddTodoForm() {
  const { t } = useI18n();
  const { add } = useTodos();
  const [title, setTitle] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const trimmed = title.trim();

    if (trimmed === "") {
      return;
    }

    void add(trimmed, null, null).then((stored) => {
      if (stored) {
        setTitle("");
      }
    });
  };

  return (
    <form className={todosStyles.todoComposer} onSubmit={submit}>
      <span aria-hidden="true" className={todosStyles.todoComposerGlyph}>
        <svg viewBox="0 0 16 16">
          <path d="M8 3v10M3 8h10" />
        </svg>
      </span>
      <input
        aria-label={t("todo.placeholder")}
        className={todosStyles.todoComposerInput}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        placeholder={t("todo.placeholder")}
        value={title}
      />
      <button className={todosStyles.todoComposerAdd} disabled={title.trim() === ""} type="submit">
        {t("todo.add")}
      </button>
    </form>
  );
}
