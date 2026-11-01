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

  // Hung from the icon: never to the right of it, covering it, one gap below. It is pulled back
  // only when the window edge is too close for the card's own width.
  const box = await card.boundingBox();
  expect(box?.x ?? 0).toBeLessThanOrEqual((anchor?.x ?? 0) + 1);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThanOrEqual(
    (anchor?.x ?? 0) + (anchor?.width ?? 0),
  );
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

test("the search reads # as tags only and spaces as conditions that all have to hold", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-view.html?theme=dark&language=en-US");
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  const search = page.getByRole("combobox", { name: "Search tasks" });

  // A word with # in front only a tag name can answer.
  await search.fill("#work");
  await expect.poll(() => titles(page)).toEqual(["Zebra review"]);

  await search.fill("#long");
  await expect.poll(() => titles(page)).toEqual(["Beta write-up"]);

  // Without the sigil the same word still finds the task through its tag.
  await search.fill("work");
  await expect.poll(() => titles(page)).toEqual(["Zebra review"]);

  // Two conditions narrow instead of widening: one task carries both, and no task swaps them.
  await search.fill("#work zebra");
  await expect.poll(() => titles(page)).toEqual(["Zebra review"]);

  await search.fill("#work beta");
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(0);
  await expect(page.getByText(/No tasks match/)).toBeVisible();

  // Escape empties the field before it leaves the page.
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(5);

  expect(errors).toEqual([]);
});

test("a # offers the tags, narrows after the pause, and completes by key or click", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-view.html?theme=dark&language=en-US");

  const search = page.getByRole("combobox", { name: "Search tasks" });
  const list = page.getByRole("listbox", { name: "Tag suggestions" });
  const options = list.getByRole("option");

  // The bare sigil offers every tag at once.
  await search.fill("#");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("#long-name-tag");

  // Typing narrows the list once the word settles, and Escape closes it without losing the text.
  await search.fill("#wo");
  await expect(options).toHaveCount(1);
  await expect(options).toContainText("#work");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(search).toHaveValue("#wo");

  // Enter completes the highlighted tag and leaves the caret ready for the next condition.
  await search.fill("#");
  await expect(options).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("#work ");
  await expect(list).toHaveCount(0);
  await expect(page.locator('[data-testid="todo-row"]')).toHaveCount(1);

  // A click takes the other one, and the list goes with it.
  await search.fill("#long");
  await expect(options).toHaveCount(1);
  await options.click();
  await expect(search).toHaveValue("#long-name-tag ");
  await expect.poll(() => titles(page)).toEqual(["Beta write-up"]);

  expect(errors).toEqual([]);
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
