import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 900, height: 760 } });

const titles = (page: Page) => page.locator('[data-testid="todo-title"]').allInnerTexts();

/** The card under the icon is announced by its heading, which is also its accessible name. */
const cardOf = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });

test("the filter card hangs under its icon and narrows the list in place", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-view.html?theme=dark&language=en-US");
  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  const button = page.getByTestId("todo-filter-button");
  const anchor = await button.boundingBox();

  await button.click();

  const card = cardOf(page, "Filter");
  await expect(card).toBeVisible();

  // Hung from the icon: the same left edge, one gap below it.
  const box = await card.boundingBox();
  expect(Math.abs((box?.x ?? 0) - (anchor?.x ?? 0))).toBeLessThan(2);
  expect(box?.y ?? 0).toBeGreaterThan((anchor?.y ?? 0) + (anchor?.height ?? 0));

  // The states are picked in the card, and the card stays open for the rest.
  await card.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(1);
  await expect.poll(() => titles(page)).toEqual(["Gamma archive"]);
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  // A tag is another narrowing, and the chip that is already chosen puts the list back.
  await card.getByRole("button", { name: "#work", exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(["Zebra review"]);
  await card.getByRole("button", { name: "#work", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  // The clock decides the two planned states: the started task is in progress, the past one is
  // overdue, and both of them are still unfinished.
  await card.getByRole("button", { name: "In progress", exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(["Zebra review"]);

  await card.getByRole("button", { name: "Overdue", exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(["Aardvark fix"]);

  await card.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(4);

  // Clearing is one click, and the icon stops advertising a narrowed list.
  await card.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);
  await expect(button).toHaveAttribute("data-active", "false");

  // Escape closes the card and hands the icon back its focus.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(button).toBeFocused();

  expect(errors).toEqual([]);
});

test("the order also decides inside the pinned group", async ({ page }) => {
  await page.goto("/tests/todo-view.html?theme=dark&language=en-US");
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  // A second pin: under the default order the latest star leads the pinned group, above the older
  // one — and both still sit above every task that is not pinned.
  await page
    .locator('[data-testid="todo-row"]', { hasText: "Zebra review" })
    .getByTestId("todo-star")
    .click();

  await expect.poll(() => titles(page)).toEqual([
    "Zebra review",
    "Delta inbox",
    "Beta write-up",
    "Aardvark fix",
    "Gamma archive",
  ]);

  // A chosen order decides the pins among themselves as well: A→Z puts Delta back in front of
  // Zebra, while both stay above the unpinned tasks.
  await page.getByTestId("todo-sort-button").click();
  await page
    .getByRole("dialog", { name: "Sort", exact: true })
    .getByRole("button", { name: "Title A→Z", exact: true })
    .click();

  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Zebra review",
    "Aardvark fix",
    "Beta write-up",
    "Gamma archive",
  ]);
});

test("the sort card reorders the rows and keeps the pinned task in front", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-view.html?theme=dark&language=en-US");
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  const button = page.getByTestId("todo-sort-button");

  await button.click();

  const card = cardOf(page, "Sort");
  const option = (name: string) => card.getByRole("button", { name, exact: true });

  // Newest first under the pin is the order the list has always had.
  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Beta write-up",
    "Aardvark fix",
    "Zebra review",
    "Gamma archive",
  ]);

  await option("Due soonest").click();
  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Aardvark fix",
    "Zebra review",
    "Beta write-up",
    "Gamma archive",
  ]);
  await expect(button).toHaveAttribute("data-active", "true");

  await option("Oldest first").click();
  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Zebra review",
    "Aardvark fix",
    "Beta write-up",
    "Gamma archive",
  ]);

  await option("Title A→Z").click();
  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Aardvark fix",
    "Beta write-up",
    "Zebra review",
    "Gamma archive",
  ]);

  // Back to the default, and the dot that says "another order" goes out with it.
  await option("Default (pinned first)").click();
  await expect.poll(() => titles(page)).toEqual([
    "Delta inbox",
    "Beta write-up",
    "Aardvark fix",
    "Zebra review",
    "Gamma archive",
  ]);
  await expect(button).toHaveAttribute("data-active", "false");

  // The card belongs to its icon; a click anywhere else is the way out.
  await page.mouse.click(30, 720);
  await expect(card).toHaveCount(0);

  expect(errors).toEqual([]);
});
