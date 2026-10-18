import { expect, test } from "@playwright/test";

import type {
  AiOperationLog,
  AiSettings,
  AiSuggestion,
} from "../src/types/assistance";
import type { Todo } from "../src/types/todo";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const saved = localStorage.getItem("test.ai.state");
    const state: {
      settings: AiSettings;
      suggestions: AiSuggestion[];
      log: AiOperationLog[];
      todos: Todo[];
      nextId: number;
    } = saved
      ? JSON.parse(saved)
      : {
          settings: { model: "test-local", port: 11434 },
          suggestions: [],
          log: [],
          todos: [],
          nextId: 1,
        };
    const save = () =>
      localStorage.setItem("test.ai.state", JSON.stringify(state));
    const ok = (data: unknown) => ({
      code: "OK",
      message: "OK",
      details: null,
      data,
    });
    const addLog = (
      suggestion: AiSuggestion,
      event: AiOperationLog["event"],
      resultId: number | null = null,
    ) => {
      state.log.unshift({
        id: state.nextId++,
        suggestionId: suggestion.id,
        event,
        reason: suggestion.reason,
        action: structuredClone(suggestion.action),
        createdAt: Math.floor(Date.now() / 1000),
        resultId,
      });
    };
    let callbackId = 1;
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => callbackId++,
        unregisterCallback: () => undefined,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          const calls = JSON.parse(
            localStorage.getItem("test.ai.calls") ?? "[]",
          ) as { command: string; args: Record<string, unknown> }[];
          calls.push({ command, args });
          localStorage.setItem("test.ai.calls", JSON.stringify(calls));
          if (command.startsWith("plugin:"))
            return command.includes("is_maximized") ? false : 1;
          switch (command) {
            case "get_language":
              return ok(localStorage.getItem("test.language") ?? "en-US");
            case "get_color_mode":
              return ok("dark");
            case "get_ai_settings":
              return ok(state.settings);
            case "set_ai_settings":
              state.settings = args.settings as AiSettings;
              save();
              return ok(state.settings);
            case "list_ai_suggestions":
              return ok(structuredClone(state.suggestions));
            case "list_ai_operation_log":
              return ok(structuredClone(state.log));
            case "list_tags":
              return ok([]);
            case "list_todos":
              return ok(structuredClone(state.todos));
            case "todo_counts":
              return ok({
                total: state.todos.length,
                remaining: state.todos.length,
                completed: 0,
              });
            case "add_todo": {
              const todo = {
                id: state.nextId++,
                title: String(args.title),
                completed: false,
                createdAt: 1,
                updatedAt: 1,
                tagIds: [],
                dueDate: null, recurrence: null, nextOccurrenceAt: null,
              };
              state.todos.push(todo);
              save();
              return ok(todo);
            }
            case "generate_ai_suggestions": {
              await new Promise((resolve) => setTimeout(resolve, 800));
              if (localStorage.getItem("test.invalidModel") === "true")
                return {
                  code: "INVALID_INPUT",
                  message: "",
                  details: null,
                  data: null,
                };
              const suggestion: AiSuggestion = {
                id: state.nextId++,
                reason: "Plan the next step before starting work.",
                action: { kind: "createTodo", title: "Plan tomorrow" },
                revision: 1,
                createdAt: 1,
              };
              state.suggestions.push(suggestion);
              addLog(suggestion, "proposed");
              save();
              return ok([suggestion]);
            }
            case "edit_ai_suggestion": {
              const suggestion = state.suggestions.find(
                (item) => item.id === args.id,
              );
              if (!suggestion) throw new Error("Missing fixture proposal");
              suggestion.action = args.action as AiSuggestion["action"];
              suggestion.revision++;
              addLog(suggestion, "edited");
              save();
              return ok(null);
            }
            case "confirm_ai_suggestion":
            case "reject_ai_suggestion": {
              const index = state.suggestions.findIndex(
                (item) => item.id === args.id,
              );
              const suggestion = state.suggestions[index];
              if (!suggestion) throw new Error("Missing fixture proposal");
              if (command === "confirm_ai_suggestion") {
                if (
                  args.confirmed !== true ||
                  args.revision !== suggestion.revision
                )
                  throw new Error("Invalid confirmation");
                if (suggestion.action.kind !== "createTodo")
                  throw new Error("Unexpected fixture action");
                const id = state.nextId++;
                state.todos.push({
                  id,
                  title: suggestion.action.title,
                  completed: false,
                  createdAt: 1,
                  updatedAt: 1,
                  tagIds: [],
                dueDate: null, recurrence: null, nextOccurrenceAt: null,
                });
                addLog(suggestion, "confirmed", id);
              } else addLog(suggestion, "rejected");
              state.suggestions.splice(index, 1);
              save();
              return ok(null);
            }
            case "clear_ai_operation_log":
              state.log = [];
              save();
              return ok(null);
            default:
              return ok(null);
          }
        },
      },
    });
  });
});

test("editing only saves a preview; confirmation executes and history can be cleared", async ({
  page,
}, testInfo) => {
  await page.goto("/#/assistance");
  await page
    .getByRole("button", { name: "Generate suggestions", exact: true })
    .click();
  await expect(
    page.getByText("Awaiting your confirmation", { exact: true }),
  ).toBeVisible();
  const state = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("test.ai.state") ?? "{}"),
    );
  expect((await state()).todos).toHaveLength(0);

  await page
    .getByRole("button", { name: "Edit suggestion", exact: true })
    .click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Review the report");
  await expect(
    page.getByRole("button", { name: "Confirm and execute" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save preview", exact: true }).click();
  await expect(page.locator(".ai-preview")).toContainText("Review the report");
  expect((await state()).todos).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("review-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm and execute", exact: true })
    .click();
  await expect(page.locator(".ai-suggestion")).toHaveCount(0);
  expect((await state()).todos.map((todo: Todo) => todo.title)).toEqual([
    "Review the report",
  ]);
  await expect(page.locator(".ai-log")).toContainText("Confirmed and executed");

  await page
    .getByRole("button", { name: "Generate suggestions", exact: true })
    .click();
  await expect(page.locator(".ai-suggestion")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear log", exact: true }).click();
  expect((await state()).log.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Confirm clear log", exact: true })
    .click();
  await expect(page.locator(".ai-log li")).toHaveCount(0);
  await expect(page.locator(".ai-suggestion")).toHaveCount(1);
  expect((await state()).todos).toHaveLength(1);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.locator(".ai-suggestion")).toHaveCount(0);
  expect((await state()).todos).toHaveLength(1);
  await expect(page.locator(".ai-log")).toContainText("Rejected");
});

test("generation survives navigation while manual tasks remain usable", async ({
  page,
}) => {
  await page.goto("/#/assistance");
  await page
    .getByRole("button", { name: "Generate suggestions", exact: true })
    .click();
  await expect(page.getByText("Generating…", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Todos", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What needs doing?" })
    .fill("A manual task");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("A manual task", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "AI assistant", exact: true }).click();
  await expect(page.locator(".ai-suggestion")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".ai-suggestion")).toHaveCount(1);
  const calls = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("test.ai.calls") ?? "[]") as {
        command: string;
      }[],
  );
  expect(calls.some((call) => call.command === "confirm_ai_suggestion")).toBe(
    false,
  );
});

test("invalid model replies show a recoverable error without actions", async ({
  page,
}) => {
  await page.goto("/#/assistance");
  await page.evaluate(() => localStorage.setItem("test.invalidModel", "true"));
  await page
    .getByRole("button", { name: "Generate suggestions", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid settings, fields or model response",
  );
  await expect(page.locator(".ai-suggestion")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate suggestions", exact: true }),
  ).toBeEnabled();
});

test("the assistant has Chinese navigation, review controls and log copy", async ({
  page,
}) => {
  await page.goto("/#/assistance");
  await page.evaluate(() => localStorage.setItem("test.language", "zh-CN"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "AI 助手", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成建议", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认并执行", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "操作日志", exact: true }),
  ).toBeVisible();
});
