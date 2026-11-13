/**
 * The view-source tests (T030, T034; PT-151-033, PT-151-039, PT-151-006,
 * PT-151-042; contracts/workspace-reader.md §1, §8, §9). The four steps of
 * §1 over injected engine/reader seams; the memo with an injected clock;
 * the reader switch-off.
 *
 * No spawn, no file: both the engine probe and the reader are stubs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewOf, MEMO_MAX, MEMO_MS, type EngineMemo, type ViewSourceDeps } from "../../src/kanban/view-source.ts";
import type { ShimAnswer } from "../../src/kanban/shim-call.ts";

/** A minimal valid engine view with the given card count. */
function engineView(state: string, cards: unknown[] = [], runId: string | null = "run-e1"): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    now: "2026-11-11T12:00:00.000Z",
    runId,
    workspaceId: "w",
    feature: "151-hermes-kanban",
    cursor: { file: "x", offset: 0, lastSeq: 0 },
    state,
    stateSince: null,
    transition: null,
    display: state,
    liveness: "unknown",
    conditions: { dead: false, stale: null, launchAbandoned: false },
    launch: { launchId: null, reason: null, outcome: null, engineStartId: null },
    progress: { phase: null, phases: null, phaseAttempt: null, pass: null, rejects: null, malformed: null, units: { done: 0, declared: 0 }, elapsedSeconds: 0 },
    strategy: { strategy: null, microLevel: 0, layerOffReason: null },
    phases: [],
    cards,
    lanes: [],
    laneTable: { id: "kanban", version: "v1" },
    attention: [],
    attentionOmitted: 0,
    budget: [],
    budgetOmitted: 0,
    processes: { holders: [], omitted: 0, cut: 0 },
    supervision: null,
    activity: { latestTool: null, observabilityMode: "off", observabilityReason: null },
    telemetry: [],
    timeline: { rows: [], omitted: 0 },
    parallel: null,
    diagnostics: { skippedLines: 0, gaps: [], majorsSeen: [], majorsAccepted: { from: 1, to: 1 }, majorsOutOfRange: 0, tornLastLine: false, fieldsCut: [], fieldsDropped: [], redactorFailed: false },
    signature: { record: {}, token: "00000000" },
    stream: { first: null, last: null, runStartedAt: null, runEndedAt: null },
    settled: { heartbeatLate: false, staleEventSec: 0 },
  };
}

function cardWith(id: string, lane: string): unknown {
  return { id, feature: "151-hermes-kanban", phase: 1, lane, ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
}

/** A reader view with the given card count. */
function readerView(n: number): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: "workspace:w",
    state: n > 0 ? "idle" : "none",
    cards: Array.from({ length: n }, (_, i) => ({ id: `f#p${i + 1}`, lane: "approved", title: `p${i}`, ruleId: `W-approved`, rule: "W2", flags: { dead: false, stale: false, yielded: false } })),
    attention: [],
    budget: [],
    phases: [],
    featureDetails: n > 0 ? { f: { run: { id: "run-r1", launch: null, state: "ended", phase: 1, startedAt: null, lastAt: null } } } : {},
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: "reader-token" },
  };
}

/** Harness: counting engine probe + reader stub + injected clock and memo. */
function harness(opts: {
  engine?: (calls: string[]) => ShimAnswer | Promise<ShimAnswer>;
  reader?: (calls: string[]) => Record<string, unknown> | null;
  readerOn?: boolean;
}): { deps: ViewSourceDeps; engineCalls: string[]; readerCalls: string[]; memo: EngineMemo; setNow: (ms: number) => void } {
  const engineCalls: string[] = [];
  const readerCalls: string[] = [];
  let nowMs = 1_000_000;
  const memo: EngineMemo = new Map();
  const deps: ViewSourceDeps = {
    now: () => nowMs,
    memo,
    engine: async (ws) => {
      engineCalls.push(ws);
      return opts.engine ? await opts.engine(engineCalls) : { kind: "unavailable", reason: "no stub" };
    },
    reader: (ws) => {
      readerCalls.push(ws);
      return opts.reader ? opts.reader(readerCalls) : null;
    },
    readerOn: opts.readerOn,
  };
  return { deps, engineCalls, readerCalls, memo, setNow: (ms) => (nowMs = ms) };
}

test("step 2: an engine view with a card wins and the reader is not called (T030)", async () => {
  const h = harness({ engine: () => ({ kind: "view", view: engineView("running", [cardWith("c1", "queued")]) }), reader: () => readerView(3) });
  const answer = await viewOf("/ws", h.deps);
  assert.equal(answer.kind, "view");
  if (answer.kind === "view") {
    assert.equal(answer.source, "engine");
    assert.equal(answer.view.cards.length, 1);
  }
  assert.deepEqual(h.readerCalls, []);
  assert.equal(h.memo.size, 0); // a card-carrying engine view deletes its entry
});

test("step 3: exit 70, exit 1, a non-JSON body and an empty view each fall to the reader (T030)", async () => {
  const unavailable: ShimAnswer[] = [
    { kind: "unavailable", reason: "engine exit 70" },
    { kind: "unavailable", reason: "engine envelope: no-feature (exit 1)" },
    { kind: "unavailable", reason: "the body is not JSON" },
  ];
  for (const engineAnswer of unavailable) {
    const h = harness({ engine: () => engineAnswer, reader: () => readerView(2) });
    const answer = await viewOf("/ws", h.deps);
    assert.equal(answer.kind, "view");
    if (answer.kind === "view") assert.equal(answer.source, "workspace-reader");
    assert.deepEqual(h.engineCalls, ["/ws"]);
    assert.deepEqual(h.readerCalls, ["/ws"]);
    assert.ok(h.memo.get("/ws") !== undefined, "an unavailable answer sets the memo");
  }
  // An empty engine view (0 cards) also falls to the reader.
  const h = harness({ engine: () => ({ kind: "empty", view: engineView("running", []) }), reader: () => readerView(2) });
  const answer = await viewOf("/ws", h.deps);
  assert.equal(answer.kind, "view");
  if (answer.kind === "view") assert.equal(answer.source, "workspace-reader");
});

test("a reader view never replaces an engine view with cards (T030)", async () => {
  const h = harness({ engine: () => ({ kind: "view", view: engineView("running", [cardWith("c1", "queued")]) }), reader: () => readerView(9) });
  const answer = await viewOf("/ws", h.deps);
  assert.equal(answer.kind, "view");
  if (answer.kind === "view") assert.equal(answer.source, "engine");
});

test("step 4: no card from either gives no-run, refused-schema, or absent (T030)", async () => {
  // A valid engine view with state none and no reader card → no-run.
  const h1 = harness({ engine: () => ({ kind: "none", view: engineView("none", [], null) }), reader: () => readerView(0) });
  assert.equal((await viewOf("/ws", h1.deps)).kind, "no-run");

  // An unsupported schema major, after the reader was tried → refused-schema.
  const h2 = harness({ engine: () => ({ kind: "refused-schema", major: 2 }), reader: () => readerView(0) });
  assert.equal((await viewOf("/ws2", h2.deps)).kind, "refused-schema");
  assert.deepEqual(h2.readerCalls, ["/ws2"], "the reader is tried before refused-schema is answered");

  // Every other unavailable answer (the exit-1 no-feature envelope) → absent, never no-run.
  const h3 = harness({ engine: () => ({ kind: "unavailable", reason: "engine envelope: no-feature (exit 1)" }), reader: () => readerView(0) });
  assert.equal((await viewOf("/ws3", h3.deps)).kind, "absent");
});

test("a valid engine view that names a run but has no card is used as it is (T030)", async () => {
  const h = harness({ engine: () => ({ kind: "empty", view: engineView("running", [], "run-live") }), reader: () => readerView(0) });
  const answer = await viewOf("/ws", h.deps);
  assert.equal(answer.kind, "view");
  if (answer.kind === "view") {
    assert.equal(answer.source, "engine");
    assert.equal(answer.view.raw.runId, "run-live");
  }
  assert.equal(h.memo.size, 0, "an empty answer with no reader card is not memoized");
});

test("the memo: no engine call for 60 s, one attempt after, injected clock (T030)", async () => {
  const h = harness({ engine: () => ({ kind: "unavailable", reason: "engine exit 70" }), reader: () => readerView(2) });
  await viewOf("/ws", h.deps);
  assert.equal(h.engineCalls.length, 1);
  h.setNow(1_000_000 + MEMO_MS - 1);
  await viewOf("/ws", h.deps);
  assert.equal(h.engineCalls.length, 1, "the memo holds inside the 60 s");
  h.setNow(1_000_000 + MEMO_MS);
  await viewOf("/ws", h.deps);
  assert.equal(h.engineCalls.length, 2, "exactly one more attempt after 60 s");
});

test("a 65th workspace evicts the oldest memo entry; an engine view with a card clears it (T030)", async () => {
  const h = harness({ engine: () => ({ kind: "unavailable", reason: "engine exit 70" }), reader: () => readerView(0) });
  for (let i = 0; i < MEMO_MAX; i += 1) await viewOf(`/ws-${i}`, h.deps);
  assert.equal(h.memo.size, MEMO_MAX);
  h.setNow(1_000_000 + 1); // ws-0 is now the oldest
  await viewOf("/extra", h.deps);
  assert.equal(h.memo.size, MEMO_MAX, "the map never grows past 64");
  assert.equal(h.memo.has("/ws-0"), false, "the oldest entry was evicted");
  assert.equal(h.memo.has("/ws-1"), true);

  // An engine view with a card deletes the entry.
  const h2 = harness({ engine: () => ({ kind: "unavailable", reason: "engine exit 70" }), reader: () => readerView(1) });
  await viewOf("/ws", h2.deps);
  assert.ok(h2.memo.has("/ws"));
  const deps2: ViewSourceDeps = { ...h2.deps, engine: async () => ({ kind: "view", view: engineView("running", [cardWith("c1", "queued")]) }) };
  h2.setNow(1_000_000 + MEMO_MS + 1); // past the memo window, so the engine is asked again
  const answer = await viewOf("/ws", deps2);
  assert.equal(answer.kind, "view");
  assert.equal(h2.memo.has("/ws"), false, "an engine view with a card deletes the memo entry");
});

/* ---- T034: the reader switch-off ---- */

test("with specstride.kanban.reader: off, step 3 is skipped and the answer is absent (T034)", async () => {
  const h = harness({ engine: () => ({ kind: "unavailable", reason: "engine exit 70" }), reader: () => readerView(4), readerOn: false });
  const answer = await viewOf("/ws", h.deps);
  assert.equal(answer.kind, "absent");
  assert.deepEqual(h.readerCalls, [], "the reader is never called when it is switched off");
});

test("switch-off: when the engine view starts to carry a card, the first cycle after the memo uses it (T034)", async () => {
  let engine: ShimAnswer = { kind: "unavailable", reason: "engine exit 70" };
  let nowMs = 0;
  const memo: EngineMemo = new Map();
  const readerCalls: string[] = [];
  const deps: ViewSourceDeps = {
    now: () => nowMs,
    memo,
    engine: async () => engine,
    reader: (ws) => {
      readerCalls.push(ws);
      return readerView(3);
    },
  };
  // Cycle 1: unavailable → the reader's cards win, the memo is set.
  const first = await viewOf("/ws", deps);
  assert.equal(first.kind, "view");
  if (first.kind === "view") assert.equal(first.source, "workspace-reader");
  assert.ok(memo.has("/ws"));
  // The engine now carries a card, but the memo still holds: absent (reader off inside the memo window).
  const depsOff: ViewSourceDeps = { ...deps, readerOn: false };
  nowMs = 1;
  engine = { kind: "view", view: engineView("running", [cardWith("c1", "queued")]) };
  const second = await viewOf("/ws", depsOff);
  assert.equal(second.kind, "absent", "inside the memo window with the reader off there is no view");
  // After the memo's 60 s the engine view is used, the memo is cleared, the reader is not called.
  nowMs = 60_001;
  const before = readerCalls.length;
  const third = await viewOf("/ws", depsOff);
  assert.equal(third.kind, "view");
  if (third.kind === "view") assert.equal(third.source, "engine");
  assert.equal(memo.has("/ws"), false, "the memo is cleared");
  assert.equal(readerCalls.length, before, "the reader is not called");
});
