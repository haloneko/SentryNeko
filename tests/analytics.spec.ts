import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 1000, height: 900 } });

const opener = (page: Page) => page.getByRole("button", { name: /^Choose a day: / });
const calendar = (page: Page) => page.getByRole("dialog", { name: "Choose a day" });
const askedFrom = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hourlyFrom?: number }).__hourlyFrom ?? 0);

/** Local midnight `days` before the one the page opened on. */
async function shiftFrom(page: Page, base: number, days: number): Promise<number> {
  return page.evaluate(
    ({ base: value, days: offset }) => {
      const date = new Date(value * 1000);

      date.setDate(date.getDate() + offset);

      return Math.floor(date.getTime() / 1000);
    },
    { base, days },
  );
}

test("the day block reads the day its navigator shows", async ({ page }) => {
  await page.goto("/tests/analytics.html?theme=dark&language=en-US");
  await expect(opener(page)).toBeVisible();

  const today = await askedFrom(page);

  // Today is the last day there is, so the day block can only walk back.
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect
    .poll(async () => askedFrom(page))
    .toBe(await shiftFrom(page, today, -1));
  await expect(page.getByRole("button", { name: "Next day" })).toBeEnabled();
});

test("the calendar jumps the whole day block, not just its label", async ({ page }) => {
  await page.goto("/tests/analytics.html?theme=dark&language=en-US");
  await expect(opener(page)).toBeVisible();

  const today = await askedFrom(page);

  await opener(page).click();

  // A week back, chosen from the grid rather than walked to.
  const target = await shiftFrom(page, today, -7);
  const targetDay = await page.evaluate((value) => {
    const date = new Date(value * 1000);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${date.getFullYear()}-${month}-${day}`;
  }, target);

  if ((await calendar(page).locator(`[data-day="${targetDay}"]`).count()) === 0) {
    await calendar(page).getByRole("button", { name: "Previous month" }).click();
  }

  await calendar(page).locator(`[data-day="${targetDay}"]`).click();

  await expect.poll(async () => askedFrom(page)).toBe(target);
  await expect(calendar(page)).toHaveCount(0);

  // Today is no longer the day on show, so the calendar offers the way back.
  await opener(page).click();
  await page.getByRole("button", { name: "Today" }).click();
  await expect.poll(async () => askedFrom(page)).toBe(today);
});
