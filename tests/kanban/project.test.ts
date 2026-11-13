/**
 * The projection tests — root cards (T027; PT-151-001, PT-151-004;
 * contracts/card-projection.md "Common fields" and "Root card",
 * F151-FR-001, F151-FR-004). One root card per run, `--tenant specstride`,
 * `--idempotency-key specstride:<run-id>`, the title and body lines of the
 * contract with the state verbatim; two workspaces give two root cards;
 * a state the map does not know reads `[?<raw>]` in `scheduled` (OD-151-10).
 *
 * Pure over the accepted view: no file, no spawn, no clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptKnownView, acceptView, type AcceptedView } from "../../src/kanban/view-read.ts";
import { rootCardsOf, type WantedCard } from "../../src/kanban/project.ts";

/**
 * Accept a raw view the way the sync does for an answer it already trusts
 * (the reader's own output): `acceptKnownView` of view-read.ts.
 */
function acceptLenient(raw: Record<string, unknown>): AcceptedView {
  return acceptKnownView(raw);
}

const FIXTURES = join(import.meta.dirname, "../fixtures/run-views");
const HOST_VERSION = "0.0.0";

function viewOf(name: string) {
  const accepted = acceptView(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")));
  if (!accepted.ok) throw new Error(`fixture ${name} was refused: ${accepted.reason}`);
  return accepted;
}

function roots(name: string): WantedCard[] {
  return rootCardsOf(viewOf(name), { hostVersion: HOST_VERSION });
}

test("one engine view gives exactly one root card with the contract key", () => {
  const cards = roots("every-lane.json");
  assert.equal(cards.length, 1);
  const root = cards[0];
  assert.equal(root.role, "root");
  assert.equal(root.key, "specstride:run-launch-recorded");
  assert.equal(root.source, "engine");
  assert.equal(root.rule, null);
  assert.equal(root.tenant, "specstride");
  assert.equal(root.assignee, "specstride-projection");
});

test("the root title carries the state and feature verbatim", () => {
  const [root] = roots("every-lane.json");
  assert.equal(root.title, "[running] 151-hermes-kanban · run-launch-recorded");
  assert.equal(root.engineValue, "running");
  assert.equal(root.label, "running");
  assert.equal(root.unknown, false);
  assert.equal(root.column, "scheduled");
});

test("the root body holds exactly the contract lines of an engine view", () => {
  const [root] = roots("every-lane.json");
  assert.equal(
    root.body,
    [
      "engine-state: running",
      "display: running",
      "phase: 1/9 pass 0 rejects 0",
      "conditions: dead=false stale=false launch-abandoned=false",
      "status: /specstride status",
      "projected-by: specstride-host-hermes 0.0.0",
    ].join("\n"),
  );
});

test("no body line of an engine view names a source (F151-FR-004)", () => {
  for (const root of roots("every-lane.json")) {
    assert.ok(!root.body.includes("source:"), "an engine body must not carry a source line");
  }
});

test("each of the ten run states maps verbatim (finished → done, rest → scheduled)", () => {
  for (const name of [
    "created.json",
    "starting.json",
    "running.json",
    "paused-quota.json",
    "relaunching.json",
    "stopping.json",
    "blocked-on-human.json",
    "finished.json",
    "stopped.json",
    "failed.json",
  ]) {
    const [root] = roots(join("every-run-state", name));
    const state = name.replace(".json", "");
    assert.equal(root.engineValue, state, name);
    assert.equal(root.title.startsWith(`[${state}] `), true, name);
    assert.equal(root.column, state === "finished" ? "done" : "scheduled", name);
  }
});

test("a reader run state outside the ten reads [?<raw>] in scheduled (OD-151-10)", () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES, "every-lane.json"), "utf8")) as Record<string, unknown>;
  raw.state = "none";
  raw.runId = "run-reader-x";
  raw.source = "workspace-reader";
  raw.laneTable = { id: "workspace-reader", version: "1" };
  raw.cards = [];
  raw.attention = [];
  raw.featureDetails = {
    "151-hermes-kanban": {
      run: { id: "run-reader-x", launch: null, state: "crash", phase: 2, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" },
    },
  };
  const accepted = acceptView(raw);
  if (!accepted.ok) throw new Error(accepted.reason);
  const [root] = rootCardsOf(accepted, { hostVersion: HOST_VERSION });
  assert.equal(root.title, "[?crash] 151-hermes-kanban · run-reader-x");
  assert.equal(root.label, "?crash");
  assert.equal(root.unknown, true);
  assert.equal(root.column, "scheduled");
  assert.equal(root.engineValue, "crash");
  assert.equal(root.body.includes("run-state: crash"), true);
  assert.equal(root.body.includes("source: workspace-reader"), true);
});

test("two workspaces give two root cards, keyed by their own run ids", () => {
  const first = roots("every-lane.json");
  const raw = JSON.parse(readFileSync(join(FIXTURES, "every-run-state", "running.json"), "utf8")) as Record<string, unknown>;
  raw.runId = "run-other";
  const accepted = acceptView(raw);
  if (!accepted.ok) throw new Error(accepted.reason);
  const second = rootCardsOf(accepted, { hostVersion: HOST_VERSION });
  const keys = [...first, ...second].map((card) => card.key);
  assert.equal(keys.length, 2);
  assert.deepEqual([...new Set(keys)], keys);
});

/* ---- T028: stage cards ---- */

import { projectAll, stageCardsOf, attentionCardsOf, speakingRunIdOf } from "../../src/kanban/project.ts";

const LANES = ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"] as const;

test("one stage card per entry of cards[], keyed by run id and card id (T028)", () => {
  const stages = stageCardsOf(viewOf("every-lane.json"), { hostVersion: HOST_VERSION });
  assert.equal(stages.length, 8);
  for (const stage of stages) {
    assert.equal(stage.role, "stage");
    assert.ok(stage.key.startsWith("specstride:run-launch-recorded:"), stage.key);
    assert.equal(stage.tenant, "specstride");
    assert.equal(stage.assignee, "specstride-projection");
    assert.equal(stage.source, "engine");
  }
  const wanted = stages.map((stage) => stage.key).sort();
  assert.deepEqual(wanted, LANES.map((lane) => `specstride:run-launch-recorded:f151-p1-${lane}`).sort());
});

test("each of the eight lanes sits in its v1 mapped column with the lane verbatim (T028)", () => {
  const stages = stageCardsOf(viewOf("every-lane.json"), { hostVersion: HOST_VERSION });
  const byKey = new Map(stages.map((stage) => [stage.engineValue, stage]));
  const expected: Record<string, string> = {
    queued: "scheduled", proposing: "scheduled", verifying: "scheduled", reviewing: "scheduled",
    approved: "done", blocked: "scheduled", paused: "scheduled", failed: "scheduled",
  };
  for (const lane of LANES) {
    const stage = byKey.get(lane);
    assert.ok(stage, lane);
    assert.equal(stage.label, lane, lane);
    assert.equal(stage.unknown, false, lane);
    assert.equal(stage.column, expected[lane], lane);
    assert.equal(stage.title.startsWith(`[${lane}] 151-hermes-kanban phase 1 · f151-p1-${lane}`), true, lane);
  }
});

test("an unknown lane reads ?<raw> in scheduled and the projector goes on (T028)", () => {
  const stages = stageCardsOf(acceptLenient(JSON.parse(readFileSync(join(FIXTURES, "unknown-lane.json"), "utf8")) as Record<string, unknown>), { hostVersion: HOST_VERSION });
  assert.equal(stages.length, 1);
  const [stage] = stages;
  assert.equal(stage.label, "?shelved");
  assert.equal(stage.unknown, true);
  assert.equal(stage.column, "scheduled");
  assert.equal(stage.engineValue, "shelved");
});

test("no link verb anywhere in the projection for stage cards (T028)", () => {
  const wanted = projectAll(viewOf("every-lane.json"), { hostVersion: HOST_VERSION });
  for (const card of wanted) {
    assert.ok(!card.key.includes("link"), card.key);
    assert.ok(!card.body.includes("link"), card.key);
    assert.ok(!card.title.includes("link"), card.title);
  }
  assert.ok(!wanted.some((card) => card.role === ("link" as never)));
});

test("an engine stage body holds the contract lines and no source line (T028)", () => {
  const [stage] = stageCardsOf(viewOf("every-lane.json"), { hostVersion: HOST_VERSION });
  assert.equal(
    stage.body,
    [
      "engine-lane: queued",
      "flags: dead=false stale=false yielded=false",
      "run: specstride:run-launch-recorded",
      "status: /specstride status",
      "projected-by: specstride-host-hermes 0.0.0",
    ].join("\n"),
  );
  assert.ok(!stage.body.includes("source:"), "an engine stage body must not carry a source line");
});

/* ---- T031: reader-view specifics ---- */

/** A reader view over the every-lane fixture with cards and a run for one feature. */
function readerViewOf(name: string, mutate?: (raw: Record<string, unknown>) => void) {
  const raw = JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
  raw.source = "workspace-reader";
  raw.laneTable = { id: "workspace-reader", version: "1" };
  raw.runId = "workspace:002a79217166a359";
  raw.cards = [
    { id: "151-hermes-kanban#1", lane: "proposing", title: "Projection", rule: "W1", ruleId: "W-proposing", flags: { dead: false, stale: false, yielded: false } },
    { id: "151-hermes-kanban#2", lane: "approved", title: "Board", rule: "W2", ruleId: "W-approved", flags: { dead: false, stale: false, yielded: false } },
    { id: "never-ran#queued", lane: "queued", title: "not started (2 phases)", rule: "W0", ruleId: "W-queued", flags: { dead: false, stale: false, yielded: false } },
  ];
  raw.attention = [{ kind: "blocked-on-human", key: "151-hermes-kanban#run", since: "2026-11-11T12:00:00.000Z", oneLine: "151-hermes-kanban: run ended failed in phase 2 (Board) — crash", need: "read the run log, fix the cause, then relaunch", next: "relaunch", fields: {} }];
  raw.featureDetails = {
    "151-hermes-kanban": { run: { id: "run-reader-1", launch: null, state: "running", phase: 2, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" } },
  };
  mutate?.(raw);
  return acceptLenient(raw);
}

test("a reader view projects stage cards only for the feature with a run (T033 rule)", () => {
  const view = readerViewOf("every-lane.json");
  const stages = stageCardsOf(view, { hostVersion: HOST_VERSION });
  assert.deepEqual(stages.map((stage) => stage.key), [
    "specstride:run-reader-1:151-hermes-kanban#1",
    "specstride:run-reader-1:151-hermes-kanban#2",
  ]);
});

test("every reader-sourced body carries source: workspace-reader and the stage rule line (T031)", () => {
  const view = readerViewOf("every-lane.json");
  for (const card of projectAll(view, { hostVersion: HOST_VERSION })) {
    assert.ok(card.body.includes("source: workspace-reader"), card.key);
  }
  const stage = stageCardsOf(view, { hostVersion: HOST_VERSION }).find((s) => s.engineValue === "proposing");
  assert.ok(stage);
  assert.equal(stage.rule, "W1");
  assert.ok(stage.body.includes("rule: W1 (W-proposing)"), stage.body);
  assert.ok(stage.body.startsWith("lane: proposing"), stage.body);
});

test("the reader attention card is keyed by the speaking run and carries the one-line text (T031)", () => {
  const view = readerViewOf("every-lane.json");
  const attn = attentionCardsOf(view, { hostVersion: HOST_VERSION });
  assert.equal(attn.length, 1);
  assert.equal(attn[0].key, "specstride:run-reader-1:attn:151-hermes-kanban#run");
  assert.equal(attn[0].role, "attention");
  assert.equal(attn[0].column, "blocked");
  assert.ok(attn[0].body.includes("text: 151-hermes-kanban: run ended failed in phase 2 (Board) — crash"), attn[0].body);
});

test("speakingRunIdOf: the engine run id for engine views, the feature's run for reader views", () => {
  assert.equal(speakingRunIdOf(viewOf("every-lane.json"), "151-hermes-kanban"), "run-launch-recorded");
  const view = readerViewOf("every-lane.json");
  assert.equal(speakingRunIdOf(view, "151-hermes-kanban"), "run-reader-1");
  assert.equal(speakingRunIdOf(view, "never-ran"), null);
});

test("an engine view projects no source: line in any body (T031)", () => {
  for (const card of projectAll(viewOf("every-lane.json"), { hostVersion: HOST_VERSION })) {
    assert.ok(!card.body.includes("source:"), card.key);
  }
});
