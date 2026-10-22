import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 900, height: 760 } });

const rowOf = (page: Page, title: string) =>
  page.locator('[data-testid="todo-row"]', { hasText: title });

test("a title edits in place without a box and can hold a second line", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");

  const row = rowOf(page, "写周报");
  const card = row.locator('[data-testid="todo-card"]');
  const title = row.locator('[data-testid="todo-title"]');

  await title.click();

  const field = page.locator('[data-testid="todo-input-inline"]');
  await expect(field).toBeFocused();
  await expect(card).toHaveAttribute("data-editing", "true");

  // The field draws nothing of its own: the row's ring is what says a title is open.
  const drawn = await field.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      background: style.backgroundColor,
      border: style.borderWidth,
      padding: style.paddingTop,
    };
  });
  expect(drawn).toEqual({ background: "rgba(0, 0, 0, 0)", border: "0px", padding: "0px" });

  // A plain Enter stores the title; a shifted one opens a line the row keeps and the field grows into.
  await page.keyboard.type(" — 补充");
  await field.press("Shift+Enter");
  await page.keyboard.type("第二行");

  await expect
    .poll(async () => (await field.boundingBox())?.height ?? 0)
    .toBeGreaterThan(34);

  await field.press("Enter");

  await expect(field).toHaveCount(0);
  await expect(card).toHaveAttribute("data-editing", "false");
  expect(await title.innerText()).toBe("写周报 — 补充\n第二行");
  expect(errors).toEqual([]);
});

test("the caret lands where the title is clicked", async ({ page }) => {
  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");

  const row = rowOf(page, "写周报");
  const title = row.locator('[data-testid="todo-title"]');
  const field = page.locator('[data-testid="todo-input-inline"]');
  const caret = () =>
    field.evaluate((element) => (element as HTMLTextAreaElement).selectionStart);

  // The left edge puts the caret before the first character.
  await title.click({ position: { x: 1, y: 11 } });
  await expect(field).toBeFocused();
  await expect.poll(caret).toBe(0);

  await field.press("Escape");
  await expect(field).toHaveCount(0);

  // The far right of the row is past the text, so the caret waits after the last one.
  const box = await title.boundingBox();
  await title.click({ position: { x: (box?.width ?? 40) - 2, y: 11 } });
  await expect.poll(caret).toBe("写周报".length);

  await field.press("Escape");
  await expect(field).toHaveCount(0);

  // Inside the second character the caret stops at a boundary inside the title, not at its end.
  await title.click({ position: { x: 22, y: 11 } });
  await expect.poll(caret).toBeGreaterThan(0);
  await expect.poll(caret).toBeLessThan("写周报".length);
});

test("Escape leaves the title as it was", async ({ page }) => {
  await page.goto("/tests/todo-selection.html?theme=dark&language=en-US");

  const row = rowOf(page, "写周报");

  await row.locator('[data-testid="todo-title"]').click();
  await page.keyboard.type("丢弃");
  await page.keyboard.press("Escape");

  await expect(page.locator('[data-testid="todo-input-inline"]')).toHaveCount(0);
  await expect(row.locator('[data-testid="todo-title"]')).toHaveText("写周报");
});
