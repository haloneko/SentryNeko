import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const directory = mkdtempSync(join(tmpdir(), "sentryneko-task-order-"));
let helpers;
let dates;
try {
  execFileSync(process.execPath, [compiler, "src/pages/Todos/todos.ts", "src/types/dueDate.ts",
    "--ignoreConfig", "--skipLibCheck", "--moduleResolution", "bundler",
    "--target", "ES2022", "--module", "ESNext", "--rootDir", "src", "--outDir", directory],
  { cwd: resolve(import.meta.dirname, ".."), stdio: "pipe" });
  const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(readFileSync(path)).toString("base64")}`);
  helpers = await load(join(directory, "pages/Todos/todos.js"));
  dates = await load(join(directory, "types/dueDate.js"));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const tasks = [
  { id: 1, dueDate: null, completed: false, title: "undated", tagIds: [] },
  { id: 2, dueDate: 0, completed: true, title: "early", tagIds: [9] },
  { id: 3, dueDate: 86400, completed: false, title: "late", tagIds: [9] },
  { id: 4, dueDate: 0, completed: false, title: "tied", tagIds: [] },
  { id: 5, dueDate: null, completed: false, title: "also undated", tagIds: [] },
];
const ids = (rows) => rows.map((task) => task.id);

test("both date directions are global across completion and leave undated tasks last", () => {
  assert.deepEqual(ids(helpers.sortTodos(tasks, "dueDateAsc")), [4, 2, 3, 5, 1]);
  assert.deepEqual(ids(helpers.sortTodos(tasks, "dueDateDesc")), [3, 4, 2, 5, 1]);
  assert.deepEqual(ids(helpers.sortTodos(tasks)), [5, 4, 3, 1, 2]);
});

test("searching titles or tags preserves the selected sort and does not mutate tasks", () => {
  const original = structuredClone(tasks);
  assert.deepEqual(ids(helpers.searchTodos(tasks, [{ id: 9, name: "Work" }], "WORK", "dueDateDesc")), [3, 2]);
  assert.deepEqual(ids(helpers.searchTodos(tasks, [], "undated", "dueDateAsc")), [5, 1]);
  assert.deepEqual(tasks, original);
});

test("overdue follows the local day and excludes today's, completed and undated tasks", () => {
  const today = dates.localDate(new Date(2026, 9, 19, 23, 59));
  assert.equal(dates.isOverdue(today - 86400, false, today), true);
  for (const [date, completed] of [[today, false], [today + 86400, false], [today - 86400, true], [null, false], [undefined, false]]) {
    assert.equal(dates.isOverdue(date, completed, today), false);
  }
});
