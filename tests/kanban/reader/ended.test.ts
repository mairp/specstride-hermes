/**
 * T020 — the end judgement (US7, F151-FR-037 §4, §5).
 *
 * The launch join is by time only. A run its own events have not ended is
 * judged by the pipeline record (E1), the launch (E2), then the silence
 * rule (E3). A running launch with no alive process is between passes,
 * never an end; without a procs.json nothing is judged at all.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readTree, readFixture } from "../../helpers/reader-harness.ts";
import { launchEndLane, launchOfRun } from "../../../src/kanban/reader/launches.ts";
import type { LaunchRecord } from "../../../src/kanban/reader/launches.ts";
import type { RunRecord } from "../../../src/kanban/reader/runs.ts";

const NOW = "2026-11-11T09:00:10Z";

function baseTree(): Record<string, string> {
  return {
    "specs/151-end/tasks.md": "# 151-end\n\n## Phase 1: first\n- [ ] T1 open\n\n## Phase 2: second\n- [ ] T2 open\n\n",
    ".specstride/workspace.json": JSON.stringify({ schema: "specstride.layout/1", workspaceId: "endrun000000001" }) + "\n",
  };
}

const BASH = (launchId: string, at: string): string =>
  JSON.stringify({ seq: 1, type: "run.started", feature: "151-end", launchId, at }) + "\n";

function launchRecord(overrides: Record<string, unknown>): string {
  return (
    JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-a", feature: "151-end", createdAt: "2026-11-11T08:00:00Z", ...overrides }) + "\n"
  );
}

function runRecord(firstAt: string | null): RunRecord {
  return { runId: "run-a", feature: "151-end", launchId: null, firstAt, lastAt: null, events: [], live: [] };
}

function launch(overrides: Partial<LaunchRecord>): LaunchRecord {
  return {
    launchId: "launch-a",
    feature: "151-end",
    createdAt: "2026-11-11T08:00:00Z",
    endedAt: null,
    state: "exited",
    exitCode: 0,
    exitSignal: null,
    stopRequested: false,
    why: null,
    ...overrides,
  };
}

test("the join lands on the newest launch created no later than the run's first event", () => {
  const joined = launchOfRun(runRecord("2026-11-11T08:00:30Z"), [launch({ launchId: "launch-a" }), launch({ launchId: "launch-b", createdAt: "2026-11-11T08:00:20Z" })]);
  assert.equal(joined?.launchId, "launch-b", "the newer of the eligible launches wins");
});

test("a launch that had already ended before the run began is not the run's launch", () => {
  const none = launchOfRun(runRecord("2026-11-11T08:30:00Z"), [launch({ endedAt: "2026-11-11T08:10:00Z" })]);
  assert.equal(none, null, "the run is shown as started by hand");
});

test("the join does not reach across a later launch", () => {
  const onlyA = launchOfRun(runRecord("2026-11-11T08:00:30Z"), [
    launch({ launchId: "launch-a" }),
    launch({ launchId: "launch-b", createdAt: "2026-11-11T08:10:00Z" }),
  ]);
  assert.equal(onlyA?.launchId, "launch-a", "a launch created after the run began is not the run's launch");
});

test("a run with no first event has no launch", () => {
  assert.equal(launchOfRun(runRecord(null), [launch({})]), null);
});

test("end lanes of the launch states (§5 E2)", () => {
  assert.equal(launchEndLane(launch({ state: "signalled" })), "paused");
  assert.equal(launchEndLane(launch({ state: "stopped" })), "paused");
  assert.equal(launchEndLane(launch({ state: "exited", stopRequested: true })), "paused");
  assert.equal(launchEndLane(launch({ state: "exited", exitCode: 0 })), null);
  assert.equal(launchEndLane(launch({ state: "completed" })), null);
  assert.equal(launchEndLane(launch({ state: "lost" })), "failed");
  assert.equal(launchEndLane(launch({ state: "relaunching" })), "failed", "a state that is not running and not clean fails");
});

test("a pipeline record not older than the run's last event ends the run (E1)", () => {
  const { view } = readFixture("engine-died", { now: NOW });
  const run = view.featureDetails["151-dead"]?.run;
  assert.ok(run);
  assert.equal(run.state, "failed", "the pipeline's recorded state is the outcome, verbatim");
  assert.equal(run.launch, null, "the launch was created after the run began: no join");
  const failed = view.cards.find((card) => card.id === "151-dead#1");
  assert.ok(failed);
  assert.equal(failed.lane, "failed");
  assert.equal(failed.ruleId, "W-failed");
  assert.equal(view.attention.length, 1, "a failed card raises exactly one attention item");
  assert.equal(view.attention[0].key, "151-dead#run");
  assert.equal(view.attention[0].kind, "blocked-on-human");
  assert.ok(!view.attention[0].oneLine.includes("/"), "no path is written into the item");
  assert.ok(Buffer.byteLength(view.attention[0].oneLine, "utf8") <= 240);
});

test("a signalled launch ends the run as paused, without an attention item", () => {
  const { view } = readFixture("signalled", { now: NOW });
  const run = view.featureDetails["151-signal"]?.run;
  assert.ok(run);
  assert.equal(run.state, "stopped", "the recorded launch state is the outcome, verbatim");
  assert.equal(view.attention.length, 0, "paused is not blocked-on-human");
});

test("a launch lost by its supervisor ends the run as failed with one attention item", () => {
  const { view } = readFixture("vanished", { now: NOW, processes: [] });
  const run = view.featureDetails["151-vanish"]?.run;
  assert.ok(run);
  assert.equal(run.state, "lost");
  const failed = view.cards.find((card) => card.id === "151-vanish#1");
  assert.ok(failed);
  assert.equal(failed.lane, "failed");
  assert.equal(failed.ruleId, "W-failed");
  assert.equal(view.attention.length, 1);
  assert.equal(view.attention[0].key, "151-vanish#run");
  assert.equal(view.attention[0].next, "relaunch");
});

test("a clean exit (0) gives no end lane and no attention", () => {
  // Without a live process the relaunched run joins its predecessor's
  // launch record, which exited 0: ended, but on no end lane.
  const { view } = readFixture("relaunch", { now: NOW });
  const run = view.featureDetails["151-relaunch"]?.run;
  assert.ok(run);
  assert.equal(run.state, "exited");
  assert.equal(
    view.cards.some((card) => card.lane === "failed" || card.lane === "blocked" || card.lane === "paused"),
    false,
    "no end lane is assigned from a clean exit",
  );
  assert.equal(view.attention.length, 0);
});

test("no launch, procs.json present: ended lost only after 120 s of silence (E3)", () => {
  const judged = readFixture("no-launch", { now: "2026-11-11T08:03:00Z" });
  assert.equal(judged.view.featureDetails["151-nolaunch"]?.run.state, "lost", "121 s without an event ends the run");
  assert.equal(judged.view.attention.length, 0, "every task is ticked: no card sits on a failed lane");
  assert.equal(judged.view.cards.every((card) => card.lane === "approved"), true, "the ticked phases stay approved");

  const live = readFixture("no-launch", { now: "2026-11-11T08:01:50Z" });
  assert.equal(live.view.featureDetails["151-nolaunch"]?.run.state, "running", "90 s of silence is not judged");
});

test("without procs.json nothing is judged, however long the silence", () => {
  const tree = baseTree();
  tree[".specstride/events.jsonl"] =
    BASH("manual", "2026-11-11T07:00:00Z") +
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-end", launchId: "manual", phase: 1, at: "2026-11-11T07:00:30Z" }) + "\n";
  tree[".specstride/features/151-end/runs/run-launch-manual/lease.json"] =
    JSON.stringify({ schema: "specstride.lease/1", feature: "151-end", launchId: "manual", pid: null }) + "\n";
  const { view } = readTree(tree, { now: "2026-11-11T08:00:00Z" }); // one hour of silence
  assert.equal(view.featureDetails["151-end"]?.run.state, "running", "no registry: nothing is judged, the run reads as it recorded itself");
  assert.equal(view.attention.length, 0);
});

test("with procs.json the same silence ends the run (E3)", () => {
  const tree = baseTree();
  tree[".specstride/events.jsonl"] =
    BASH("manual", "2026-11-11T07:00:00Z") +
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-end", launchId: "manual", phase: 1, at: "2026-11-11T07:00:30Z" }) + "\n";
  tree[".specstride/features/151-end/runs/run-launch-manual/lease.json"] =
    JSON.stringify({ schema: "specstride.lease/1", feature: "151-end", launchId: "manual", pid: null }) + "\n";
  tree[".specstride/workspaces/endrun000000001/procs.json"] = JSON.stringify({ schema: "specstride.procs/1", processes: [] }) + "\n";
  const { view } = readTree(tree, { now: "2026-11-11T08:00:00Z" });
  assert.equal(view.featureDetails["151-end"]?.run.state, "lost");
  const failed = view.cards.find((card) => card.id === "151-end#1");
  assert.equal(failed?.lane, "failed");
  assert.equal(view.attention.length, 1);
});
