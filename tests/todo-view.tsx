import { mockIPC } from "@tauri-apps/api/mocks";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import i18n from "../src/i18n";
import { TodosPage } from "../src/pages/Todos/TodosPage";
import { useI18nStore } from "../src/stores/i18nStore";
import type { Todo, TodoCompletions, TodoCounts } from "../src/types/todo";
import "../src/styles/tokens.css";
import "../src/styles/global.css";

const params = new URLSearchParams(window.location.search);
const language = params.get("language") === "en-US" ? "en-US" : "zh-CN";

document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(language);
useI18nStore.setState({ language });

Object.defineProperty(window, "isTauri", { value: true });

const now = Math.floor(Date.now() / 1000);

/**
 * Tasks chosen so every order the card offers reads differently: newest-first, due-soonest,
 * oldest-first and A→Z each put a different task in front of the same three, and one is pinned.
 * One task has already started (ongoing), one is past its end (late), one is finished.
 */
const todos: Todo[] = [
  { id: 1, title: "Zebra review", completed: false, createdAt: now - 3000, updatedAt: now - 3000, tagIds: [1], startAt: now - 300, endAt: now + 300, starredAt: null, extra: {}, notes: null },
  { id: 2, title: "Beta write-up", completed: false, createdAt: now - 100, updatedAt: now - 100, tagIds: [2], startAt: null, endAt: null, starredAt: null, extra: {}, notes: null },
  { id: 3, title: "Gamma archive", completed: true, createdAt: now - 86_400, updatedAt: now - 86_400, tagIds: [], startAt: null, endAt: null, starredAt: null, extra: {}, notes: null },
  { id: 4, title: "Delta inbox", completed: false, createdAt: now - 5000, updatedAt: now - 5000, tagIds: [], startAt: null, endAt: null, starredAt: now - 50, extra: {}, notes: null },
  { id: 5, title: "Aardvark fix", completed: false, createdAt: now - 600, updatedAt: now - 600, tagIds: [], startAt: null, endAt: now - 600, starredAt: null, extra: {}, notes: null },
];

let starClock = now;

/** Totals recomputed from the list, the way the backend answers `todo_counts`. */
function counts(): TodoCounts {
  const completed = todos.filter((todo) => todo.completed).length;

  return { total: todos.length, remaining: todos.length - completed, completed };
}

function completions(): TodoCompletions {
  const finished = todos.filter((todo) => todo.completed).length;

  return { all: finished, today: finished };
}

mockIPC((command, payload) => {
  const args = (payload ?? {}) as Record<string, unknown>;
  let data: unknown = null;

  if (command === "list_todos") {
    // `null` asks for every task; a boolean narrows the list to the group the filter shows.
    const completed = args.completed;

    data = typeof completed === "boolean" ? todos.filter((todo) => todo.completed === completed) : todos;
  } else if (command === "todo_counts") {
    data = counts();
  } else if (command === "todo_completions") {
    data = completions();
  } else if (command === "list_tags") {
    data = [
      { id: 1, name: "work", createdAt: now },
      { id: 2, name: "long-name-tag", createdAt: now },
    ];
  } else if (command === "set_todo_starred") {
    const todo = todos.find((item) => item.id === Number(args.id));

    if (todo !== undefined) {
      starClock += 1;
      todo.starredAt = args.starred === true ? starClock : null;
      todo.updatedAt = Math.floor(Date.now() / 1000);
    }

    data = todo ?? null;
  }

  return { code: "OK", data, details: null, message: "OK" };
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <div className="content-inner">
        <TodosPage />
      </div>
    </I18nProvider>
  </StrictMode>,
);
