/** Todo page helpers: what the search matches, how the list is ordered and grouped. */

import type { TFunction } from "i18next";

import type { LanguageCode } from "../../types/i18n";
import type { Tag } from "../../types/tag";
import type { Todo, TodoFilter } from "../../types/todo";

/** How long ago something happened, in the largest unit that still reads as "ago". */
export type Age =
  | { unit: "now" }
  | { count: number; unit: "minutes" | "hours" | "days" };

/** Tag names lowercased and keyed by id, so a search reads them without a pass per task. */
export type TagLookup = ReadonlyMap<number, string>;

/** The lookup a search matches tag names against. */
export function tagLookup(tags: readonly Tag[]): TagLookup {
  return new Map(tags.map((tag) => [tag.id, tag.name.toLowerCase()]));
}

/** One condition of a search: a word, and whether only a tag may answer it. */
export interface QueryTerm {
  /** What is looked for, lowercased. */
  text: string;
  /** True for a `#word`, which no title or note can satisfy. */
  tag: boolean;
}

/**
 * Splits what was typed into the conditions every match has to satisfy.
 *
 * Spaces separate conditions, so `#work report` asks for a task carrying a tag named like "work"
 * whose title, note or tags also mention "report". A word with `#` in front is answered by tag names
 * only; every other word is answered by the title, the note or a tag name. A lone `#` is dropped
 * rather than treated as an empty tag, which would match everything.
 */
export function parseQuery(query: string): readonly QueryTerm[] {
  return query
    .split(/\s+/)
    .filter((word) => word !== "" && word !== "#")
    .map((word) => ({
      tag: word.startsWith("#"),
      text: (word.startsWith("#") ? word.slice(1) : word).toLowerCase(),
    }));
}

/**
 * Adds `#name` to `query` as one more condition.
 *
 * The tag goes in once: asking for the same tag twice would narrow nothing further, and a second
 * click on the same row should not spell the condition out again. A tag name with a space in it is
 * not supported — the words are split apart, exactly as they would be if typed by hand.
 */
export function withTagCondition(query: string, name: string): string {
  const condition = `#${name}`;
  const words = query.split(/\s+/).filter((word) => word !== "");

  if (words.some((word) => word.toLowerCase() === condition.toLowerCase())) {
    return query;
  }

  return [...words, condition].join(" ");
}

/** Whether `todo` answers every condition in `terms`; an empty list asks for nothing. */
function matchesTerms(todo: Todo, lookup: TagLookup, terms: readonly QueryTerm[]): boolean {
  if (terms.length === 0) {
    return true;
  }

  const tagNames = todo.tagIds
    .map((id) => lookup.get(id))
    .filter((name): name is string => name !== undefined);
  const title = todo.title.toLowerCase();
  const notes = todo.notes?.toLowerCase() ?? "";

  return terms.every((term) =>
    term.tag
      ? tagNames.some((name) => name.includes(term.text))
      : title.includes(term.text) ||
        notes.includes(term.text) ||
        tagNames.some((name) => name.includes(term.text)),
  );
}

/** Whether `todo` matches `query`, by title, note or the name of any tag it carries. */
export function matchesQuery(todo: Todo, lookup: TagLookup, query: string): boolean {
  return matchesTerms(todo, lookup, parseQuery(query));
}

/** How the page orders the tasks inside a group. */
export type TodoSort = "default" | "due" | "oldest" | "title";

/** Newest first, which is how a task that was just added arrives at the top of its group. */
function newestFirst(a: Todo, b: Todo): number {
  return b.createdAt - a.createdAt || b.id - a.id;
}

/** The tasks planned to end soonest first; a task with no end waits behind the ones that have one. */
function byDeadline(a: Todo, b: Todo): number {
  if (a.endAt === null || b.endAt === null) {
    if (a.endAt === b.endAt) {
      return 0;
    }

    return a.endAt === null ? 1 : -1;
  }

  return a.endAt - b.endAt;
}


function pinnedFirst(a: Todo, b: Todo): number | null {
  if (a.starredAt === null && b.starredAt === null) {
    return null;
  }

  if (a.starredAt === null) {
    return 1;
  }

  if (b.starredAt === null) {
    return -1;
  }

  return null;
}

/** How a task list is ordered; every field is defaulted. */
export interface ListOrder {
  /** Which key orders the tasks. */
  sort?: TodoSort;
  /** The language titles are compared in. */
  language?: LanguageCode;
}

export function sortTodos(todos: readonly Todo[], order: ListOrder = {}): readonly Todo[] {
  const { language = "zh-CN", sort = "default" } = order;
  const byKey = (a: Todo, b: Todo): number => {
    if (sort === "due") {
      return byDeadline(a, b);
    }

    if (sort === "oldest") {
      return a.createdAt - b.createdAt || a.id - b.id;
    }

    if (sort === "title") {
      return a.title.localeCompare(b.title, language) || a.id - b.id;
    }

    return a.starredAt === null || b.starredAt === null ? 0 : b.starredAt - a.starredAt;
  };

  return [...todos].sort((a, b) => pinnedFirst(a, b) ?? (byKey(a, b) || newestFirst(a, b)));
}

/** The tasks the search leaves; the order they are drawn in is decided when they are grouped. */
export function searchTodos(
  todos: readonly Todo[],
  tags: readonly Tag[],
  query: string,
): readonly Todo[] {
  const lookup = tagLookup(tags);
  // Parsed once: a list of a few hundred tasks would otherwise re-split the same words per row.
  const terms = parseQuery(query);

  return todos.filter((todo) => matchesTerms(todo, lookup, terms));
}

/** The two groups the list is drawn in; the backend filter decides whether both can be non-empty. */
export function groupTodos(
  todos: readonly Todo[],
  order: ListOrder = {},
): {
  active: readonly Todo[];
  completed: readonly Todo[];
} {
  return {
    active: sortTodos(
      todos.filter((todo) => !todo.completed),
      order,
    ),
    completed: sortTodos(
      todos.filter((todo) => todo.completed),
      order,
    ),
  };
}

/** The names of the tags a task carries, in the order the task holds them. */
export function tagNamesOf(todo: Todo, tags: readonly Tag[]): readonly string[] {
  const names = new Map(tags.map((tag) => [tag.id, tag.name]));

  return todo.tagIds.map((id) => names.get(id)).filter((name): name is string => name !== undefined);
}

/** A task's planned window, as its row shows it. */
export interface PlanSummary {
  /** True once the planned end has passed and the task is still open. */
  late: boolean;
  /** The window in the reader's own words: arranged as one span, or one end on its own. */
  text: string;
}

/** `09:00` in the reader's locale. */
function clockText(date: Date, language: LanguageCode): string {
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

/** `19 Oct`, with the year once it is not the current one, which the row has no reason to repeat. */
function dayText(date: Date, language: LanguageCode): string {
  return date.toLocaleDateString(language, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/** `19 Oct 09:00` in the reader's locale. */
function momentText(epoch: number, language: LanguageCode): string {
  const date = new Date(epoch * 1000);

  return `${dayText(date, language)} ${clockText(date, language)}`;
}

/**
 * Whether an open task's planned end has been reached, which is what the row calls overdue.
 *
 * The clock is read once a minute, so `<=` is what makes the flag turn over on the due minute
 * itself: with `<`, a task due at 09:00 would only be flagged at 09:01, and a deadline would be
 * reported as missed a whole minute after the list had already stopped saying it was ahead.
 */
export function isLate(todo: Todo, now: number): boolean {
  return todo.endAt !== null && todo.endAt <= now && !todo.completed;
}

/** How many of `todos` are overdue at `now`; the badge over the list and the row flags share this. */
export function overdueCount(todos: readonly Todo[], now: number): number {
  return todos.filter((todo) => isLate(todo, now)).length;
}

/** The state a task is in at `now`; the two planned states sit inside "open". */
export type TodoStatus = "open" | "ongoing" | "late" | "completed";

/**
 * Which of the four a task is at this minute.
 *
 * A task is ongoing while the clock is inside the window it was given: it has started, and its
 * moment has not passed. A window with only a start counts — the task is under way with no end set
 * — while one with only an end is still a plan for later, so it stays open until it is late.
 */
export function statusOf(todo: Todo, now: number): TodoStatus {
  if (todo.completed) {
    return "completed";
  }

  if (isLate(todo, now)) {
    return "late";
  }

  if (todo.startAt !== null && todo.startAt <= now) {
    return "ongoing";
  }

  return "open";
}

/**
 * Whether a task belongs in the list a filter asks for.
 *
 * `open` is everything unfinished, so it holds the ongoing and the late tasks too; the planned
 * states are the narrow answer, and the clock decides them.
 */
export function matchesFilter(todo: Todo, filter: TodoFilter, now: number): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "open") {
    return !todo.completed;
  }

  return statusOf(todo, now) === filter;
}

/** What a plan is worded with: the language its dates are drawn in, and the translator around them. */
export interface PlanWording {
  language: LanguageCode;
  t: TFunction;
}

/**
 * The planned window of a task, or `null` when it has none.
 *
 * A window on one day is spelled once, because a second date beside the first only repeats what
 * the eye already has; a window that spans days names both, because the second clock time alone
 * would look like it belonged to the same day. A lone end is the deadline most tasks carry, so it
 * is worded as one rather than drawn as a range with an empty side.
 */
export function planSummary(todo: Todo, now: number, wording: PlanWording): PlanSummary | null {
  const { language, t } = wording;
  const { endAt, startAt } = todo;

  if (startAt === null && endAt === null) {
    return null;
  }

  const late = isLate(todo, now);

  if (startAt !== null && endAt !== null) {
    const sameDay =
      new Date(startAt * 1000).toDateString() === new Date(endAt * 1000).toDateString();

    return {
      late,
      text: sameDay
        ? `${momentText(startAt, language)} – ${clockText(new Date(endAt * 1000), language)}`
        : `${momentText(startAt, language)} – ${momentText(endAt, language)}`,
    };
  }

  if (startAt !== null) {
    return { late, text: t("todo.plan.from", { time: momentText(startAt, language) }) };
  }

  if (endAt !== null) {
    return { late, text: t("todo.plan.until", { time: momentText(endAt, language) }) };
  }

  return null;
}

/** How long ago `timestamp` was, measured against `now`; both are UTC epoch seconds. */
export function ageOf(timestamp: number, now: number): Age {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60);

  if (minutes < 1) {
    return { unit: "now" };
  }

  if (minutes < 60) {
    return { count: minutes, unit: "minutes" };
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return { count: hours, unit: "hours" };
  }

  return { count: Math.floor(hours / 24), unit: "days" };
}
