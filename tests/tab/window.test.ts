/**
 * The lane window and threshold tests (T050; PT-151-026..; F151-FR-048;
 * contracts/tab-manifest.md §Window and §Run strip).
 *
 * The view is generated programmatically (the same shape as the
 * `corpus-42` fixture workspace: 250 approved cards across 42 features) so
 * the file is deterministic and self-contained: no fixture on disk, no
 * clock, no randomness. The tests pin:
 *
 * - the default threshold 100 windows the 250-card `approved` lane to at
 *   most 140 (threshold + 2 × 20) card nodes and drops the run strip
 *   (`data-summary`) while windowed;
 * - threshold 250 renders every card, no windowing, strip present with the
 *   run order (live first, newest ended `lastAt`, then never-run features
 *   in first-appearance order), at most 4 rows and `and 38 more features`;
 * - the window moves with the scroll position;
 * - an invalid threshold (0, NaN, 10001, `"x"`, non-integer, absent) falls
 *   back to 100 with exactly one log line through an injected sink;
 * - the model is never mutated (deep-frozen input, deep-equal after).
 *
 * REDLINE: every call throws `US4 not implemented` until T050 lands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
/** Recursively freeze a plain view object (inlined: this task touches only
 * the test file and the stub). Returns the same object, frozen. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

import {
  windowOf,
  thresholdOfMeta,
  summaryOf,
} from "../../src/tab/client/window.ts";
import {
  closedSetWindow,
  closedSetStrip,
} from "../../src/kanban/generated/closed-sets.ts";

const OVERSCAN = Number(closedSetWindow.constants.overscan);
const THRESHOLD = Number(closedSetWindow.constants.threshold);
const MAX_WINDOW = THRESHOLD + 2 * OVERSCAN; // 140
const FEATURE_ROWS = Number(closedSetStrip.constants.featureRows); // 4

/** Build a view like the corpus-42 fixture: 250 approved cards, 42 features. */
function makeView() {
  const FEATURES = 42;
  const CARDS = 250;
  const cards = Array.from({ length: CARDS }, (_, i) => ({
    id: `card-${String(i).padStart(3, "0")}`,
    feature: `f${String(i % FEATURES).padStart(2, "0")}`,
    phase: 1,
    lane: "approved",
    ruleId: "approved",
    flags: { dead: false, stale: false, yielded: false },
  }));
  const featureDetails: Record<string, unknown> = {};
  for (let f = 0; f < FEATURES; f++) featureDetails[`f${String(f).padStart(2, "0")}`] = {};
  featureDetails.f00 = { run: { runId: "run-live", state: "running", lastAt: "2030-01-01T00:00:00Z" } };
  featureDetails.f05 = { run: { runId: "run-ended", state: "done", lastAt: "2029-06-01T00:00:00Z" } };
  return {
    schema: "specstride.view/1",
    now: "2030-02-02T00:00:00Z",
    runId: "run-live",
    workspaceId: "ws-42",
    cards,
    lanes: [{ lane: "approved", cards: cards.map((c) => c.id) }],
    phases: [],
    featureDetails,
    attention: [],
    attentionOmitted: 0,
    budgets: [],
    approvals: null,
  };
}

/** The approved lane's cards, in view order. */
function approvedCards(view: ReturnType<typeof makeView>) {
  const byId = new Map(view.cards.map((c) => [c.id, c]));
  return view.lanes[0].cards.map((id) => byId.get(id));
}

test("default threshold 100 windows a 250-card lane to at most 140 card nodes", () => {
  const view = deepFreeze(makeView());
  const cards = approvedCards(view);
  assert.equal(cards.length, 250, "the generated lane holds 250 approved cards");
  const w = windowOf(cards, 0, thresholdOfMeta({}).threshold);
  assert.equal(w.windowed, true, "250 > 100: the lane is windowed");
  assert.equal(w.total, 250, "the window reports the full lane total");
  assert.ok(
    w.slice.length <= MAX_WINDOW,
    `at most ${MAX_WINDOW} card nodes in the window, got ${w.slice.length}`,
  );
  assert.equal(w.slice.length, MAX_WINDOW, "the window is filled to 140 cards");
  assert.ok(
    w.start >= 0 && w.start + w.slice.length <= w.total,
    `the slice is contiguous inside the lane (start ${w.start})`,
  );
});

test("while a lane is windowed the run strip (data-summary) is absent", () => {
  const view = deepFreeze(makeView());
  const cards = approvedCards(view);
  const w = windowOf(cards, 0, THRESHOLD);
  assert.equal(w.windowed, true, "the approved lane is windowed at threshold 100");
  const strip = summaryOf(view, new Set(["approved"]));
  assert.equal(strip.summary, null, "data-summary is omitted from the tree while a lane is windowed");
});

test("threshold 250: no windowing, every card is a node and the strip is present", () => {
  const view = deepFreeze(makeView());
  const cards = approvedCards(view);
  const w = windowOf(cards, 0, 250);
  assert.equal(w.windowed, false, "250 cards <= threshold 250: no windowing");
  assert.equal(w.start, 0, "the whole lane renders from the first card");
  assert.equal(w.slice.length, 250, "all 250 cards are nodes");
  assert.equal(
    w.slice.map((c) => (c as { id: string }).id).join(","),
    view.lanes[0].cards.map((id) => `card-${id.slice(5).padStart(3, "0")}`).join(","),
    "the slice is the lane in view order",
  );
  const strip = summaryOf(view, new Set());
  assert.notEqual(strip.summary, null, "data-summary is in the tree when no lane is windowed");
});

test("threshold 250 strip order: live first, newest lastAt, then never-run by first appearance", () => {
  const view = deepFreeze(makeView());
  const strip = summaryOf(view, new Set());
  const features = strip.rows.map((r) => (r as { feature: string }).feature);
  assert.equal(features[0], "f00", "the live (running) feature is the first row");
  assert.equal(features[1], "f05", "the only ended feature follows the running one (newest lastAt)");
  assert.deepEqual(
    features.slice(2),
    ["f01", "f02"],
    "never-run features follow in first-appearance order of view.cards",
  );
});

test("at most 4 strip rows, then 'and 38 more features'", () => {
  const view = deepFreeze(makeView());
  const strip = summaryOf(view, new Set());
  assert.ok(strip.rows.length <= FEATURE_ROWS, `at most ${FEATURE_ROWS} rows, got ${strip.rows.length}`);
  assert.equal(strip.rows.length, FEATURE_ROWS, "42 features fill the 4 rows");
  assert.equal(strip.more, 38, "42 features − 4 rows are left out");
  const last = strip.rows[strip.rows.length - 1] as { trailing?: unknown };
  assert.equal(
    last.trailing ?? strip.summaryOf?.(42 - FEATURE_ROWS),
    undefined,
    "the row shape carries the count separately (checked through `more`)",
  );
  assert.equal(
    (strip.summary as { trailingText?: string }).trailingText,
    "and 38 more features",
    "the strip ends with 'and 38 more features'",
  );
});

test("the window moves with the scroll position", () => {
  const view = deepFreeze(makeView());
  const cards = approvedCards(view);
  const atTop = windowOf(cards, 0, THRESHOLD);
  const inMiddle = windowOf(cards, 125, THRESHOLD);
  const atBottom = windowOf(cards, 249, THRESHOLD);
  assert.equal(atTop.start, 0, "scroll 0 shows the head of the lane");
  assert.ok(inMiddle.start > atTop.start, "a mid-lane scroll shifts the slice start forward");
  assert.equal(atBottom.start + atBottom.slice.length, 250, "the last scroll shows the tail of the lane");
  for (const w of [atTop, inMiddle, atBottom]) {
    assert.ok(w.slice.length <= MAX_WINDOW, `every window stays within ${MAX_WINDOW} nodes`);
  }
  assert.notEqual(inMiddle.start, atBottom.start, "two scroll positions give different slice indices");
});

test("an invalid threshold falls back to 100 with exactly one log line", () => {
  const invalids: unknown[] = [0, NaN, 10001, "x", 1.5, -5, Infinity, undefined];
  for (const value of invalids) {
    const lines: string[] = [];
    const { threshold, logged } = thresholdOfMeta({ laneThreshold: value }, (line) => lines.push(line));
    assert.equal(threshold, 100, `threshold ${String(value)} falls back to 100`);
    assert.equal(logged, true, `threshold ${String(value)} logs once`);
    assert.equal(lines.length, 1, `exactly one log line for ${String(value)}, got ${lines.length}`);
    assert.ok(lines[0].length > 0, "the log line carries a message");
  }
});

test("a valid threshold passes through without logging; an absent sink still falls back", () => {
  for (const value of [1, 100, 250, 10000]) {
    const lines: string[] = [];
    const { threshold, logged } = thresholdOfMeta({ laneThreshold: value }, (line) => lines.push(line));
    assert.equal(threshold, value, `threshold ${value} is in 1..10000 and passes through`);
    assert.equal(logged, false, `threshold ${value} logs nothing`);
    assert.equal(lines.length, 0, `no log line for threshold ${value}`);
  }
  const { threshold, logged } = thresholdOfMeta({});
  assert.equal(threshold, 100, "without a sink the invalid/absent threshold still falls back to 100");
  assert.equal(logged, true, "the fallback reports logged even without a sink");
});

test("the model is never mutated: a deep-frozen view stays deep-equal after every call", () => {
  const before = structuredClone(makeView());
  const view = deepFreeze(makeView());
  assert.ok(Object.isFrozen(view), "the view itself is frozen");
  assert.ok(Object.isFrozen(view.cards), "view.cards is frozen");
  assert.ok(Object.isFrozen(view.lanes), "view.lanes is frozen");
  assert.ok(Object.isFrozen(view.lanes[0].cards), "the lane's card id list is frozen");
  assert.ok(Object.isFrozen(view.cards[0]), "each card record is frozen");
  assert.ok(Object.isFrozen(view.cards[0].flags), "each card's flags are frozen");
  assert.ok(Object.isFrozen(view.featureDetails), "featureDetails is frozen");
  assert.ok(Object.isFrozen(view.featureDetails.f00), "each feature detail is frozen");

  windowOf(approvedCards(view), 0, THRESHOLD);
  windowOf(approvedCards(view), 125, 250);
  thresholdOfMeta({ laneThreshold: 250 });
  thresholdOfMeta({ laneThreshold: "x" }, () => {});
  summaryOf(view, new Set(["approved"]));
  summaryOf(view, new Set());

  assert.deepStrictEqual(structuredClone(view), before, "the view is deep-equal to its pre-call clone");
  assert.ok(Object.isFrozen(view), "the view is still frozen after the calls");
});
