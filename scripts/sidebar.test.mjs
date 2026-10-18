import assert from "node:assert/strict";
import test from "node:test";

import { defaultSidebarLayout, normalizeSidebarLayout, reorderSidebarLayout } from "../.cache/sidebar-test/sidebar.js";

test("first launch shows every available panel in the original order", () => {
  assert.deepEqual(defaultSidebarLayout(), [
    { id: "dashboard", visible: true },
    { id: "todos", visible: true },
    { id: "pomodoro", visible: true },
    { id: "heatmap", visible: true },
    { id: "alarms", visible: true },
    { id: "events", visible: true },
    { id: "analytics", visible: true },
    { id: "assistance", visible: true },
  ]);
});

test("saved visibility and order survive a JSON round trip, including an empty sidebar", () => {
  const saved = defaultSidebarLayout().reverse().map((panel) => ({ ...panel, visible: false }));
  assert.deepEqual(normalizeSidebarLayout(JSON.parse(JSON.stringify(saved))), saved);
});

test("missing or malformed layout data falls back to the complete default", () => {
  for (const value of [null, undefined, false, 1, "invalid", {}, { panels: [] }, []]) {
    assert.deepEqual(normalizeSidebarLayout(value), defaultSidebarLayout());
  }
});

test("obsolete, invalid and duplicate entries cannot replace valid preferences", () => {
  const saved = [
    null,
    "todos",
    { id: "removed-panel", visible: false },
    { id: "constructor", visible: false },
    { id: "__proto__", visible: false },
    { id: "todos", visible: false },
    { id: "todos", visible: true },
    { id: "dashboard", visible: true },
  ];
  assert.deepEqual(normalizeSidebarLayout(saved), [
    { id: "todos", visible: false },
    { id: "dashboard", visible: true },
    ...defaultSidebarLayout().slice(2),
  ]);
});

test("new panels are appended without changing existing order or visibility", () => {
  assert.deepEqual(normalizeSidebarLayout([{ id: "analytics", visible: false }]), [
    { id: "analytics", visible: false },
    ...defaultSidebarLayout().filter((panel) => panel.id !== "analytics"),
  ]);
});

test("invalid visibility values default to shown without treating strings as booleans", () => {
  const saved = defaultSidebarLayout().map((panel) => ({ ...panel, visible: "false" }));
  assert.deepEqual(normalizeSidebarLayout(saved), defaultSidebarLayout());
});

test("dragging across several positions preserves hidden panels and does not mutate the source", () => {
  const original = defaultSidebarLayout().map((panel) => ({ ...panel, visible: panel.id !== "todos" }));
  const before = structuredClone(original);
  const reordered = reorderSidebarLayout(original, "dashboard", "heatmap");
  assert.deepEqual(reordered.slice(0, 4).map((panel) => panel.id), ["todos", "pomodoro", "heatmap", "dashboard"]);
  assert.equal(reordered[0].visible, false);
  assert.deepEqual(original, before);
  assert.deepEqual(reorderSidebarLayout(reordered, "dashboard", "todos"), original);
});

test("dropping on the same row or an unavailable panel is a no-op", () => {
  const original = defaultSidebarLayout();
  assert.equal(reorderSidebarLayout(original, "todos", "todos"), original);
  assert.equal(reorderSidebarLayout(original, "removed", "todos"), original);
});
