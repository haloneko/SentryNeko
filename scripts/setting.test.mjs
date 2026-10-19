import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ALARM_DEFAULTS, normalizeAlarmDefaults } from "../.cache/sidebar-test/alarm.js";
import { DEFAULT_DURATIONS, normalizeDurations } from "../.cache/sidebar-test/pomodoro.js";
import { parseSetting, SETTINGS } from "../.cache/sidebar-test/setting.js";

const row = (value) => ({ key: "alarm.defaults", value, category: "alarm", updatedAt: 1 });

test("a missing row falls back to the caller's defaults", () => {
  assert.deepEqual(parseSetting(null, { ringSeconds: 10 }), { ringSeconds: 10 });
});

test("a stored payload is parsed", () => {
  assert.deepEqual(parseSetting(row('{"ringSeconds":30,"method":"inApp"}'), { ringSeconds: 10 }), {
    ringSeconds: 30,
    method: "inApp",
  });
});

test("an unreadable payload falls back instead of throwing", () => {
  assert.deepEqual(parseSetting(row("{not json"), { ringSeconds: 10 }), { ringSeconds: 10 });
});

test("every key carries the category its row is filed under", () => {
  assert.deepEqual(SETTINGS.sidebarPanels, { category: "sidebar", key: "sidebar.panels" });
  assert.deepEqual(SETTINGS.dashboardGrid, { category: "dashboard", key: "dashboard.grid" });
  assert.deepEqual(SETTINGS.pomodoroDurations, {
    category: "pomodoro",
    key: "pomodoro.durations",
  });
  assert.deepEqual(SETTINGS.alarmDefaults, { category: "alarm", key: "alarm.defaults" });
});

test("the alarm defaults fall back field by field", () => {
  assert.deepEqual(normalizeAlarmDefaults(null), DEFAULT_ALARM_DEFAULTS);
  assert.deepEqual(normalizeAlarmDefaults({ ringSeconds: 30, method: "inApp" }), {
    ringSeconds: 30,
    method: "inApp",
  });
  assert.deepEqual(normalizeAlarmDefaults({ ringSeconds: 0, method: "inApp" }), {
    ringSeconds: DEFAULT_ALARM_DEFAULTS.ringSeconds,
    method: "inApp",
  });
  assert.deepEqual(normalizeAlarmDefaults({ ringSeconds: 30.5, method: "carrier" }), {
    ringSeconds: DEFAULT_ALARM_DEFAULTS.ringSeconds,
    method: DEFAULT_ALARM_DEFAULTS.method,
  });
  assert.deepEqual(normalizeAlarmDefaults({ ringSeconds: "30" }), DEFAULT_ALARM_DEFAULTS);
});

test("a pomodoro duration nobody could have entered falls back per phase", () => {
  assert.deepEqual(normalizeDurations(null), DEFAULT_DURATIONS);
  assert.deepEqual(
    normalizeDurations({ focusSeconds: 3000, shortBreakSeconds: 0, longBreakSeconds: 900 }),
    { focusSeconds: 3000, shortBreakSeconds: DEFAULT_DURATIONS.shortBreakSeconds, longBreakSeconds: 900 },
  );
  assert.deepEqual(normalizeDurations({ focusSeconds: 24 * 60 * 60 }), {
    focusSeconds: DEFAULT_DURATIONS.focusSeconds,
    shortBreakSeconds: DEFAULT_DURATIONS.shortBreakSeconds,
    longBreakSeconds: DEFAULT_DURATIONS.longBreakSeconds,
  });
});
