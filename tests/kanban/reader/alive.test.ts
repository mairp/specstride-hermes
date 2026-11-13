/**
 * T019 — the liveness check (US7, F151-FR-037 §3).
 *
 * A recorded pid is alive when it exists, is not a zombie (or otherwise
 * dead), and its kernel start time matches the recorded one within the
 * closed tolerance. A reused pid fails the check; without a recorded
 * start, existence is the answer; a pid that was never recorded is not
 * alive (but a run may still be judged by its launch).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createProcPort } from "../../helpers/proc-port.ts";
import { procPortOf, readFixture } from "../../helpers/reader-harness.ts";
import { isAlive, procStartedAtMs } from "../../../src/kanban/reader/runs.ts";

function harness(processes: { pid: number; starttime: number }[] = []) {
  const fake = createProcPort({ btime: 1_700_000_000, clkTck: 100, processes: processes.map((p) => ({ pid: p.pid, starttime: p.starttime })) });
  return { fake, proc: procPortOf(fake) };
}

test("a gone pid is not alive", () => {
  const { proc } = harness();
  assert.equal(isAlive(proc, 4199, 42_000_000), false);
});

test("a zombie is not alive", () => {
  const { fake, proc } = harness([{ pid: 4200, starttime: 4200000 }]);
  fake.zombify(4200);
  assert.equal(isAlive(proc, 4200, 42_000_000), false);
});

test("a dead-in-its-own-words process (state X) is not alive", () => {
  const { fake, proc } = harness([{ pid: 4200, starttime: 4200000 }]);
  fake.setProcess({ pid: 4200, state: "X", starttime: 4200000 });
  assert.equal(isAlive(proc, 4200, 42_000_000), false);
});

test("a matching start time is alive, exactly at the tolerance", () => {
  const { proc } = harness([{ pid: 4200, starttime: 4200000 }]); // kernel ms since boot: 42_000_000
  assert.equal(isAlive(proc, 4200, 42_000_000), true);
  assert.equal(isAlive(proc, 4200, 42_001_000), true, "1000 ms is within the closed tolerance");
});

test("a start time off by more than the tolerance is not alive", () => {
  const { proc } = harness([{ pid: 4200, starttime: 4200000 }]);
  assert.equal(isAlive(proc, 4200, 42_001_001), false);
});

test("a reused pid fails the check", () => {
  const { fake, proc } = harness([{ pid: 4212, starttime: 4200000 }]);
  fake.reusePid(4212, { starttime: 9_000_000 }); // same pid, a new kernel start
  assert.equal(isAlive(proc, 4212, 42_000_000), false);
  assert.equal(isAlive(proc, 4212, 900_000_00), true, "the new start time is the one that matches");
});

test("without a recorded start, existence is the answer", () => {
  const { proc } = harness([{ pid: 4200, starttime: 4200000 }]);
  assert.equal(isAlive(proc, 4200, null), true);
});

test("a null pid is never alive", () => {
  const { proc } = harness();
  assert.equal(isAlive(proc, null, null), false);
});

test("procStartedAtMs reads the kernel start time out of the stat line", () => {
  const { proc } = harness([{ pid: 4200, starttime: 4200000 }]);
  assert.equal(procStartedAtMs(proc, 4200), 42_000_000);
  assert.equal(procStartedAtMs(proc, 4199), null);
});

test("the pid-reuse fixture: the run is not ended and not counted as working", () => {
  const { view } = readFixture("pid-reuse", { now: "2026-11-11T09:00:10Z", processes: [{ pid: 4212, starttime: 9000000 }] });
  const run = view.featureDetails["151-reuse"]?.run;
  assert.ok(run);
  assert.equal(run.state, "between passes", "a running launch with no alive process is between passes");
  assert.equal(view.attention.length, 0, "between passes raises no attention");
  assert.equal(
    view.cards.some((card) => card.lane === "failed" || card.lane === "blocked"),
    false,
    "no end lane is assigned from a lost pid",
  );
  assert.equal(view.state, "idle", "the view is idle, not running");
});
