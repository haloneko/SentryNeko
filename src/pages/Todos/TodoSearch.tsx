/** Search field: narrows the list by title or tag while the user types. */

import { useEffect, useRef } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import todosStyles from "./todos.module.css";

export interface TodoSearchProps {
  /** What the user typed; the empty string matches everything. */
  query: string;
  onChange: (query: string) => void;
}

/** Fields a keystroke belongs to, where "/" is just a character. */
const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

export function TodoSearch({ onChange, query }: TodoSearchProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search from anywhere on the page, the way every list app does it. A key typed
  // into a field of its own is left alone, and the shortcut is dropped while a modifier is held so
  // it never stands in for a browser or window shortcut.
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || TYPING_TAGS.includes(target.tagName))
      ) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className={todosStyles.todoSearch}>
      <span aria-hidden="true" className={todosStyles.todoSearchGlyph}>
        <svg viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
      </span>
      <input
        aria-label={t("todo.search.label")}
        className={`${todosStyles.todoInput} ${todosStyles.todoSearchInput}`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          // Escape clears first, so a second press can leave the page instead.
          if (event.key === "Escape" && query !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        placeholder={t("todo.search.placeholder")}
        ref={inputRef}
        type="text"
        value={query}
      />
      {query === "" ? null : (
        <button
          aria-label={t("todo.search.clear")}
          className={todosStyles.todoSearchClear}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          title={t("todo.search.clear")}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}
