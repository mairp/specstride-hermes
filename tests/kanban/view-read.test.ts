/**
 * The view acceptance tests (T013; PT-151-035): validation before the
 * additive reads, the absent source reading as `engine`, a source outside
 * the closed set refusing the view, additive members read leniently (absent
 * fields, no throw), and unknown members of the engine's closed sets
 * accepted and preserved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptView } from "../../src/kanban/view-read.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const EMPTY_VIEW = JSON.parse(
  readFileSync(join(ROOT, "tests", "fixtures", "run-views", "empty.json"), "utf8"),
) as Record<string, unknown>;

function viewWith(patches: Record<string, unknown>): Record<string, unknown> {
  return { ...EMPTY_VIEW, ...patches };
}

test("a valid engine view passes, with source `engine`", () => {
  const accepted = acceptView(EMPTY_VIEW);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.source, "engine");
    assert.equal(accepted.cards.length, 0);
    assert.equal(accepted.featureDetails, null);
  }
});

test("an absent source reads as engine; an explicit `workspace-reader` passes", () => {
  const absent = acceptView(viewWith({}));
  assert.ok(absent.ok && absent.source === "engine");

  const reader = acceptView(viewWith({ source: "workspace-reader" }));
  assert.ok(reader.ok && reader.source === "workspace-reader");
});

test("a source outside the closed set refuses the view", () => {
  for (const bad of ["dsh", "ENGINE", "", 42, null]) {
    const refused = acceptView(viewWith({ source: bad }));
    assert.equal(refused.ok, false, `source ${JSON.stringify(bad)} must refuse`);
    if (!refused.ok) assert.match(refused.reason, /View sources/);
  }
});

test("additive card members are read leniently: rule, ruleId, title, detail", () => {
  const card = {
    id: "f-p1",
    feature: "f",
    phase: 1,
    lane: "queued",
    ruleId: "L-01",
    rule: "W0",
    title: "not started (2 phases)",
    detail: { goal: "g", tasksDone: 1 },
    flags: { dead: false, stale: false, yielded: false },
  };
  const accepted = acceptView(viewWith({ source: "workspace-reader", cards: [card] }));
  assert.ok(accepted.ok);
  if (accepted.ok) {
    assert.equal(accepted.cards.length, 1);
    assert.deepEqual(accepted.cards[0], {
      rule: "W0",
      ruleId: "L-01",
      title: "not started (2 phases)",
      detail: { goal: "g", tasksDone: 1 },
    });
  }
});

test("missing additive members read as null and never throw", () => {
  const card = {
    id: "f-p1",
    feature: "f",
    phase: 1,
    lane: "queued",
    ruleId: "L-01",
    flags: { dead: false, stale: false, yielded: false },
  };
  const accepted = acceptView(viewWith({ source: "workspace-reader", cards: [card] }));
  assert.ok(accepted.ok);
  if (accepted.ok) {
    assert.deepEqual(accepted.cards[0], { rule: null, ruleId: "L-01", title: null, detail: null });
  }
  // No cards at all, no featureDetails: still fine.
  const bare = acceptView(viewWith({ source: "workspace-reader" }));
  assert.ok(bare.ok);
  if (bare.ok) assert.deepEqual(bare.cards, []);
});

test("featureDetails is read as a record when present", () => {
  const details = { f: { run: { id: "r-1", state: "running" } } };
  const accepted = acceptView(viewWith({ source: "workspace-reader", featureDetails: details }));
  assert.ok(accepted.ok);
  if (accepted.ok) assert.deepEqual(accepted.featureDetails, details);
});

test("unknown closed-set values in the additive members are accepted and preserved", () => {
  // A newer engine may add a member to a closed set the pinned contracts
  // still enumerate: inside the additive records (`featureDetails`,
  // `cards[].detail`) nothing is re-validated, so a value outside the pinned
  // enumeration passes through verbatim as the string it is.
  const details = {
    f: {
      run: { id: "r-1", state: "held" }, // not one of the ten run states
      agents: [{ role: "proposer", what: "working", alive: "quantum" }],
    },
  };
  const accepted = acceptView(viewWith({ source: "workspace-reader", featureDetails: details }));
  assert.ok(accepted.ok, "an unknown run state in an additive record does not refuse the view");
  if (accepted.ok) {
    const feature = accepted.featureDetails?.f as Record<string, unknown>;
    assert.equal((feature.run as Record<string, unknown>).state, "held");
  }
});

test("an unknown lane on a card is refused by isRunView and so by acceptance", () => {
  const card = {
    id: "f-p1",
    feature: "f",
    phase: 1,
    lane: "between-passes", // not one of the eight lanes of the pinned enum
    ruleId: "L-01",
    flags: { dead: false, stale: false, yielded: false },
  };
  const refused = acceptView(viewWith({ cards: [card] }));
  assert.equal(refused.ok, false, "the pinned validator refuses it; acceptance refuses it");
});

test("a view that fails isRunView is refused before any additive read", () => {
  const broken = { ...EMPTY_VIEW } as Record<string, unknown>;
  delete broken.cards;
  const refused = acceptView(broken);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /isRunView/);
});
