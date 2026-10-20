import { expect, test, type Page } from "@playwright/test";

/** Pixels the column hands to the scrollbar; `0` when the bar is not reserved. */
function gutterOf(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="content"]');

    return element === null ? null : element.offsetWidth - element.clientWidth;
  });
}

/**
 * A bar that appears with the content narrows the reading column by its own width, so a page that
 * grows past the window twitches sideways and a click can land on the neighbour of the element it
 * aimed at. The column therefore reserves the bar before it is needed.
 */
test("the reading column keeps its width whether or not the page overflows", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.goto("/");

  const content = page.locator('[data-testid="content"]');
  await expect(content).toBeVisible();

  const declared = await content.evaluate((element) => {
    const computed = getComputedStyle(element);

    return { gutter: computed.scrollbarGutter, overflowY: computed.overflowY };
  });

  expect(declared.overflowY).toBe("scroll");
  expect(declared.gutter).toBe("stable");

  // The dashboard overflows this window; the event stream does not. Both must spend the same width
  // on the bar, or the column jumps the moment the content grows.
  const overflowing = await gutterOf(page);

  await page.locator('[data-testid="nav"] a[href="#/events"]').click();
  await expect(page.locator('[data-testid="content"]')).toBeVisible();

  const short = await gutterOf(page);

  expect(overflowing).not.toBeNull();
  expect(short).not.toBeNull();
  expect(overflowing).toBeGreaterThan(0);
  expect(short).toBe(overflowing);
});
