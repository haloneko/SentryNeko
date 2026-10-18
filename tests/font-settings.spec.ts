import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

test("the packaged font loads locally and typography persists across all task controls", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:1422") && !request.url().startsWith("data:")) external.push(request.url());
  });
  await page.goto("/#/settings");
  await page.getByLabel("Font", { exact: true }).selectOption("JetBrains Mono");
  const size = page.getByRole("spinbutton", { name: "Font size (px)" });
  await size.fill("18");
  await size.press("Tab");
  await expect(size).toHaveValue("18");
  expect(await page.evaluate(async () => {
    await document.fonts.load('18px "JetBrains Mono Variable"');
    return document.fonts.check('18px "JetBrains Mono Variable"');
  })).toBe(true);
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("JetBrains Mono Variable");
  await page.screenshot({ path: test.info().outputPath("font-settings.png") });
  await page.reload();
  await expect(size).toHaveValue("18");
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("JetBrains Mono");
  await page.goto("/#/todos");
  expect(await page.locator(".todo-composer-input").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("JetBrains Mono Variable");
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("font size uses the merged numeric input and respects bounds and keyboard stepping", async ({ page }) => {
  await page.goto("/#/settings");
  const size = page.getByRole("spinbutton", { name: "Font size (px)" });
  await size.fill("999");
  await size.press("Tab");
  await expect(size).toHaveValue("32");
  await expect(page.getByRole("button", { name: "Increase font size", exact: true })).toBeDisabled();
  await size.fill("10");
  await size.press("ArrowUp");
  await expect(size).toHaveValue("11");
  await page.getByRole("button", { name: "Increase font size", exact: true }).click();
  await expect(size).toHaveValue("12");
  await size.hover();
  await page.mouse.wheel(0, -100);
  await expect(size).toHaveValue("13");
});
