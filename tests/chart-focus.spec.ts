import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 820, height: 520 } });

/** What the page focused, and how that element is drawn: the ring is what a press used to leave. */
async function focusStyle(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const active = document.activeElement;

    if (active === null) {
      return null;
    }

    const style = getComputedStyle(active);

    return {
      boxShadow: style.boxShadow,
      inPlot: active.closest(".recharts-wrapper") !== null,
      outline: style.outlineStyle,
      tag: active.tagName,
    };
  });
}

test("a click on a chart leaves no ring around the plot", async ({ page }) => {
  // Light first: the platform ring is dark there, which is the box that was reported.
  await page.goto("/tests/trend-chart.html?theme=light&language=en-US");

  const plot = page.locator(".recharts-wrapper").first();

  await expect(plot).toBeVisible();

  const box = await plot.boundingBox();

  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 300) / 2, (box?.y ?? 0) + 80);

  const focus = await focusStyle(page);

  // The press does reach the plot — that half is what made the ring appear — but nothing is drawn.
  expect(focus?.inPlot).toBe(true);
  expect(focus?.outline).toBe("none");
  expect(focus?.boxShadow).toBe("none");
});
