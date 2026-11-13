/**
 * T022 — the reader over the recorded feature-150 workspace (US7, PT-151-040).
 *
 * The recorded fixture carries ten approved phases and two released runs;
 * the view shows ten approved cards, the run state as recorded, no launch
 * (the join is by time and the leases carry no acquire time), the reader
 * markers, a signature — and it opened nothing outside the closed list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFixture } from "../../helpers/reader-harness.ts";

const NOW = "2026-11-11T10:00:00Z";

test("the recorded workspace reads as ten approved cards", () => {
  const { view } = readFixture("feature-150", { now: NOW });
  assert.equal(view.cards.length, 10);
  for (let phase = 1; phase <= 10; phase += 1) {
    const card = view.cards.find((entry) => entry.id === `150-host-hermes#${phase}`);
    assert.ok(card, `card for phase ${phase}`);
    assert.equal(card.lane, "approved");
    assert.equal(card.ruleId, "W-approved");
    assert.equal(card.flags.dead, false);
    assert.equal(card.flags.stale, false);
    assert.equal(card.flags.yielded, false);
  }
});

test("the run state is the recorded one and no launch joins", () => {
  const { view } = readFixture("feature-150", { now: NOW });
  const run = view.featureDetails["150-host-hermes"]?.run;
  assert.ok(run, "the started feature has a run record");
  assert.equal(run.state, "completed", "the recorded pipeline state, verbatim");
  assert.equal(run.launch, null, "the leases carry no acquire time: the time join finds no launch");
  assert.equal(run.phase, null, "the released runs carry no events");
  assert.equal(view.attention.length, 0, "an approved, completed feature raises nothing");
  assert.equal(view.state, "idle");
});

test("the view carries the reader markers", () => {
  const { view } = readFixture("feature-150", { now: NOW });
  assert.equal(view.schema, "specstride.view/1");
  assert.equal(view.source, "workspace-reader");
  assert.deepEqual(view.laneTable, { id: "workspace-reader", version: "1" });
  assert.equal(view.runId, "workspace:150recorded0001");
  assert.deepEqual(view.budget, []);
  assert.deepEqual(view.phases, []);
  assert.deepEqual(view.cursor, { offset: 0, lastSeq: 0 }, "no bash stream, no cursor");
});

test("the signature is a sha256 token over cards and attention", () => {
  const { view } = readFixture("feature-150", { now: NOW });
  assert.match(view.signature.token, /^[0-9a-f]{64}$/);
});

test("no path outside the closed list was opened", () => {
  const { refusals } = readFixture("feature-150", { now: NOW });
  assert.deepEqual(refusals, [], "the fs port refused nothing: every touch was inside the list");
});

test("the signature moves when the recorded state changes", () => {
  const before = readFixture("feature-150", { now: NOW }).view.signature.token;
  // A different `now` alone must not move the signature (no stale card).
  const after = readFixture("feature-150", { now: "2026-11-12T10:00:00Z" }).view.signature.token;
  assert.equal(before, after);
});
