import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 900, height: 760 } });

const rowOf = (page: Page, title: string) => page.locator('[data-testid="todo-row"]', { hasText: title });

test("selection mode picks rows, acts on them and closes on Escape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");
  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();

  // The switch draws an icon, so its state is read through the label it carries for a screen reader.
  const toggle = page.locator('[data-testid="todo-select-toggle"]');
  await expect(toggle).toHaveAttribute("aria-label", "Select tasks");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("aria-label", "Exit selection");

  const bar = page.getByRole("region", { name: "Select tasks" });
  await expect(bar.getByText("0 selected")).toBeVisible();

  // The whole card is the target, and the title no longer opens the editor.
  await rowOf(page, "把仪表盘布局存进设置表").locator('[data-testid="todo-card"]').click();
  await expect(bar.getByText("1 selected")).toBeVisible();
  await expect(rowOf(page, "把仪表盘布局存进设置表")).toHaveAttribute("data-selected", "true");
  await expect(page.locator('[data-testid="todo-input-inline"]')).toHaveCount(0);

  // The box answers for itself, so clicking it does not also toggle the card underneath.
  await rowOf(page, "把仪表盘布局存进设置表").getByLabel("Select “把仪表盘布局存进设置表”").click();
  await expect(bar.getByText("0 selected")).toBeVisible();
  await expect(rowOf(page, "把仪表盘布局存进设置表")).toHaveAttribute("data-selected", "false");

  // Select all covers the visible list; invert flips it back to nothing.
  await bar.getByRole("button", { name: "Select all" }).click();
  await expect(bar.getByText("4 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Invert" }).click();
  await expect(bar.getByText("0 selected")).toBeVisible();

  // Mark done acts on the pick and carries the rows over to the other group.
  await rowOf(page, "整理 SentryNeko 的批量选择交互").locator('[data-testid="todo-card"]').click();
  await rowOf(page, "把仪表盘布局存进设置表").locator('[data-testid="todo-card"]').click();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Mark done" }).click();
  await expect(bar.getByText("0 selected")).toBeVisible();
  await expect(page.locator('[data-testid="todo-group"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="todo-group-head"]')).toContainText("Completed");
  await expect(page.locator('[data-testid="todo-group-count"]')).toHaveText("4");

  // Delete asks first: dismissing the panel keeps the pick and the row.
  await rowOf(page, "写周报").locator('[data-testid="todo-card"]').click();
  await expect(bar.getByText("1 selected")).toBeVisible();
  await bar.getByRole("button", { name: "Delete selected" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByRole("heading", { name: "Delete the selected tasks?" })).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(rowOf(page, "写周报")).toHaveCount(1);
  await expect(bar.getByText("1 selected")).toBeVisible();

  // Confirming takes the picked row off the list.
  await bar.getByRole("button", { name: "Delete selected" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(rowOf(page, "写周报")).toHaveCount(0);
  await expect(page.locator('[data-testid="todo-group-count"]')).toHaveText("3");

  // Escape leaves the mode and drops the pick with it.
  await rowOf(page, "Review the pull request that adds the heatmap bucket rules").locator('[data-testid="todo-card"]').click();
  await expect(bar.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-testid="todo-bulk"]')).toHaveAttribute("data-open", "false");

  await toggle.click();
  await expect(page.getByRole("button", { name: "Exit selection" })).toBeVisible();
  await expect(bar.getByText("0 selected")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a row asks before it is deleted", async ({ page }) => {
  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");
  const row = rowOf(page, "写周报");
  const confirm = page.getByRole("dialog");

  await row.getByRole("button", { name: "Delete task" }).click();
  await expect(confirm.getByRole("heading", { name: "Delete this task?" })).toBeVisible();

  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: "Delete task" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
});

test("the head counts finished tasks instead of showing a percentage", async ({ page }) => {
  await page.goto("/tests/todo-selection.html?theme=dark&language=zh-CN");

  const done = page.locator('[data-testid="todo-done"]');
  await expect(done).toContainText("今天完成");
  await expect(done.locator("b")).toHaveText("2");
  // The ring and its percentage are gone: the page counts, it does not divide.
  await expect(page.locator('[data-testid="todo-ring"]')).toHaveCount(0);
  await expect(page.getByText("%")).toHaveCount(0);

  // Ticking a task off moves the count.
  await rowOf(page, "整理 SentryNeko 的批量选择交互").locator('[data-testid="todo-check-done"]').check();
  await expect(done.locator("b")).toHaveText("3");
});

for (const theme of ["dark", "light"] as const) {
  test(`selection mode keeps its frame in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/todo-selection.html?theme=${theme}&language=en-US`);

    await page.getByRole("button", { name: "Select tasks" }).click();

    const bar = page.getByRole("region", { name: "Select tasks" });
    await expect(bar).toBeVisible();
    await page.locator('[data-testid="todo-card"]').first().click();
    await expect(bar.getByText("1 selected")).toBeVisible();
    await expect(page.locator('[data-testid="todo-row"][data-selected="true"]')).toHaveCount(1);

    // The bar and the picked card stay inside the reading column at the narrow window.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`todo-selection-${theme}.png`) });
  });
}
