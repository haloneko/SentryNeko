/** Search field: narrows the list by title, note or tag; `#` offers the tags that fit. */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { useI18n } from "../../hooks/useI18n";
import todosStyles from "./todos.module.css";

/** How many tag suggestions the list offers at once. */
const MAX_SUGGESTIONS = 10;

/**
 * How long a typed word waits before the list is filtered again.
 *
 * Without the pause the list would be rebuilt on every keystroke, so a tag can be typed past
 * without the rows moving under the pointer. The wait is short enough to feel immediate.
 */
const FREEZE_MS = 200;

/** A tag the field can offer after a `#`. */
export interface TagOption {
  id: number;
  name: string;
  /** How many tasks carry it; the busiest comes first. */
  count: number;
}

export interface TodoSearchProps {
  /** What the user typed; the empty string matches everything. */
  query: string;
  onChange: (query: string) => void;
  /** Tags to offer after a `#`, busiest first. */
  tagOptions: readonly TagOption[];
}

/** Fields a keystroke belongs to, where "/" is just a character. */
const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

/** The hidden line that spells the syntax out; the placeholder can only hint at it. */
const SYNTAX_ID = "todo-search-syntax";

/** The `#word` the caret sits in, or `null` when it sits anywhere else. */
function tagWordAt(value: string, caret: number): { start: number; text: string } | null {
  const before = value.slice(0, caret);
  const word = /(?:^|\s)(#\S*)$/.exec(before)?.[1];

  return word === undefined ? null : { start: before.length - word.length, text: word.slice(1) };
}

export function TodoSearch({ onChange, query, tagOptions }: TodoSearchProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  /** The word the list is already filtered by, which trails the caret by one pause. */
  const [frozen, setFrozen] = useState("");
  const [active, setActive] = useState(0);
  /** Escape closes the list without touching the text; typing opens it again. */
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const optionId = (index: number): string => `${listId}-${String(index)}`;

  const word = tagWordAt(query, caret);
  const open = word !== null && !dismissed;
  /** Whether the list was already on screen on the previous render. */
  const wasOpen = useRef(false);
  const wordText = word === null ? null : word.text;

  // The first `#` shows the tags at once; from there the filter waits the pause out, so the list
  // does not chase every letter of a name being typed.
  useEffect(() => {
    if (wordText === null) {
      wasOpen.current = false;
      setFrozen("");
      setActive(0);
      return;
    }

    if (!wasOpen.current) {
      wasOpen.current = true;
      setFrozen(wordText);
      setActive(0);
      return;
    }

    const timer = window.setTimeout(() => {
      setFrozen(wordText);
      setActive(0);
    }, FREEZE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [wordText]);

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

  const suggestions = useMemo(() => {
    if (!open) {
      return [];
    }

    const needle = frozen.toLowerCase();

    return tagOptions
      .filter((option) => option.name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [frozen, open, tagOptions]);

  const current = Math.min(active, Math.max(suggestions.length - 1, 0));
  const visible = open && suggestions.length > 0;

  /** Puts the chosen tag in place of the word being typed, and leaves the caret after it. */
  function complete(option: TagOption): void {
    if (word === null) {
      return;
    }

    const next = `${query.slice(0, word.start)}#${option.name} ${query.slice(caret)}`;
    const nextCaret = word.start + option.name.length + 2;

    onChange(next);
    setCaret(nextCaret);
    setDismissed(true);
    setFrozen("");

    window.requestAnimationFrame(() => {
      const input = inputRef.current;

      if (input === null) {
        return;
      }

      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  return (
    <div className={todosStyles.todoSearch}>
      <p className="sr-only" id={SYNTAX_ID}>
        {t("todo.search.hint")}
      </p>
      <span aria-hidden="true" className={todosStyles.todoSearchGlyph}>
        <svg viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
      </span>
      <input
        aria-activedescendant={visible ? optionId(current) : undefined}
        aria-autocomplete="list"
        aria-controls={visible ? listId : undefined}
        aria-describedby={SYNTAX_ID}
        aria-expanded={visible}
        aria-label={t("todo.search.label")}
        className={`${todosStyles.todoInput} ${todosStyles.todoSearchInput}`}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setDismissed(false);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          onChange(event.target.value);
        }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (visible) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % suggestions.length);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
              return;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              const option = suggestions[current];

              if (option !== undefined) {
                event.preventDefault();
                complete(option);
                return;
              }
            }
          }

          // Escape closes the list first, then clears the field, so neither costs a second press.
          if (event.key === "Escape") {
            if (visible) {
              event.preventDefault();
              setDismissed(true);
              return;
            }

            if (query !== "") {
              event.preventDefault();
              onChange("");
            }
          }
        }}
        // The caret moves without the text changing, which is what decides whether a `#word` is
        // being typed; the browser has already moved it by the time `select` fires.
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart ?? 0);
        }}
        placeholder={t("todo.search.placeholder")}
        ref={inputRef}
        role="combobox"
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
      {visible ? (
        <ul
          aria-label={t("todo.search.suggestions")}
          className={todosStyles.todoSearchSuggestions}
          id={listId}
          role="listbox"
        >
          {suggestions.map((option, index) => (
            <li
              aria-selected={index === current}
              className={todosStyles.todoSearchSuggestion}
              data-active={index === current}
              id={optionId(index)}
              key={option.id}
              // The press must not take the caret out of the field before the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                complete(option);
              }}
              role="option"
            >
              <span>
                #{option.name}
              </span>
              {option.count === 0 ? null : (
                <span className={todosStyles.todoSearchSuggestionCount}>{option.count}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
