import assert from "node:assert/strict";
import test from "node:test";

import { dayTotals, focusRows, MAX_STACKED_APPS, stackHours } from "../.cache/sidebar-test/hourly.js";

const at = (hour) => new Date(2026, 9, 21, hour, 0, 0).getTime() / 1000;
const usage = (appName, hour, minutes) => ({ appName, hourStart: at(hour), seconds: minutes * 60 });

test("both measures are added up and the busiest app is named", () => {
  const totals = dayTotals(
    [usage("Code", 9, 40), usage("Code", 10, 20), usage("Chrome", 9, 30)],
    [
      { hourStart: at(9), seconds: 600 },
      { hourStart: at(10), seconds: 1_200 },
    ],
  );

  assert.deepEqual(totals, {
    apps: 90 * 60,
    focus: 30 * 60,
    top: { name: "Code", seconds: 60 * 60 },
  });
});

test("a tie for the busiest app is settled by name, so a day always names the same one", () => {
  const totals = dayTotals([usage("Slack", 9, 10), usage("Chrome", 9, 10)], []);

  assert.deepEqual(totals.top, { name: "Chrome", seconds: 600 });
});

test("an empty day reports zeros and no busiest app", () => {
  assert.deepEqual(dayTotals([], []), { apps: 0, focus: 0, top: null });
});

test("the stack keeps the busiest apps and folds the tail into one grey slice", () => {
  const names = Array.from({ length: MAX_STACKED_APPS + 2 }, (_, index) => `app-${index}`);
  const buckets = names.map((appName, index) => usage(appName, 9, 30 - index));
  const { apps, rows } = stackHours(buckets, "Other apps");

  assert.deepEqual(
    apps.map((app) => app.name),
    [...names.slice(0, MAX_STACKED_APPS), "Other apps"],
  );
  assert.equal(apps.at(-1).other, true);
  assert.equal(rows[9].hour, 9);
  assert.equal(
    Object.entries(rows[9])
      .filter(([key]) => key !== "hour")
      .reduce((sum, [, seconds]) => sum + seconds, 0),
    buckets.reduce((sum, bucket) => sum + bucket.seconds, 0),
  );
});

test("focus buckets land in their local hour, and the rest of the day stays empty", () => {
  const rows = focusRows([{ hourStart: at(14), seconds: 900 }]);

  assert.equal(rows.length, 24);
  assert.equal(rows[14].seconds, 900);
  assert.equal(rows[13].seconds, 0);
});
