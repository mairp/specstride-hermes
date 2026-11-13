/**
 * T018 — pickRun and title attribution (US7, F151-FR-037 §3, §4).
 *
 * The run that speaks for a feature is the newest run by first event that
 * still has an alive entry; else the newest by first event. A control-root
 * run belongs to a feature when a `phase.started` title matches its
 * tasks.md titles; `loop.json` names a run only when no title matched.
 * The bash stream's runs are attributed by their own `feature` fields.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readTree, readFixture } from "../../helpers/reader-harness.ts";

const NOW = "2026-11-11T09:00:10Z";

const TITLED_TASKS = (feature: string): string =>
  `# ${feature}\n\n## Phase 1: alpha\n- [ ] A1 open\n\n## Phase 2: beta\n- [ ] A2 open\n\n`;

function treeWith(overrides: Record<string, string>): Record<string, string> {
  return {
    "specs/151-pick/tasks.md": TITLED_TASKS("151-pick"),
    ".specstride/workspace.json": JSON.stringify({ schema: "specstride.layout/1", workspaceId: "pickrun00000001" }) + "\n",
    ...overrides,
  };
}

const CONTROL_EVENT = (title: string, at: string): string =>
  JSON.stringify({ seq: 1, type: "phase.started", at, title }) + "\n";

test("a control-root run is attributed by a matching phase title, not by loop.json", () => {
  const { view } = readTree(
    treeWith({
      ".specstride/workspaces/pickrun00000001/runs/run-a/events.jsonl": CONTROL_EVENT("unrelated", "2026-11-11T08:00:00Z"),
      ".specstride/workspaces/pickrun00000001/runs/run-b/events.jsonl": CONTROL_EVENT("alpha", "2026-11-11T08:30:00Z"),
      ".specstride/workspaces/pickrun00000001/features/151-pick/loop.json": JSON.stringify({ schema: "specstride.loop/1", runId: "run-a" }) + "\n",
      ".specstride/workspaces/pickrun00000001/procs.json": JSON.stringify({ schema: "specstride.procs/1", processes: [] }) + "\n",
    }),
    { now: NOW },
  );
  const run = view.featureDetails["151-pick"]?.run;
  assert.ok(run, "the feature has a run record");
  assert.equal(run.id, "run-b", "the title-matched run speaks, loop.json notwithstanding");
});

test("loop.json names the run only when no run's titles match", () => {
  const { view } = readTree(
    treeWith({
      ".specstride/workspaces/pickrun00000001/runs/run-a/events.jsonl": CONTROL_EVENT("unrelated", "2026-11-11T08:00:00Z"),
      ".specstride/workspaces/pickrun00000001/features/151-pick/loop.json": JSON.stringify({ schema: "specstride.loop/1", runId: "run-a" }) + "\n",
      ".specstride/workspaces/pickrun00000001/procs.json": JSON.stringify({ schema: "specstride.procs/1", processes: [] }) + "\n",
    }),
    { now: NOW },
  );
  assert.equal(view.featureDetails["151-pick"]?.run.id, "run-a", "the loop-named run speaks");
});

test("an alive entry wins over a newer first event", () => {
  const { view } = readTree(
    treeWith({
      ".specstride/events.jsonl":
        JSON.stringify({ seq: 1, type: "run.started", feature: "151-pick", launchId: "old", at: "2026-11-11T08:00:00Z" }) + "\n" +
        JSON.stringify({ seq: 2, type: "run.started", feature: "151-pick", launchId: "new", at: "2026-11-11T08:58:00Z" }) + "\n",
      ".specstride/workspaces/pickrun00000001/procs.json":
        JSON.stringify({
          schema: "specstride.procs/1",
          processes: [{ pid: 5100, feature: "151-pick", launchId: "old", starttime: 4200000 }],
        }) + "\n",
    }),
    { now: NOW, processes: [{ pid: 5100, starttime: 4200000 }] },
  );
  assert.equal(view.featureDetails["151-pick"]?.run.id, "run-old", "the older run with the alive process speaks");
  assert.equal(view.state, "running");
});

test("with no alive entry the newest run by first event speaks (the relaunched run)", () => {
  const alive = readFixture("relaunch", { now: NOW, processes: [{ pid: 4200, starttime: 4200000 }] });
  assert.equal(alive.view.featureDetails["151-relaunch"]?.run.id, "run-launch-r1", "the newer run speaks");
  assert.equal(alive.view.featureDetails["151-relaunch"]?.run.state, "running", "its alive process keeps the run running");
  assert.equal(alive.view.state, "running");
  assert.deepEqual(
    alive.view.cards.map((card) => `${card.id} ${card.lane} ${card.ruleId}`),
    ["151-relaunch#1 approved W-approved", "151-relaunch#2 proposing W-proposing"],
  );

  const dead = readFixture("relaunch", { now: NOW });
  assert.equal(dead.view.featureDetails["151-relaunch"]?.run.id, "run-launch-r1", "the newer run speaks even without a live process");
});

test("the bash stream groups runs by launch id and attributes them by their feature fields", () => {
  const { view } = readTree(
    {
      "specs/151-pick/tasks.md": TITLED_TASKS("151-pick"),
      "specs/151-other/tasks.md": TITLED_TASKS("151-other"),
      ".specstride/workspace.json": JSON.stringify({ schema: "specstride.layout/1", workspaceId: "pickrun00000001" }) + "\n",
      ".specstride/events.jsonl":
        JSON.stringify({ seq: 1, type: "run.started", feature: "151-pick", launchId: "p1", at: "2026-11-11T08:00:00Z" }) + "\n" +
        JSON.stringify({ seq: 2, type: "run.started", feature: "151-other", launchId: "o1", at: "2026-11-11T08:10:00Z" }) + "\n" +
        JSON.stringify({ seq: 4, type: "phase.started", feature: "151-other", launchId: "o1", phase: 1, at: "2026-11-11T08:15:00Z" }) + "\n" +
        JSON.stringify({ seq: 3, type: "phase.started", feature: "151-pick", launchId: "p1", phase: 2, at: "2026-11-11T08:20:00Z" }) + "\n",
    },
    { now: NOW },
  );
  assert.equal(view.featureDetails["151-pick"]?.run.id, "run-p1");
  assert.equal(view.featureDetails["151-pick"]?.run.phase, 2);
  assert.equal(view.featureDetails["151-other"]?.run.id, "run-o1");
  assert.equal(view.featureDetails["151-other"]?.run.phase, 1);
});

test("a run whose events began before its relaunch launch still reads as running", () => {
  // The relaunched run's own launch was created after its first event; the
  // join lands on the predecessor, whose exit (0) never ends a live run.
  const { view } = readFixture("relaunch", { now: NOW, processes: [{ pid: 4200, starttime: 4200000 }] });
  assert.equal(view.featureDetails["151-relaunch"]?.run.launch, "launch-r0");
  assert.equal(view.featureDetails["151-relaunch"]?.run.state, "running", "an alive process keeps the run working");
});
