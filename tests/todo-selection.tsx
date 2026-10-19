import { mockIPC } from "@tauri-apps/api/mocks";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import i18n from "../src/i18n";
import { TodosPage } from "../src/pages/Todos/TodosPage";
import type { Todo, TodoCounts } from "../src/types/todo";
import "../src/styles/app.css";

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(params.get("language") ?? "zh-CN");

Object.defineProperty(window, "isTauri", { value: true });

const now = Math.floor(Date.now() / 1000);

/** The tasks the page lists. The mock mutates this list, so a bulk action can be seen to land. */
const todos: Todo[] = [
  { id: 1, title: "整理 SentryNeko 的批量选择交互", completed: false, createdAt: now - 300, updatedAt: now - 300, tagIds: [1] },
  { id: 2, title: "Review the pull request that adds the heatmap bucket rules", completed: true, createdAt: now - 7200, updatedAt: now - 600, tagIds: [1, 2] },
  { id: 3, title: "把仪表盘布局存进设置表", completed: false, createdAt: now - 86_400, updatedAt: now - 86_400, tagIds: [] },
  { id: 4, title: "写周报", completed: true, createdAt: now - 200_000, updatedAt: now - 100_000, tagIds: [] },
];

/** Totals recomputed from the list, the way the backend answers `todo_counts`. */
function counts(): TodoCounts {
  const completed = todos.filter((todo) => todo.completed).length;

  return { total: todos.length, remaining: todos.length - completed, completed };
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
  } else if (command === "list_tags") {
    data = [
      { id: 1, name: "work", createdAt: now },
      { id: 2, name: "long-name-tag", createdAt: now },
    ];
  } else if (command === "set_todo_completed") {
    const todo = todos.find((item) => item.id === Number(args.id));

    if (todo !== undefined) {
      todo.completed = args.completed === true;
      todo.updatedAt = Math.floor(Date.now() / 1000);
    }

    data = todo ?? null;
  } else if (command === "delete_todo") {
    const index = todos.findIndex((item) => item.id === Number(args.id));

    if (index !== -1) {
      todos.splice(index, 1);
    }
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
