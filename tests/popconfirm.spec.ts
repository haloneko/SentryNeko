import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fixture = "/tests/popconfirm.html";
const panel = (page: Page) => page.getByRole("dialog");
const actions = (page: Page) => page.getByTestId("actions");

test("the default panel opens on the trigger and every way out runs nothing", async ({ page }) => {
  await page.goto(fixture);
  const trigger = page.getByRole("button", { name: "Default copy" });
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  const dialog = panel(page);
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // No title or body was given, so the panel carries only its two answers.
  await expect(dialog.getByRole("heading")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Yes" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "No" })).toBeFocused();

  await dialog.getByRole("button", { name: "No" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(actions(page)).toHaveText("[]");

  // The close button is icon-only, so its name comes from the label rather than its text.
  await trigger.click();
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText("[]");

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText("[]");

  // The mask: a click anywhere outside the panel dismisses it.
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText("[]");

  await trigger.click();
  await panel(page).getByRole("button", { name: "Yes" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText('["default"]');
});

test("the bubble is a small panel placed against its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(fixture);
  const trigger = page.getByRole("button", { name: "Default copy" });
  await trigger.click();

  const dialog = panel(page);
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  const anchor = await trigger.boundingBox();
  expect(box).not.toBeNull();
  expect(anchor).not.toBeNull();

  if (box !== null && anchor !== null) {
    // A bubble, not a window: narrower than a page column, and right under the button because
    // this trigger sits against the top edge, where there is no room above it.
    expect(box.width).toBeLessThanOrEqual(300);
    expect(box.y - (anchor.y + anchor.height)).toBeGreaterThanOrEqual(4);
    expect(box.y - (anchor.y + anchor.height)).toBeLessThanOrEqual(12);
    expect(box.x).toBeGreaterThanOrEqual(anchor.x - 1);
    expect(box.x).toBeLessThanOrEqual(anchor.x + 24);
  }

  await expect(dialog).toHaveAttribute("data-placement", "bottom");
});

test("the bubble opens upwards when there is room above the trigger", async ({ page }) => {
  await page.goto(fixture);
  const trigger = page.getByRole("button", { name: "Middle copy" });
  await trigger.click();

  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("data-placement", "top");

  const box = await dialog.boundingBox();
  const anchor = await trigger.boundingBox();
  expect(box).not.toBeNull();
  expect(anchor).not.toBeNull();

  if (box !== null && anchor !== null) {
    // Both sides have room here, so the preference shows: the bubble is above, caret down.
    expect(anchor.y - (box.y + box.height)).toBeGreaterThanOrEqual(4);
    expect(anchor.y - (box.y + box.height)).toBeLessThanOrEqual(12);
  }
});

test("a heading can stand alone, with an icon and a destructive answer", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Title only" }).click();

  const dialog = panel(page);
  await expect(dialog.getByRole("heading", { name: "Remove the saved filter?" })).toBeVisible();
  await expect(dialog.locator(".popconfirm-content")).toHaveCount(0);
  await expect(dialog.locator(".popconfirm-icon svg")).toHaveCount(1);
  await expect(dialog).toHaveAttribute("data-danger", "");

  const cancel = dialog.getByRole("button", { name: "No" });
  const confirm = dialog.getByRole("button", { name: "Remove it" });
  await expect(confirm).toHaveCSS("background-color", "rgb(229, 83, 75)");

  const dialogBox = await dialog.boundingBox();
  const cancelBox = await cancel.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(confirmBox).not.toBeNull();

  if (dialogBox !== null && cancelBox !== null && confirmBox !== null) {
    // Both answers hug the right edge, with a clear gap so a finger cannot slip onto the other.
    expect(confirmBox.x - (cancelBox.x + cancelBox.width)).toBeGreaterThanOrEqual(10);
    expect(dialogBox.x + dialogBox.width - (confirmBox.x + confirmBox.width)).toBeLessThanOrEqual(14);
  }

  await confirm.click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText('["titled"]');
});

test("a button against the right edge pulls the bubble back inside", async ({ page }) => {
  await page.goto(fixture);
  const trigger = page.getByRole("button", { name: "Right copy" });
  await trigger.click();

  const box = await panel(page).boundingBox();
  const anchor = await trigger.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(anchor).not.toBeNull();
  expect(viewport).not.toBeNull();

  if (box !== null && anchor !== null && viewport !== null) {
    // The bubble reaches a little past the button's right edge, and stays clear of the window's.
    expect(Math.abs(anchor.x + anchor.width + 12 - (box.x + box.width))).toBeLessThanOrEqual(1);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
  }
});

test("a trigger against the window edge opens the bubble above it", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Bottom copy" }).click();

  const dialog = panel(page);
  await expect(dialog).toHaveAttribute("data-placement", "top");

  const box = await dialog.boundingBox();
  const anchor = await page.getByRole("button", { name: "Bottom copy" }).boundingBox();
  expect(box).not.toBeNull();
  expect(anchor).not.toBeNull();

  if (box !== null && anchor !== null) {
    expect(box.y + box.height).toBeLessThanOrEqual(anchor.y);
  }
});

test("the four copy props replace the lines they stand for", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Custom copy" }).click();

  const dialog = panel(page);
  await expect(dialog.getByRole("heading", { name: "Delete this task?" })).toBeVisible();
  await expect(dialog).toContainText("The task and its history are removed.");

  await dialog.getByRole("button", { name: "Delete it" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText('["custom"]');
});

test("the defaults are translated with the rest of the interface", async ({ page }) => {
  await page.goto(`${fixture}?language=zh-CN`);
  await page.getByRole("button", { name: "Default copy" }).click();

  const dialog = panel(page);
  await expect(dialog.getByRole("button", { name: "是", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "否", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭" })).toBeVisible();

  await dialog.getByRole("button", { name: "否", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText("[]");
});

test("the trigger keeps its own handler and can veto the panel", async ({ page }) => {
  await page.goto(fixture);

  // The button's handler runs first, and the panel opens afterwards.
  await page.getByRole("button", { name: "Watched trigger" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(actions(page)).toHaveText('["trigger"]');
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // A trigger that prevents its own click never opens the panel.
  await page.getByRole("button", { name: "Blocked trigger" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(actions(page)).toHaveText('["trigger"]');
});
