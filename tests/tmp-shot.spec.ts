import { test } from "@playwright/test";

test.use({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });

test("shoot the events header", async ({ page }) => {
  for (const theme of ["dark", "light"]) {
    await page.goto(`/tests/events-timeline.html?theme=${theme}&language=zh-CN`);
    await page.getByTestId("event-row").first().waitFor();
    await page.getByRole("button", { name: /^选择日期: / }).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      clip: { height: 460, width: 1000, x: 0, y: 0 },
      path: `.cache/shots/head-${theme}.png`,
    });
  }
});
