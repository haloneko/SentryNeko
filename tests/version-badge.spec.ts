import { expect, test } from "@playwright/test";

test("the version sits at the bottom-right corner of the app name", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  const version = page.locator('[data-testid="brand-version"]');
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/);

  // Small and grey: the size is its own, the colour is the same muted one as the tagline below
  // the name, which keeps the assertion honest in either theme.
  await expect(version).toHaveCSS("font-size", "10.5px");

  const muted = await page
    .locator('[data-testid="brand-tagline"]')
    .evaluate((element) => getComputedStyle(element).color);

  expect(await version.evaluate((element) => getComputedStyle(element).color)).toBe(muted);

  // It hugs the right edge of the brand's content box and drops to the name's baseline.
  const brand = await page.locator('[data-testid="brand"]').boundingBox();
  const name = await page.locator('[data-testid="brand-name"]').boundingBox();
  const label = await version.boundingBox();
  const inset = await page
    .locator('[data-testid="brand"]')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight));

  expect(brand).not.toBeNull();
  expect(name).not.toBeNull();
  expect(label).not.toBeNull();

  if (brand !== null && name !== null && label !== null) {
    expect(Math.abs(brand.x + brand.width - inset - (label.x + label.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(name.y + name.height - (label.y + label.height))).toBeLessThanOrEqual(1);
  }

  // The icon-only rail has no room for a footnote, so it folds away with the labels.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(version).toBeHidden();

  expect(errors).toEqual([]);
});
