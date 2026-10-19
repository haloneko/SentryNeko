import assert from "node:assert/strict";
import test from "node:test";

import { ALARM_DEFAULTS_KEY, POMODORO_DURATIONS_KEY, parseSetting } from "../.cache/sidebar-test/setting.js";

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

test("the keys match the rows the backend files", () => {
  assert.equal(POMODORO_DURATIONS_KEY, "pomodoro.durations");
  assert.equal(ALARM_DEFAULTS_KEY, "alarm.defaults");
});
