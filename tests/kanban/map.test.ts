/**
 * The lane-to-column map tests (T009; PT-151-003, PT-151-005;
 * contracts/lane-map.md). Totality over the pinned enums, determinism, the
 * v1 defaults, unknowns (`?<raw>` in `scheduled`), the forbidden columns,
 * and the v2 gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANES } from "@specstride/contracts/records/run-view";
import { RUN_STATES } from "@specstride/contracts/state/run-state";
import {
  FORBIDDEN_COLUMNS,
  DISPATCHER_TEST_FILE,
  assertEnumsAgree,
  columnForLane,
  columnForRunState,
  laneMapFor,
  resolveMapVersion,
} from "../../src/kanban/map.ts";
import {
  closedSetLanes,
  closedSetRunStates,
  closedSetForbiddenColumns,
  closedSetTargetColumns,
} from "../../src/kanban/generated/closed-sets.ts";

function tmpHome(): { home: string; cleanup(): void } {
  const home = mkdtempSync(join(tmpdir(), "map-151-"));
  return { home, cleanup() { rmSync(home, { recursive: true, force: true }); } };
}

test("the map is total over the pinned engine lanes (a missing member is a failure)", () => {
  assert.deepEqual([...LANES], [...closedSetLanes], "contracts and the generated set must agree");
  const { lanes } = laneMapFor("v1");
  for (const lane of closedSetLanes) {
    assert.ok(lanes[lane] !== undefined, `lane ${lane} has no v1 row`);
  }
  assert.equal(Object.keys(lanes).length, closedSetLanes.length);
});

test("the map is total over the pinned run states", () => {
  assert.deepEqual([...RUN_STATES], [...closedSetRunStates]);
  const { runStates } = laneMapFor("v1");
  for (const state of closedSetRunStates) {
    assert.ok(runStates[state] !== undefined, `run state ${state} has no v1 row`);
  }
  assert.equal(Object.keys(runStates).length, closedSetRunStates.length);
});

test("assertEnumsAgree holds for the pinned tarball", () => {
  assert.doesNotThrow(() => assertEnumsAgree());
});

test("v1 maps every lane to scheduled except approved to done", () => {
  const { lanes } = laneMapFor("v1");
  for (const lane of closedSetLanes) {
    assert.equal(lanes[lane], lane === "approved" ? "done" : "scheduled", `lane ${lane}`);
  }
});

test("v1 maps every run state to scheduled except finished to done", () => {
  const { runStates } = laneMapFor("v1");
  for (const state of closedSetRunStates) {
    assert.equal(runStates[state], state === "finished" ? "done" : "scheduled", `state ${state}`);
  }
});

test("the map is deterministic: repeated calls give equal tables", () => {
  assert.deepEqual(laneMapFor("v1"), laneMapFor("v1"));
  assert.deepEqual(laneMapFor("v2"), laneMapFor("v2"));
  assert.equal(columnForLane("proposing").column, columnForLane("proposing").column);
});

test("no target is a forbidden column and blocked is never a root or stage target", () => {
  assert.deepEqual([...FORBIDDEN_COLUMNS], [...closedSetForbiddenColumns]);
  for (const version of ["v1", "v2"] as const) {
    const { lanes, runStates } = laneMapFor(version);
    for (const column of Object.values(lanes)) {
      assert.ok(!FORBIDDEN_COLUMNS.includes(column), `${version}: forbidden target ${column}`);
      assert.notEqual(column, "blocked", `${version}: blocked is never a stage target`);
      assert.ok(closedSetTargetColumns.includes(column), `${version}: ${column} is not a target column`);
    }
    for (const column of Object.values(runStates)) {
      assert.ok(!FORBIDDEN_COLUMNS.includes(column), `${version}: forbidden target ${column}`);
      assert.notEqual(column, "blocked", `${version}: blocked is never a root target`);
    }
  }
});

test("an unknown lane shows ?<raw> and sits in scheduled", () => {
  assert.deepEqual(columnForLane("a-ninth-lane"), { column: "scheduled", label: "?a-ninth-lane", unknown: true });
  assert.deepEqual(columnForLane(""), { column: "scheduled", label: "?", unknown: true });
});

test("an unknown run state — a reader state such as crash — shows ?<raw> and sits in scheduled", () => {
  assert.deepEqual(columnForRunState("crash"), { column: "scheduled", label: "?crash", unknown: true });
  assert.deepEqual(columnForRunState("between passes"), { column: "scheduled", label: "?between passes", unknown: true });
  assert.deepEqual(columnForRunState("completed"), { column: "scheduled", label: "?completed", unknown: true });
});

test("known lanes and states map verbatim with unknown false", () => {
  assert.deepEqual(columnForLane("approved"), { column: "done", label: "approved", unknown: false });
  assert.deepEqual(columnForLane("queued"), { column: "scheduled", label: "queued", unknown: false });
  assert.deepEqual(columnForRunState("finished"), { column: "done", label: "finished", unknown: false });
  assert.deepEqual(columnForRunState("running"), { column: "scheduled", label: "running", unknown: false });
});

test("v2 maps proposing and verifying to ready and is refused by default", () => {
  const { lanes } = laneMapFor("v2");
  assert.equal(lanes.proposing, "ready");
  assert.equal(lanes.verifying, "ready");
  assert.equal(lanes.approved, "done");
  assert.equal(resolveMapVersion({ configured: undefined, hermesHome: "/nowhere", hermesVersion: "0.22.2" }), "v1");
  assert.equal(resolveMapVersion({ configured: "v1", hermesHome: "/nowhere", hermesVersion: "0.22.2" }), "v1");
});

test("v2 is refused without the dispatcher-test pass, even when configured", () => {
  const { home, cleanup } = tmpHome();
  try {
    assert.equal(
      resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }),
      "v1",
      "no record at all",
    );
    mkdirSync(join(home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(
      join(home, "specstride-host", "kanban", DISPATCHER_TEST_FILE),
      JSON.stringify({ passed: false, hermesVersion: "0.22.2" }),
    );
    assert.equal(
      resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }),
      "v1",
      "a failed record",
    );
    writeFileSync(
      join(home, "specstride-host", "kanban", DISPATCHER_TEST_FILE),
      JSON.stringify({ passed: true, hermesVersion: "0.22.3" }),
    );
    assert.equal(
      resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }),
      "v1",
      "a pass for another Hermes version",
    );
    writeFileSync(join(home, "specstride-host", "kanban", DISPATCHER_TEST_FILE), "{torn");
    assert.equal(
      resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }),
      "v1",
      "a torn record",
    );
  } finally {
    cleanup();
  }
});

test("v2 is enabled only by configuration AND a matching dispatcher-test pass", () => {
  const { home, cleanup } = tmpHome();
  try {
    mkdirSync(join(home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(
      join(home, "specstride-host", "kanban", DISPATCHER_TEST_FILE),
      JSON.stringify({ passed: true, hermesVersion: "0.22.2", at: "2026-11-12T00:00:00Z" }),
    );
    assert.equal(resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }), "v2");
    // The pass alone does nothing without the configuration.
    assert.equal(resolveMapVersion({ configured: "v1", hermesHome: home, hermesVersion: "0.22.2" }), "v1");
  } finally {
    cleanup();
  }
});

test("v2 through the resolved version gives the ready rows and nothing else moves", () => {
  const { home, cleanup } = tmpHome();
  try {
    mkdirSync(join(home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(
      join(home, "specstride-host", "kanban", DISPATCHER_TEST_FILE),
      JSON.stringify({ passed: true, hermesVersion: "0.22.2" }),
    );
    const version = resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" });
    assert.deepEqual(columnForLane("proposing", version), { column: "ready", label: "proposing", unknown: false });
    assert.deepEqual(columnForLane("verifying", version), { column: "ready", label: "verifying", unknown: false });
    assert.equal(columnForLane("approved", version).column, "done");
    assert.equal(columnForRunState("finished", version).column, "done");
    assert.equal(columnForLane("reviewing", version).column, "scheduled");
  } finally {
    cleanup();
  }
});
