import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 900, height: 760 } });

/** The canvas holds 2 880 rows of 36px in the busy fixture. */
const DAY_HEIGHT = 2_880 * 36;

const rows = (page: Page) => page.locator('[data-testid="event-row"]');
const viewport = (page: Page) => page.getByTestId("event-viewport");
const slider = (page: Page) => page.getByRole("slider", { name: "Timeline position" });

/** Clicks the middle of the axis, which lands on noon in the busy fixture. */
async function seekNoon(page: Page): Promise<void> {
  const track = slider(page);
  const box = await track.boundingBox();

  await track.click({ position: { x: (box?.width ?? 600) / 2, y: (box?.height ?? 26) / 2 } });
}

test("one day fills the axis, and the list draws only what is seen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  // The axis is a whole day, whatever the day holds.
  await expect(page.getByText("00:00", { exact: true })).toBeVisible();
  await expect(page.getByText("24:00", { exact: true })).toBeVisible();
  await expect(slider(page)).toHaveAttribute("aria-valuemax", "2879");
  await expect(slider(page)).toHaveAttribute("aria-valuenow", "0");

  // 2 880 switches become a few hundred marks at most: the axis cuts the day into slices first.
  const ticks = page.getByTestId("event-tick");
  const tickCount = await ticks.count();
  expect(tickCount).toBeGreaterThan(0);
  expect(tickCount).toBeLessThanOrEqual(360);

  // The canvas is as tall as every row, but only the rows in sight exist.
  expect(await viewport(page).evaluate((element) => element.scrollHeight)).toBe(DAY_HEIGHT);
  expect(await rows(page).count()).toBeLessThan(60);

  // The bottom of the list is the first switch of the day, still without drawing the rest.
  await viewport(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(rows(page).filter({ hasText: "Window 0" })).toBeVisible();
  expect(await rows(page).count()).toBeLessThan(60);

  expect(errors).toEqual([]);
});

test("seeking on the axis brings that moment into view", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  await seekNoon(page);

  // Noon itself is row 1 440 of the day, newest first.
  await expect(slider(page)).toHaveAttribute("aria-valuenow", "1439");

  const noon = page.locator('[data-testid="event-row"] time', { hasText: "12:00 PM" });

  await expect(noon.first()).toBeVisible();
  expect(await viewport(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("the wheel zooms around the pointer, and a drag slides the day", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  await seekNoon(page);

  const track = slider(page);
  const box = await track.boundingBox();
  const width = box?.width ?? 600;
  const middle = {
    x: (box?.x ?? 0) + width / 2,
    y: (box?.y ?? 0) + (box?.height ?? 26) / 2,
  };

  // The wheel zooms in around the pointer: the moment under it stays under it.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -120);
  await expect(page.getByText("06:00", { exact: true })).toBeVisible();
  await expect(page.getByText("18:00", { exact: true })).toBeVisible();

  await page.mouse.wheel(0, -120);
  await expect(page.getByText("09:00", { exact: true })).toBeVisible();
  await expect(page.getByText("15:00", { exact: true })).toBeVisible();

  // Zoom changes the window; the list still holds the whole day.
  expect(await viewport(page).evaluate((element) => element.scrollHeight)).toBe(DAY_HEIGHT);

  // Dragging the bar left slides the window towards the evening, without seeking: the playhead
  // stays on the same switch it was on.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x - width * 0.25, middle.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByTestId("axis-start")).toHaveText(/^10:[0-5]\d$/);
  await expect(page.getByTestId("axis-end")).toHaveText(/^16:[0-5]\d$/);
  await expect(track).toHaveAttribute("aria-valuenow", "1439");

  // Widening again walks back to the day itself, where there is nothing left to zoom out of.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await expect(page.getByTestId("axis-start")).toHaveText("00:00");
  await expect(page.getByTestId("axis-end")).toHaveText("24:00");

  // The wheel is the whole zoom: the axis carries no buttons of its own.
  await expect(page.getByRole("button", { name: /Zoom the axis/ })).toHaveCount(0);
});

test("a stretch of time is drawn with square corners", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  const radius = await page
    .getByTestId("event-tick")
    .first()
    .evaluate((element) => getComputedStyle(element).borderTopLeftRadius);

  expect(radius).toBe("0px");
});

test("the arrows move by a day, and nothing loads by page", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  const next = page.getByRole("button", { name: "Next day" });

  // Today is the newest day there is, and a day is the only unit the page loads.
  await expect(next).toBeDisabled();
  await expect(page.getByRole("button", { name: "Load older events" })).toHaveCount(0);

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByTestId("event-viewport")).toBeVisible();
  expect(await viewport(page).evaluate((element) => element.scrollHeight)).toBe(12 * 36);
  await expect(next).toBeEnabled();

  // The jump back to today is the calendar's, so it is opened rather than clicked in the row.
  await page.getByRole("button", { name: /^Choose a day: / }).click();
  await page.getByRole("button", { name: "Today" }).click();
  expect(await viewport(page).evaluate((element) => element.scrollHeight)).toBe(DAY_HEIGHT);
  await expect(next).toBeDisabled();
});

test("the calendar jumps to a day the arrows would have to walk to", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US");
  await expect(rows(page).first()).toBeVisible();

  await page.getByRole("button", { name: /^Choose a day: / }).click();

  const calendar = page.getByRole("dialog", { name: "Choose a day" });
  const others = calendar.locator('[data-day]:enabled:not([data-selected="true"])');

  // The fixture only holds today and yesterday, so a pick other than today lands on an empty day.
  // On the first of the month there is no such day left in it, so the grid walks back one.
  if ((await others.count()) === 0) {
    await calendar.getByRole("button", { name: "Previous month" }).click();
  }

  await calendar.locator('[data-day]:enabled:not([data-selected="true"])').first().click();

  await expect(page.getByText("Nothing was in front on this day.")).toBeVisible();

  // Opening the calendar again offers the way back to today, whatever day was picked.
  await page.getByRole("button", { name: /^Choose a day: / }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose a day" }).getByRole("button", { name: "Today" }),
  ).toBeVisible();
});

test("a day with nothing in front says so, and a cut day says it was cut", async ({ page }) => {
  await page.goto("/tests/events-timeline.html?theme=dark&language=en-US&truncated=1");
  await expect(page.getByText(/only the latest 20000 are shown/)).toBeVisible();

  // Yesterday still has rows; the day before it has none.
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByTestId("event-viewport")).toBeVisible();

  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByText("Nothing was in front on this day.")).toBeVisible();
});
