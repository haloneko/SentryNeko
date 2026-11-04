import { expect, test } from "@playwright/test";

/**
 * The two panels a row opens: one surface each, hanging off the row's own buttons, and every pick
 * lands as it is made — there is no save step to forget.
 */

test("the plan panel opens as one surface and steps into its calendar", async ({ page }) => {
  await page.goto("/tests/todo-view.html");

  const row = page.getByTestId("todo-row").filter({ hasText: "Beta write-up" });

  await row.hover();
  await row.getByRole("button", { name: "设置时间" }).click();

  const panel = page.getByRole("dialog");

  await expect(panel).toBeVisible();
  await expect(panel).toContainText("尚未设置");

  // The calendar replaces the two fields; it does not open a second bubble under them.
  await panel.getByRole("button", { name: "打开选择器" }).first().click();
  await expect(panel.getByRole("button", { name: "明天" })).toBeVisible();

  // Escape steps back to the fields, and only then out of the panel.
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("textbox", { name: "开始" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the tag panel toggles a tag and the row says so at once", async ({ page }) => {
  await page.goto("/tests/todo-view.html");

  const row = page.getByTestId("todo-row").filter({ hasText: "Beta write-up" });

  await row.hover();
  await row.getByRole("button", { name: "标签", exact: true }).click();

  const panel = page.getByRole("dialog");

  await expect(panel).toContainText("已选 1 个");

  await panel.getByRole("button", { name: "work" }).click();

  await expect(panel).toContainText("已选 2 个");
  await expect(row.getByRole("button", { name: "筛选 #work" })).toBeVisible();
});
