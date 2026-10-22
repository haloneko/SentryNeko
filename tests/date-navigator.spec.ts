import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 760, height: 640 } });

const chosen = (page: Page) => page.getByTestId("chosen");
const opener = (page: Page) => page.getByRole("button", { name: /^Choose a day: / });
const calendar = (page: Page) => page.getByRole("dialog", { name: "Choose a day" });

/** Shifts a `YYYY-MM-DD` by whole days, which is how the fixture writes the day it holds. */
function shift(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const shifted = new Date(year, month - 1, date + days);
  const paddedMonth = String(shifted.getMonth() + 1).padStart(2, "0");
  const paddedDate = String(shifted.getDate()).padStart(2, "0");

  return `${shifted.getFullYear()}-${paddedMonth}-${paddedDate}`;
}

test("the arrows walk a day at a time, and today is the end of the road", async ({ page }) => {
  await page.goto("/tests/date-navigator.html?theme=dark&language=en-US");

  const today = (await chosen(page).textContent()) ?? "";
  const next = page.getByRole("button", { name: "Next day" });

  // Nothing is ahead of today, and the row itself carries no jump: that lives in the calendar.
  await expect(next).toBeDisabled();
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(chosen(page)).toHaveText(shift(today, -1));
  await expect(next).toBeEnabled();

  await opener(page).click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(chosen(page)).toHaveText(today);
  await expect(next).toBeDisabled();
  await expect(calendar(page)).toHaveCount(0);
});

test("the calendar picks a day the arrows would take too long to reach", async ({ page }) => {
  await page.goto("/tests/date-navigator.html?theme=dark&language=en-US");

  const today = (await chosen(page).textContent()) ?? "";

  await opener(page).click();
  await expect(calendar(page)).toBeVisible();

  // The calendar opens on the month being read, with that day already marked.
  const selected = calendar(page).locator('[data-selected="true"]');
  await expect(selected).toHaveAttribute("data-day", today);
  await expect(selected).toHaveAttribute("aria-current", "date");

  const other = calendar(page).locator('[data-day]:enabled:not([data-selected="true"])').first();
  const picked = await other.getAttribute("data-day");

  await other.click();
  await expect(chosen(page)).toHaveText(picked ?? "");
  await expect(calendar(page)).toHaveCount(0);
});

test("a range closes the days outside it", async ({ page }) => {
  await page.goto("/tests/date-navigator.html?theme=dark&language=en-US&min=1");

  const today = (await chosen(page).textContent()) ?? "";
  const earliest = shift(today, -3);
  const back = page.getByRole("button", { name: "Previous day" });

  for (let step = 1; step <= 3; step += 1) {
    await back.click();
    await expect(chosen(page)).toHaveText(shift(today, -step));
  }

  // The floor is a wall, not a warning: the arrow stops and the earlier days cannot be picked.
  await expect(back).toBeDisabled();

  await opener(page).click();

  const months = await calendar(page)
    .locator('[data-day]:enabled')
    .evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset.day ?? ""));
  expect(months.length).toBeGreaterThan(0);
  expect(months.every((day) => day >= earliest)).toBe(true);

  // A month wholly before the floor is not even reachable.
  await expect(calendar(page).getByRole("button", { name: "Previous month" })).toBeDisabled();
});

test("a year and a month can be picked outright, without walking month by month", async ({
  page,
}) => {
  await page.goto("/tests/date-navigator.html?theme=dark&language=en-US");

  const today = (await chosen(page).textContent()) ?? "";
  const year = Number(today.slice(0, 4));

  await opener(page).click();

  const title = page.getByRole("button", { name: "Choose a month" });

  await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  await expect(title).toHaveText(String(year));

  const months = calendar(page).getByRole("group", { name: "Choose a month" });

  // The month being read is marked, and the months still ahead of today are closed.
  await expect(months.locator('[aria-pressed="true"]')).toHaveCount(1);

  await calendar(page).getByRole("button", { name: "Previous year" }).click();
  await expect(title).toHaveText(String(year - 1));

  await months.getByRole("button", { name: "Mar" }).click();

  // The grid lands on that month of that year, and the day the page holds has not moved.
  await expect(calendar(page).getByRole("group", { name: `March ${year - 1}` })).toBeVisible();
  await expect(title).toHaveText(`March ${year - 1}`);
  await expect(chosen(page)).toHaveText(today);
});

test("the keyboard walks the grid and escape leaves it", async ({ page }) => {
  await page.goto("/tests/date-navigator.html?theme=dark&language=en-US");

  const today = (await chosen(page).textContent()) ?? "";

  await opener(page).click();

  // The grid opens with the focus on the chosen day, so a key press moves from there.
  await expect(calendar(page).locator('[data-selected="true"]')).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(calendar(page).locator("[data-day]:focus")).toHaveAttribute(
    "data-day",
    shift(today, -1),
  );

  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);

  // The day is still the one that was chosen, and the control has the focus back.
  await expect(chosen(page)).toHaveText(today);
  await expect(opener(page)).toBeFocused();
});
