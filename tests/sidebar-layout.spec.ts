import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 960 } });

test("sidebar editor drags with animation, persists hidden panels and restores focus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/settings");
  const edit = page.getByRole("button", { name: "Edit sidebar", exact: true });
  await edit.click();
  const editor = page.getByRole("dialog", { name: "Edit sidebar" });
  await expect(editor).toBeVisible();
  const rows = editor.locator(".sidebar-editor-row");
  await editor.getByRole("switch", { name: "Show Todos" }).uncheck();
  const first = await editor.getByRole("button", { name: "Reorder Dashboard" }).boundingBox();
  const third = await rows.nth(2).boundingBox();
  if (!first || !third) throw new Error("Missing drag geometry");
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await expect(rows.first()).toHaveAttribute("data-dragging", "true");
  await page.mouse.move(first.x + first.width / 2, third.y + third.height / 2, { steps: 12 });
  await expect(rows.nth(2)).toContainText("Dashboard");
  expect(await rows.evaluateAll((elements) => elements.some((element) => element.getAnimations().length > 0))).toBe(true);
  await page.mouse.up();
  await expect(rows.first()).toContainText("Todos");
  await expect(page.locator(".nav a[href='#/todos']")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("sidebar-editor.png") });
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(edit).toBeFocused();
  await page.reload();
  await edit.click();
  await expect(rows.first()).toContainText("Todos");
  await expect(editor.getByRole("switch", { name: "Show Todos" })).not.toBeChecked();
  await editor.getByRole("button", { name: "Restore default sidebar" }).click();
  await expect(rows.first()).toContainText("Dashboard");
  await expect(editor.getByRole("switch", { name: "Show Todos" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keyboard controls move hidden panels and retain Settings when every panel is hidden", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Edit sidebar", exact: true }).click();
  const editor = page.getByRole("dialog");
  const handle = editor.getByRole("button", { name: "Reorder Todos" });
  await handle.focus();
  await handle.press("End");
  await expect(editor.locator(".sidebar-editor-row").last()).toContainText("Todos");
  await handle.press("Home");
  await expect(editor.locator(".sidebar-editor-row").first()).toContainText("Todos");
  for (const toggle of await editor.getByRole("switch").all()) await toggle.uncheck();
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".nav .nav-link")).toHaveCount(1);
  await expect(page.locator(".nav .nav-link")).toHaveAttribute("href", "#/settings");
});

test("reduced motion and Chinese copy fit the minimum window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  await page.getByRole("button", { name: "编辑侧栏", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑侧栏" });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("sidebar-editor-zh.png") });
  await editor.getByRole("button", { name: "完成", exact: true }).click();
  await expect(editor).toHaveCount(0);
});
