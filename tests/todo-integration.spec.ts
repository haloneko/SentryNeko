import { expect, test } from "@playwright/test";
import type { Todo } from "../src/types/todo";

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const today = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) / 1000;
    const saved = localStorage.getItem("test.todo.integration");
    const state: { todos: Todo[]; mode: string } = saved ? JSON.parse(saved) : {
      mode: "merged",
      todos: [
        { id: 1, title: "Overdue one-time", completed: false, dueDate: today - 86400, recurrence: null, nextOccurrenceAt: null, tagIds: [1], createdAt: 1, updatedAt: 1 },
        { id: 2, title: "Daily review", completed: false, dueDate: today + 86400, recurrence: { unit: "day", interval: 1 }, nextOccurrenceAt: today + 86400, tagIds: [], createdAt: 2, updatedAt: 2 },
        { id: 3, title: "Completed", completed: true, dueDate: today - 172800, recurrence: null, nextOccurrenceAt: null, tagIds: [], createdAt: 3, updatedAt: 3 },
        { id: 4, title: "Undated", completed: false, dueDate: null, recurrence: null, nextOccurrenceAt: null, tagIds: [], createdAt: 4, updatedAt: 4 },
      ],
    };
    const save = () => localStorage.setItem("test.todo.integration", JSON.stringify(state));
    const ok = (data: unknown) => ({ code: "OK", data, message: "OK", details: null });
    const callbacks = new Map<number, (payload: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let nextCallback = 1;
    const changed = () => {
      save();
      listeners.forEach((listener, id) => {
        if (listener.event === "todos-changed") callbacks.get(listener.handler)?.({ event: listener.event, id, payload: null });
      });
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => listeners.delete(id) },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: (callback: (payload: unknown) => void) => { const id = nextCallback++; callbacks.set(id, callback); return id; },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === "plugin:event|listen") {
            const id = nextCallback++;
            listeners.set(id, args as { event: string; handler: number });
            return id;
          }
          if (command.startsWith("plugin:")) return false;
          if (command === "get_language") return ok("en-US");
          if (command === "get_color_mode") return ok("dark");
          if (command === "get_font_settings") return ok({ family: null, size: 14 });
          if (command === "get_system_fonts") return ok(["Segoe UI", "Microsoft YaHei UI"]);
          if (command === "get_todo_display_mode") return ok(state.mode);
          if (command === "set_todo_display_mode") { state.mode = String(args.mode); save(); return ok(state.mode); }
          if (command === "list_tags") return ok([{ id: 1, name: "Work", createdAt: 1 }]);
          if (command === "todo_counts") return ok({ total: state.todos.length, completed: state.todos.filter((todo) => todo.completed).length, remaining: state.todos.filter((todo) => !todo.completed).length });
          if (command === "list_todos") {
            const todos = structuredClone(state.todos.filter((todo) => args.completed == null || todo.completed === args.completed));
            todos.sort((a, b) => {
              if (args.sort === "dueDateAsc" || args.sort === "dueDateDesc") {
                if (a.dueDate == null || b.dueDate == null) return Number(a.dueDate == null) - Number(b.dueDate == null) || b.id - a.id;
                return (args.sort === "dueDateAsc" ? a.dueDate - b.dueDate : b.dueDate - a.dueDate) || b.id - a.id;
              }
              return Number(a.completed) - Number(b.completed) || b.id - a.id;
            });
            if (args.sort === "dueDateAsc" && localStorage.getItem("test.slowRead") === "true") {
              localStorage.removeItem("test.slowRead");
              await new Promise((resolve) => setTimeout(resolve, 200));
              localStorage.setItem("test.slowReadDone", "true");
            }
            return ok(todos);
          }
          if (command === "add_todo") {
            const todo = { id: Math.max(0, ...state.todos.map((row) => row.id)) + 1,
              title: String(args.title), completed: false, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000,
              tagIds: [], dueDate: args.dueDate ?? null, recurrence: args.recurrence ?? null,
              nextOccurrenceAt: args.recurrence ? today + 86400 : null } as Todo;
            state.todos.push(todo); changed(); return ok(todo);
          }
          const todo = state.todos.find((row) => row.id === args.id);
          if (todo && command === "update_todo") {
            if (localStorage.getItem("test.failUpdate") === "true") {
              localStorage.removeItem("test.failUpdate");
              return { code: "IO", data: null, message: "save failed", details: null };
            }
            todo.title = String(args.title); todo.dueDate = args.dueDate as number | null;
            changed(); return ok(todo);
          }
          if (todo && command === "set_todo_completed") { todo.completed = Boolean(args.completed); changed(); return ok(todo); }
          if (todo && command === "rename_todo") { todo.title = String(args.title); changed(); return ok(todo); }
          if (todo && command === "delete_todo") { state.todos = state.todos.filter((row) => row.id !== todo.id); changed(); return ok(null); }
          if (todo && command === "set_todo_tags") { todo.tagIds = args.tagIds as number[]; changed(); return ok(todo); }
          return { code: "UNSUPPORTED", data: null, message: command, details: null };
        },
      },
    });
  });
});

test("recurrence and date creation coexist with search, task badges and event-driven counts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/todos");
  const composer = page.locator(".todo-form");
  await composer.getByRole("textbox").fill("Plan daily work");
  await composer.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("daily");
  await composer.getByRole("button", { name: "Today", exact: true }).click();
  await composer.getByRole("button", { name: "Add", exact: true }).click();
  const added = page.locator(".todo-row").filter({ has: page.getByRole("button", { name: "Plan daily work", exact: true }) });
  await expect(added).toBeVisible();
  await expect(added.locator(".todo-type")).toContainText("Recurring");
  await expect(page.locator(".todo-count")).toContainText("4 left");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("test.todo.integration") ?? "{}") as { todos: Todo[] });
  expect(stored.todos.find((todo) => todo.title === "Plan daily work")?.recurrence).toEqual({ unit: "day", interval: 1 });
  expect(stored.todos.find((todo) => todo.title === "Plan daily work")?.dueDate).not.toBeNull();
  await page.reload();
  await expect(added).toBeVisible();
  await page.getByRole("textbox", { name: "Search tasks" }).fill("work");
  await expect(page.locator(".todo-row")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("dates sort globally, overdue excludes completed tasks, and save failures retain drafts", async ({ page }) => {
  await page.goto("/#/todos");
  await expect(page.locator(".todo-overdue")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("dueDateAsc");
  await expect(page.locator(".todo-row .todo-title")).toHaveText(["Completed", "Overdue one-time", "Daily review", "Undated"]);
  const row = page.locator(".todo-row").filter({ has: page.getByRole("button", { name: "Daily review", exact: true }) });
  await row.locator(".todo-due").click();
  const editor = row.locator(".todo-edit-form");
  await editor.getByRole("textbox").fill("Revised daily review");
  await editor.getByRole("button", { name: "Clear", exact: true }).click();
  await page.evaluate(() => localStorage.setItem("test.failUpdate", "true"));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("textbox")).toHaveValue("Revised daily review");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Revised daily review", exact: true })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("test.todo.integration") ?? "{}") as { todos: Todo[] });
  expect(stored.todos.find((todo) => todo.id === 2)).toMatchObject({ title: "Revised daily review", dueDate: null, recurrence: { unit: "day", interval: 1 }, completed: false });
  await page.screenshot({ path: test.info().outputPath("integrated-tasks.png") });
});

test("late date-sort responses cannot replace a newer choice or completion filter", async ({ page }) => {
  await page.goto("/#/todos");
  await page.evaluate(() => localStorage.setItem("test.slowRead", "true"));
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("dueDateAsc");
  await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("dueDateDesc");
  await page.waitForFunction(() => localStorage.getItem("test.slowReadDone") === "true");
  await expect(page.locator(".todo-row .todo-title")).toHaveText(["Daily review", "Overdue one-time", "Completed", "Undated"]);
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.locator(".todo-row .todo-title")).toHaveText(["Daily review", "Overdue one-time", "Undated"]);
});
