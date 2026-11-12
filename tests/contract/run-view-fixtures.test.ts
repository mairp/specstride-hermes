/**
 * The run-view fixture contract test (T005): every JSON under
 * `tests/fixtures/run-views/` validates against `specstride.view/1` with
 * `isRunView` of the pinned `@specstride/contracts`, except the two that
 * must not:
 * - `unknown-lane.json` and `unknown-kind.json` carry an intentionally
 *   unknown member (a lane outside `LANES`, an attention kind outside
 *   `ATTENTION_KINDS`); the schema's enums reject both, and the test
 *   asserts that rejection.
 * `empty.json` is a schema-complete view that states the answer engine
 * `27e7d71b` gave on 2026-11-11 — `state: "none"`, `runId: null`, no card
 * and no attention item — and it validates like every other fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { isRunView, tryReadRunView, LANES, ATTENTION_KINDS } from "@specstride/contracts/records/run-view";
import { RUN_STATES } from "@specstride/contracts/state/run-state";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures", "run-views");

function listViews(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => join((d.parentPath ?? d.path) as string, d.name))
    .sort();
}

const EXEMPT = new Set(["unknown-lane.json", "unknown-kind.json"]);

test("every run-view fixture except the exempt ones validates against specstride.view/1", () => {
  const files = listViews(FIXTURES).map((f) => f.slice(FIXTURES.length + 1));
  assert.ok(files.length >= 17, `expected the full fixture set, found ${files.length}`);
  for (const relative of files) {
    if (EXEMPT.has(relative)) continue;
    const value = JSON.parse(readFileSync(join(FIXTURES, relative), "utf8"));
    const verdict = tryReadRunView(value);
    assert.ok(
      isRunView(value),
      `${relative} must validate: ${JSON.stringify(verdict.error?.errors?.slice(0, 4))}`,
    );
  }
});

test("empty.json validates and states the recorded answer of engine 27e7d71b", () => {
  const value = JSON.parse(readFileSync(join(FIXTURES, "empty.json"), "utf8"));
  // It validates like every other fixture (it left the exempt set).
  const verdict = tryReadRunView(value);
  assert.ok(isRunView(value), `${JSON.stringify(verdict.error?.errors?.slice(0, 4))}`);
  // And its shape says "none": no cards, no run, nothing to attend to —
  // the standing answer of engine 27e7d71b recorded 2026-11-11.
  const view = value as { state: string; runId: string | null; cards: unknown[]; attention: unknown[] };
  assert.equal(view.state, "none");
  assert.equal(view.runId, null);
  assert.deepEqual(view.cards, []);
  assert.deepEqual(view.attention, []);
});

test("the unknown-member fixtures do not validate (the enums are closed)", () => {
  const unknownLane = JSON.parse(readFileSync(join(FIXTURES, "unknown-lane.json"), "utf8")) as {
    cards: { lane: string }[];
  };
  assert.ok(!LANES.includes(unknownLane.cards[0].lane));
  assert.equal(isRunView(unknownLane), false);

  const unknownKind = JSON.parse(readFileSync(join(FIXTURES, "unknown-kind.json"), "utf8")) as {
    attention: { kind: string }[];
  };
  assert.ok(!ATTENTION_KINDS.includes(unknownKind.attention[0].kind));
  assert.equal(isRunView(unknownKind), false);
});

test("the fixture set covers every lane and every run state of the pinned contracts", () => {
  const seenLanes = new Set<string>();
  const seenStates = new Set<string>();
  for (const file of listViews(FIXTURES)) {
    const value = JSON.parse(readFileSync(file, "utf8")) as {
      state?: string;
      cards?: { lane: string }[];
    };
    if (EXEMPT.has(file.slice(FIXTURES.length + 1))) continue;
    if (value.state) seenStates.add(value.state);
    for (const card of value.cards ?? []) seenLanes.add(card.lane);
  }
  for (const lane of LANES) assert.ok(seenLanes.has(lane), `no fixture carries a card in lane ${lane}`);
  for (const state of RUN_STATES) {
    assert.ok(seenStates.has(state), `every-run-state/${state}.json is missing`);
  }
});

test("every-lane.json holds at least one card in each of the eight lanes", () => {
  const value = JSON.parse(readFileSync(join(FIXTURES, "every-lane.json"), "utf8")) as {
    cards: { lane: string }[];
  };
  for (const lane of LANES) {
    assert.ok(value.cards.some((c) => c.lane === lane), `every-lane.json misses lane ${lane}`);
  }
});

test("budget.json carries a budget-alert attention item and a budget row", () => {
  const value = JSON.parse(readFileSync(join(FIXTURES, "budget.json"), "utf8")) as {
    budget: unknown[];
    attention: { kind: string }[];
  };
  assert.ok(value.budget.length >= 1);
  assert.ok(value.attention.some((a) => a.kind === "budget-alert"));
});
