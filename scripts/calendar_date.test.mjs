import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformWithOxc } from "vite";

// Use Vite's TypeScript transform so tests also run on the supported Node 20.
const source = readFileSync(
  new URL("../src/components/ui/calendarDate.ts", import.meta.url),
  "utf8",
);
const { code } = await transformWithOxc(source, "calendarDate.ts");
const { dateFromParts, dateParts, daysInMonth, relativeDate } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

test("February follows the Gregorian leap-year and century rules", () => {
  for (const [year, days] of [
    [2000, 29],
    [2024, 29],
    [2025, 28],
    [2100, 28],
  ]) {
    assert.equal(daysInMonth(year, 2), days);
  }
});

test("every month exposes its correct number of days", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, month) => daysInMonth(2025, month + 1)),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
  );
});

test("month/year changes clamp an unavailable day instead of rolling into the next month", () => {
  for (const [parts, expected] of [
    [
      { year: 2025, month: 4, day: 31 },
      { year: 2025, month: 4, day: 30 },
    ],
    [
      { year: 2024, month: 2, day: 31 },
      { year: 2024, month: 2, day: 29 },
    ],
    [
      { year: 2025, month: 2, day: 29 },
      { year: 2025, month: 2, day: 28 },
    ],
    [
      { year: 2100, month: 2, day: 29 },
      { year: 2100, month: 2, day: 28 },
    ],
  ]) {
    assert.deepEqual(dateParts(dateFromParts(parts)), expected);
  }
});

test("date-only storage round-trips without using the machine's timezone", () => {
  const parts = { year: 2024, month: 2, day: 29 };
  assert.equal(dateFromParts(parts), Date.parse("2024-02-29T00:00:00Z") / 1000);
  assert.deepEqual(dateParts(dateFromParts(parts)), parts);
  assert.equal(dateFromParts({ year: 1970, month: 1, day: 1 }), 0);
  assert.equal(dateFromParts({ year: 9999, month: 12, day: 31 }), 253402214400);
});

test("today uses the local calendar even late at night", () => {
  const now = new Date(2026, 9, 18, 23, 59);
  assert.deepEqual(dateParts(relativeDate(0, now)), {
    year: 2026,
    month: 10,
    day: 18,
  });
  assert.equal(now.getDate(), 18, "the input clock is not mutated");
});

test("tomorrow crosses month, leap-day, year and DST boundaries", () => {
  for (const [now, expected] of [
    [new Date(2026, 0, 31, 23, 30), { year: 2026, month: 2, day: 1 }],
    [new Date(2024, 1, 28, 23, 30), { year: 2024, month: 2, day: 29 }],
    [new Date(2025, 1, 28, 23, 30), { year: 2025, month: 3, day: 1 }],
    [new Date(2026, 11, 31, 23, 30), { year: 2027, month: 1, day: 1 }],
    [new Date(2026, 2, 8, 0, 30), { year: 2026, month: 3, day: 9 }],
    [new Date(2026, 10, 1, 0, 30), { year: 2026, month: 11, day: 2 }],
  ]) {
    assert.deepEqual(dateParts(relativeDate(1, now)), expected);
  }
});
