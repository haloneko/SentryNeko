import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 800, height: 420 } });

const legend = (page: import("@playwright/test").Page) => page.getByRole("listitem");

test("the focus chart stacks one slice per category, folding the tail", async ({ page }) => {
  await page.goto("/tests/hourly-chart.html?kind=focus&language=en-US");

  // Busiest category first, the work nobody named among the folded ones.
  await expect(legend(page)).toHaveText([
    "writing",
    "reading",
    "reviewing",
    "planning",
    "pairing",
    "Other categories",
  ]);

  // The caption measures the whole stack of an hour, not one slice of it.
  await expect(page.getByText("Peak hour: 45 min")).toBeVisible();
  await expect(page.locator(".recharts-rectangle").first()).toBeVisible();
});

test("the app chart still stacks one slice per app", async ({ page }) => {
  await page.goto("/tests/hourly-chart.html?kind=apps&language=en-US");

  await expect(legend(page)).toHaveText(["Code", "Terminal", "Chrome", "Slack"]);
  await expect(page.getByText("Peak hour: 55 min")).toBeVisible();
});
