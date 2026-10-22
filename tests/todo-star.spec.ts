import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 900, height: 760 } });

/** The fixture's four tasks, by the title the row shows. */
const BULK = "整理 SentryNeko 的批量选择交互";
const LAYOUT = "把仪表盘布局存进设置表";
const REVIEW = "Review the pull request that adds the heatmap bucket rules";
const REPORT = "写周报";

const rowOf = (page: Page, title: string) =>
  page.locator('[data-testid="todo-row"]', { hasText: title });

/** Titles in the order the page draws them, which is what a pin is about. */
const titlesInOrder = (page: Page) => page.locator('[data-testid="todo-title"]').allInnerTexts();

test("a starred task rises to the top of its group and drops back when it is unstarred", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");
  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();

  // Newest first inside each group: the two open tasks, then the two finished ones.
  await expect.poll(() => titlesInOrder(page)).toEqual([BULK, LAYOUT, REVIEW, REPORT]);

  const older = rowOf(page, LAYOUT);
  const olderStar = older.getByTestId("todo-star");
  await expect(olderStar).toHaveAttribute("aria-pressed", "false");
  await expect(olderStar).toHaveAttribute("aria-label", "Star this task");
  await expect(older).toHaveAttribute("data-starred", "false");

  // Pinning the older task lifts it above the newer one; nothing else moves.
  await olderStar.click();
  await expect(older).toHaveAttribute("data-starred", "true");
  await expect(olderStar).toHaveAttribute("aria-pressed", "true");
  await expect(olderStar).toHaveAttribute("aria-label", "Remove the star");
  await expect.poll(() => titlesInOrder(page)).toEqual([LAYOUT, BULK, REVIEW, REPORT]);

  // Starring a second task puts the most recent pin on top, not the newest task.
  const newerStar = rowOf(page, BULK).getByTestId("todo-star");
  await newerStar.click();
  await expect.poll(() => titlesInOrder(page)).toEqual([BULK, LAYOUT, REVIEW, REPORT]);

  // Unstarring puts the task back where its own age says it belongs.
  await rowOf(page, BULK).getByTestId("todo-star").click();
  await expect.poll(() => titlesInOrder(page)).toEqual([LAYOUT, BULK, REVIEW, REPORT]);
  await rowOf(page, LAYOUT).getByTestId("todo-star").click();
  await expect.poll(() => titlesInOrder(page)).toEqual([BULK, LAYOUT, REVIEW, REPORT]);

  // A finished task is pinned inside the finished group: the two groups are never mixed.
  await rowOf(page, REPORT).getByTestId("todo-star").click();
  await expect.poll(() => titlesInOrder(page)).toEqual([BULK, LAYOUT, REPORT, REVIEW]);

  const groups = page.locator('[data-testid="todo-group"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText(BULK);
  await expect(groups.nth(1)).toContainText(REPORT);

  expect(errors).toEqual([]);
});

test("the star comes back with the row when the filter reloads the list", async ({ page }) => {
  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");
  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();

  await rowOf(page, REPORT).getByTestId("todo-star").click();
  await expect(rowOf(page, REPORT)).toHaveAttribute("data-starred", "true");

  // A filter switch asks the backend again, so the answer has to carry the pin with it.
  await page.getByTestId("todo-filter-button").click();

  const filter = page.getByRole("dialog", { name: "Filter", exact: true });

  await filter.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(2);
  await expect.poll(() => titlesInOrder(page)).toEqual([REPORT, REVIEW]);
  await expect(rowOf(page, REPORT).getByTestId("todo-star")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await filter.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(4);
  await expect(rowOf(page, REPORT)).toHaveAttribute("data-starred", "true");
});
