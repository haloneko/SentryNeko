import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesQuery,
  parseQuery,
  searchTodos,
  tagLookup,
} from "../.cache/sidebar-test/pages/Todos/todos.js";

const NOW = 1_790_000_000;

const tags = [
  { createdAt: NOW, id: 1, name: "Work" },
  { createdAt: NOW, id: 2, name: "long-name-tag" },
  { createdAt: NOW, id: 3, name: "工作" },
];

/** A task as the list hands it over, with only the fields a search reads filled in. */
const todo = (overrides) => ({
  completed: false,
  createdAt: NOW,
  endAt: null,
  extra: {},
  id: 1,
  notes: null,
  starredAt: null,
  startAt: null,
  tagIds: [],
  title: "",
  updatedAt: NOW,
  ...overrides,
});

const lookup = tagLookup(tags);

test("spaces separate conditions and a leading # asks for a tag", () => {
  assert.deepEqual(parseQuery("#work  report"), [
    { tag: true, text: "work" },
    { tag: false, text: "report" },
  ]);
  assert.deepEqual(parseQuery("   "), []);
  assert.deepEqual(parseQuery("#"), [], "a lone # asks for nothing rather than everything");
});

test("#word is answered by tag names only", () => {
  const tagged = todo({ tagIds: [1] });
  const titled = todo({ title: "work log" });

  assert.equal(matchesQuery(tagged, lookup, "#work"), true);
  assert.equal(matchesQuery(titled, lookup, "#work"), false);
  assert.equal(matchesQuery(titled, lookup, "work"), true);
});

test("a word without # reaches the title, the note and the tags", () => {
  assert.equal(matchesQuery(todo({ notes: "Send the invoice" }), lookup, "invoice"), true);
  assert.equal(matchesQuery(todo({ tagIds: [2] }), lookup, "LONG-NAME"), true, "case is ignored");
  assert.equal(matchesQuery(todo({ title: "Beta write-up" }), lookup, "report"), false);
});

test("every condition has to hold, so a second word narrows rather than widens", () => {
  const tasks = [
    todo({ id: 1, tagIds: [1], title: "Zebra review" }),
    todo({ id: 2, tagIds: [1], title: "Beta write-up" }),
    todo({ id: 3, tagIds: [2], title: "Zebra plan" }),
  ];
  const ids = (query) => searchTodos(tasks, tags, query).map((item) => item.id);

  assert.deepEqual(ids("#work"), [1, 2]);
  assert.deepEqual(ids("#work zebra"), [1]);
  assert.deepEqual(ids("zebra"), [1, 3]);
  assert.deepEqual(ids("#work #long"), [], "two tags must both be carried");
});
