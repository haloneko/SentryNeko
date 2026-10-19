import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fixture = "/tests/numeric-input.html";
const field = (page: Page) => page.getByRole("spinbutton", { name: "Test value" });

test("typing emits numbers, rejects malformed paste, and settles without submitting", async ({ page }) => {
  await page.goto(fixture);
  const input = field(page);
  await input.fill("25");
  await expect(page.getByTestId("changes")).toHaveText("[25]");
  for (const invalid of ["12cats", "NaN", "Infinity", "1e3", "0x20", "1.2.3"]) {
    await input.fill(invalid);
    await expect(input).toHaveValue("25");
  }
  await input.press("Enter");
  await expect(page.getByTestId("changes")).toHaveText("[25]");
  await expect(page.getByTestId("submits")).toHaveText("0");
});

test("clamps both bounds and disables the corresponding arrow", async ({ page }) => {
  await page.goto(`${fixture}?min=10&max=30&value=20`);
  const input = field(page);
  await input.fill("999");
  await input.press("Tab");
  await expect(input).toHaveValue("30");
  await expect(page.getByRole("button", { name: "Increase test value" })).toBeDisabled();
  await input.fill("-99");
  await input.press("Enter");
  await expect(input).toHaveValue("10");
  await expect(page.getByRole("button", { name: "Decrease test value" })).toBeDisabled();
  await expect(page.getByTestId("changes")).toHaveText("[30,10]");
});

test("temporary blanks and signs never publish invalid values", async ({ page }) => {
  await page.goto(fixture);
  const input = field(page);
  for (const text of ["", "-", ".", "-."]) {
    await input.fill(text);
    await expect(page.getByTestId("changes")).toHaveText("[]");
    await input.press("Tab");
    await expect(input).toHaveValue("5");
  }
  await input.fill("");
  await input.pressSequentially("25");
  await expect(input).toHaveValue("25");
  await expect(page.getByTestId("value")).toHaveText("25");
});

test("wheel works without focus and never scrolls the surrounding page", async ({ page }) => {
  await page.goto(fixture);
  const input = field(page);
  await input.hover();
  await page.mouse.wheel(0, -100);
  await expect(input).toHaveValue("6");
  await expect(input).not.toBeFocused();
  await page.mouse.wheel(0, 100);
  await expect(input).toHaveValue("5");
  await expect.poll(() => page.getByTestId("scroll-box").evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByTestId("changes")).toHaveText("[6,5]");
});

test("wheel ignores zoom gestures and horizontal scrolling", async ({ page }) => {
  await page.goto(fixture);
  for (const options of [{ deltaY: -100, ctrlKey: true }, { deltaY: -100, metaKey: true }, { deltaX: 100 }, { deltaX: 100, deltaY: 1 }]) {
    const prevented = await field(page).evaluate((element, init) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, options);
    expect(prevented).toBe(false);
  }
  await expect(page.getByTestId("changes")).toHaveText("[]");
});

test("arrows, keyboard and decimal wheel steps share the same value", async ({ page }) => {
  await page.goto(`${fixture}?min=-1&max=1&step=0.1&value=0`);
  const input = field(page);
  await page.getByRole("button", { name: "Increase test value" }).click();
  await input.press("ArrowUp");
  await input.hover();
  await page.mouse.wheel(0, -100);
  await expect(input).toHaveValue("0.3");
  await page.getByRole("button", { name: "Decrease test value" }).click();
  await input.press("ArrowDown");
  await expect(input).toHaveValue("0.1");
  await expect(page.getByTestId("changes")).toHaveText("[0.1,0.2,0.3,0.2,0.1]");
  await expect(page.getByTestId("submits")).toHaveText("0");
});

test("fractional steps are relative to min and support scientific notation", async ({ page }) => {
  await page.goto(`${fixture}?min=0.05&max=1&step=0.1&value=0.05`);
  const input = field(page);
  await input.fill("0.24");
  await input.press("Enter");
  await expect(input).toHaveValue("0.25");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("0.15");
  await page.goto(`${fixture}?min=0&max=1&step=1e-7&value=0`);
  await field(page).press("ArrowUp");
  await expect(field(page)).toHaveValue("1e-7");
  await field(page).press("ArrowUp");
  await expect(field(page)).toHaveValue("2e-7");
});

test("steps clamp to an off-grid bound and move away by exactly one step", async ({ page }) => {
  await page.goto(`${fixture}?min=0&max=10&step=3&value=9`);
  const input = field(page);
  await input.press("ArrowUp");
  await expect(input).toHaveValue("10");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("7");
  await input.press("Tab");
  await expect(input).toHaveValue("7");
  await input.fill("999");
  await input.press("Enter");
  await expect(input).toHaveValue("10");
});

test("parent updates and changed steps reach the wheel listener", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "External update" }).click();
  await expect(field(page)).toHaveValue("42");
  await page.getByRole("button", { name: "Change step" }).click();
  await field(page).hover();
  await page.mouse.wheel(0, -100);
  await expect(field(page)).toHaveValue("42.5");
  await page.getByRole("button", { name: "Toggle field" }).click();
  await expect(field(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle field" }).click();
  await field(page).hover();
  await page.mouse.wheel(0, -100);
  await expect(page.getByTestId("changes")).toHaveText("[42.5,43]");
});

for (const flag of ["disabled", "readonly"]) {
  test(`${flag} fields ignore keyboard and wheel changes and allow scrolling`, async ({ page }) => {
    await page.goto(`${fixture}?${flag}`);
    const input = field(page);
    await expect(page.getByRole("button", { name: "Increase test value" })).toBeDisabled();
    if (flag === "readonly") {
      await input.press("ArrowUp");
    }
    await input.hover();
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.getByTestId("scroll-box").evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByTestId("changes")).toHaveText("[]");
  });
}

test("unbounded fields support negative values", async ({ page }) => {
  await page.goto(`${fixture}?unbounded&value=-5&step=2`);
  const input = field(page);
  await input.fill("-8");
  await input.press("ArrowDown");
  await expect(input).toHaveValue("-10");
});

for (const theme of ["light", "dark"]) {
  test(`uses ${theme} theme tokens outside a settings form`, async ({ page }) => {
    await page.goto(`${fixture}?theme=${theme}`);
    const colors = await field(page).evaluate((element) => ({
      text: getComputedStyle(element).color,
      background: getComputedStyle(element.parentElement!).backgroundColor,
    }));
    expect(colors).toEqual(theme === "light"
      ? { text: "rgb(22, 25, 34)", background: "rgb(255, 255, 255)" }
      : { text: "rgb(233, 236, 243)", background: "rgb(26, 31, 42)" });
  });
}

test("settings persist bounded Pomodoro minutes and alarm seconds", async ({ page }) => {
  await page.goto(`${fixture}?settings`);
  const focus = page.getByRole("spinbutton", { name: "Focus (minutes)", exact: true });
  const alarm = page.getByRole("spinbutton", { name: "Ring duration (seconds)" });
  await focus.fill("999");
  await focus.press("Enter");
  await alarm.fill("999");
  await alarm.press("Enter");
  await expect(focus).toHaveValue("240");
  await expect(alarm).toHaveValue("60");
  await expect.poll(() => page.evaluate(() => window.numericInputSaves)).toEqual(expect.arrayContaining([
    { command: "pomodoro.durations", value: { focusSeconds: 14400, shortBreakSeconds: 300, longBreakSeconds: 900 } },
    { command: "alarm.defaults", value: { method: "toast", ringSeconds: 60 } },
  ]));
});

test("settings arrows use the translated field names", async ({ page }) => {
  await page.goto(`${fixture}?settings&language=zh-CN`);
  await expect(page.getByRole("spinbutton")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^增大/ })).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^减小/ })).toHaveCount(4);
});

for (const setting of [
  { label: "Focus (minutes)", command: "pomodoro.durations" },
  { label: "Ring duration (seconds)", command: "alarm.defaults" },
]) {
  test(`${setting.label} saves on blur before the settings form unmounts`, async ({ page }) => {
    await page.goto(`${fixture}?settings`);
    const input = page.getByRole("spinbutton", { name: setting.label, exact: true });
    await expect(input).toBeEnabled();
    await input.fill("27");
    await page.getByRole("button", { name: "Unmount settings" }).click();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.numericInputSaves)).toEqual([
      { command: setting.command, value: setting.command === "pomodoro.durations"
        ? { focusSeconds: 1620, shortBreakSeconds: 300, longBreakSeconds: 900 }
        : { method: "toast", ringSeconds: 27 } },
    ]);
  });
}
