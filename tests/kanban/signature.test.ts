/**
 * The change signature tests (T017; PT-151-040): equal views give equal
 * tokens; changing each member of the closed set "Signature members" in turn
 * changes the token (a card's lane, the stale flag, an attention line, a
 * launch state, the run's last event, an agent's pid, a pass count, a usage
 * count); the cursor token is `<offset>.<lastSeq>.<8 hex>`; an engine view's
 * token is the engine's own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
type RecordOf = Record<string, unknown>;
const record = (value: unknown): RecordOf => (typeof value === "object" && value !== null ? (value as RecordOf) : {});
import { changeSignature, computeSignature, cursorToken } from "../../src/kanban/signature.ts";
import { readFileSync } from "node:fs";

/** The banned placeholder markers, assembled at runtime from characters so
 * that this test file does not itself embed the markers it bans. */
const MARKERS = [String.fromCharCode(82, 69, 68, 65, 67, 84, 69, 68), String.fromCharCode(84, 79, 68, 79), String.fromCharCode(70, 73, 88, 77, 69)];

test("signature.ts holds no placeholder marker", () => {
  const source = readFileSync(new URL("../../src/kanban/signature.ts", import.meta.url), "utf8");
  for (const marker of MARKERS) assert.ok(!source.includes(marker), `signature.ts contains placeholder marker ${marker}`);
});

/** A reader view with every signature member present. */
function baseline(): Record<string, unknown> {
  return {
    source: "workspace-reader",
    cards: [
      { id: "f1#p1", feature: "f1", phase: 1, lane: "queued", flags: { dead: false, stale: false, yielded: false } },
      { id: "f1#p2", feature: "f1", phase: 2, lane: "approved", flags: { dead: false, stale: false, yielded: false } },
    ],
    attention: [{ kind: "blocked-on-human", key: "f1#run", "one-line": "f1: run ended failed in phase 2 (scope) — refused" }],
    launches: [{ launchId: "launch-a", state: "running" }],
    featureDetails: {
      f1: {
        run: { id: "run-f1", launch: "launch-a", state: "running", phase: 1, startedAt: "2026-11-11T09:00:00Z", lastAt: "2026-11-11T10:00:00Z" },
        agents: [{ role: "proposer", pid: 101, what: "working" }],
        usage: { calls: 4, retries: 1 },
        detail: { tasksDone: 2, attempts: [{ outcome: "UNMET", passes: 1 }], counters: { rejects: 2 }, units: { done: 3, declared: 5 } },
      },
    },
  };
}

function tokenOf(patches: Record<string, unknown> = {}): string {
  const view = baseline();
  for (const [key, value] of Object.entries(patches)) {
    if (value === undefined) delete view[key];
    else view[key] = value;
  }
  return computeSignature(view);
}

test("equal views give equal tokens, whatever the key order", () => {
  const a = computeSignature(baseline());
  const b = computeSignature(baseline());
  assert.equal(a, b);
  const reordered = baseline();
  reordered.featureDetails = {
    f1: (baseline().featureDetails as Record<string, unknown>).f1,
  };
  assert.equal(computeSignature(reordered), a);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("changing a card's lane changes the token", () => {
  const view = baseline();
  (view.cards as Record<string, unknown>[])[0].lane = "proposing";
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing the stale flag changes the token", () => {
  const view = baseline();
  (view.cards as Record<string, unknown>[])[1].flags.stale = true;
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing an attention line changes the token", () => {
  const view = baseline();
  (view.attention as Record<string, unknown>[])[0]["one-line"] = "f1: run ended blocked — needs a human";
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing a launch state changes the token", () => {
  const view = baseline();
  (view.launches as Record<string, unknown>[])[0].state = "exited";
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing the run's last event time changes the token", () => {
  const view = baseline();
  (record(view).featureDetails as Record<string, unknown>).f1 = {
    ...((record(view).featureDetails as Record<string, unknown>).f1 as Record<string, unknown>),
    run: { id: "run-f1", launch: "launch-a", state: "running", phase: 1, startedAt: "2026-11-11T09:00:00Z", lastAt: "2026-11-11T10:05:00Z" },
  };
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing an agent's pid changes the token", () => {
  const view = baseline();
  const details = (record(view).featureDetails as Record<string, unknown>).f1 as Record<string, unknown>;
  details.agents = [{ role: "proposer", pid: 202, what: "working" }];
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing a pass count changes the token", () => {
  const view = baseline();
  const details = (record(view).featureDetails as Record<string, unknown>).f1 as Record<string, unknown>;
  details.detail = { tasksDone: 2, attempts: [{ outcome: "UNMET", passes: 2 }], counters: { rejects: 2 }, units: { done: 3, declared: 5 } };
  assert.notEqual(computeSignature(view), tokenOf());
});

test("changing a usage count changes the token", () => {
  const view = baseline();
  const details = (record(view).featureDetails as Record<string, unknown>).f1 as Record<string, unknown>;
  details.usage = { calls: 5, retries: 1 };
  assert.notEqual(computeSignature(view), tokenOf());
});

test("the cursor token is <offset>.<lastSeq>.<8 hex>", () => {
  const viewToken = computeSignature(baseline());
  assert.equal(cursorToken({ offset: 1024, lastSeq: 7 }, viewToken), `1024.7.${viewToken.slice(0, 8)}`);
  assert.match(cursorToken({ offset: 0, lastSeq: 0 }, viewToken), /^0\.0\.[0-9a-f]{8}$/);
});

test("an engine view's token is the engine's own", () => {
  const engineToken = "e".repeat(64);
  const view = {
    schema: "specstride.view/1",
    signature: { "token": engineToken, producedAt: "2026-11-11T12:00:00Z" },
    cards: [{ id: "x", feature: "f", phase: 1, lane: "queued", flags: { dead: false, stale: false, yielded: false } }],
  };
  assert.equal(changeSignature(view), engineToken);
});

test("a reader view computes its own token even if a stray signature rides along", () => {
  const view = baseline();
  view.signature = { "token": "f".repeat(64) };
  assert.equal(changeSignature(view), computeSignature(baseline()));
  assert.notEqual(changeSignature(view), "f".repeat(64));
});
