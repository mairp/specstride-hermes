/**
 * The dispatch guard tests (T040; PT-151-010, PT-151-011; F151-FR-010,
 * F151-FR-011; contracts/lane-map.md, card-projection.md "Common fields").
 *
 * Over every write of every fixture sequence — the recorded engine views of
 * tests/fixtures/run-views (every lane, every run state, unknowns, attention)
 * and reader views over both sources — guard A (`--assignee
 * specstride-projection`, F151-FR-010) and the tenant sit on every `create`,
 * the only verb Hermes 0.22.2 accepts them on (host facts read 2026-11-13/14
 * from `hermes kanban <verb> --help`); the assignee and tenant they set
 * persist on the card, so an unguarded create is the one write that could
 * leave a card spawnable. Every argv names a verb of the closed set and a
 * write that would leave a guard off throws BEFORE the spawn
 * (assertWriteGuards). Every planned column is one of the target columns of
 * the map, never a forbidden one, and `ready` appears only under map v2,
 * which is refused unless the live dispatcher test recorded a pass for the
 * installed Hermes version (F151-FR-003).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncOnce, type SyncDeps } from "../../src/kanban/sync.ts";
import { assertWriteGuards, type KanbanCall } from "../../src/kanban/hermes-kanban.ts";
import { columnForLane, columnForRunState, laneMapFor, resolveMapVersion } from "../../src/kanban/map.ts";
import { closedSetForbiddenColumns, closedSetTargetColumns } from "../../src/kanban/generated/closed-sets.ts";
import type { ShimAnswer } from "../../src/kanban/shim-call.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RUN_VIEWS = join(ROOT, "tests", "fixtures", "run-views");

/** The recorded engine fixture views: every lane, every run state, unknowns. */
function engineFixtures(): { name: string; view: Record<string, unknown> }[] {
  const out: { name: string; view: Record<string, unknown> }[] = [];
  for (const entry of readdirSync(RUN_VIEWS, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const name of readdirSync(join(RUN_VIEWS, entry.name))) {
        out.push({
          name: `${entry.name}/${name}`,
          view: JSON.parse(readFileSync(join(RUN_VIEWS, entry.name, name), "utf8")) as Record<string, unknown>,
        });
      }
    } else if (entry.name.endsWith(".json")) {
      out.push({ name: entry.name, view: JSON.parse(readFileSync(join(RUN_VIEWS, entry.name), "utf8")) as Record<string, unknown> });
    }
  }
  return out;
}

/** A reader view (both sources exercised: reader here, engine fixtures above). */
function readerView(opts: {
  runId: string;
  state?: string;
  cards?: { id: string; lane: string; rule?: string; ruleId?: string }[];
  attention?: { key: string; kind: string; "one-line": string }[];
  features?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: `workspace:w`,
    state: "running",
    cards: opts.cards ?? [{ id: "151-hermes-kanban#1", lane: "proposing", rule: "W1", ruleId: "W-proposing" }],
    attention: opts.attention ?? [],
    budget: [],
    phases: [],
    featureDetails: opts.features ?? {
      "151-hermes-kanban": { run: { id: opts.runId, state: opts.state ?? "running", phase: 1, lastAt: "2026-11-11T12:00:00.000Z" } },
    },
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: "reader" },
  };
}

/** One recorded write. */
interface Write {
  verb: string;
  argv: string[];
}

/** Run one cycle over the given view and return the executed writes. */
async function cycle(view: Record<string, unknown>, source: "engine" | "reader"): Promise<Write[]> {
  const hermesHome = mkdtempSync(join(tmpdir(), "guards-test-"));
  const writes: Write[] = [];
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    engine: async (): Promise<ShimAnswer> =>
      source === "engine" ? { kind: "view", view } : { kind: "unavailable", reason: "engine exit 70" },
    reader: () => (source === "reader" ? view : null),
    readBack: false,
    exec: async (call: KanbanCall) => {
      writes.push({ verb: String(call.argv[4]), argv: [...call.argv] });
      return { exit: 0, stdout: JSON.stringify({ id: `hermes-${writes.length}` }) + "\n", stderr: "" };
    },
    log: () => {},
  };
  try {
    await syncOnce("/ws", deps);
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
  }
  return writes;
}

test("every create of every engine fixture carries both guards; every argv is verb-closed", async () => {
  const fixtures = engineFixtures();
  assert.ok(fixtures.length >= 14, `expected the recorded fixture set, got ${fixtures.length}`);
  for (const fixture of fixtures) {
    // `empty` is a valid view with no card: the memo + reader path may write
    // nothing; the guard assertions below hold over whatever it does write.
    const writes = await cycle(fixture.view, "engine");
    for (const write of writes) {
      assertWriteGuards({ argv: write.argv, stdin: "" }); // throws when a guard is off
      if (write.verb === "create") {
        // Guard A and the tenant, on the only verb the CLI accepts them on.
        assert.equal(write.argv[write.argv.indexOf("--assignee") + 1], "specstride-projection", fixture.name);
        assert.equal(write.argv[write.argv.indexOf("--tenant") + 1], "specstride", fixture.name);
        assert.ok(write.argv.includes("--idempotency-key"), fixture.name);
      } else {
        // No create-only flag on any other verb: the real CLI would reject
        // the write with "unrecognized arguments" (host facts above).
        for (const flag of ["--assignee", "--tenant", "--idempotency-key", "--workspace", "--body-file"]) {
          assert.ok(!write.argv.includes(flag), `${fixture.name}: ${flag} on ${write.verb}`);
        }
      }
      assert.ok(
        !closedSetForbiddenColumns.some((column) => write.argv.includes(`--column ${column}`)),
        `${fixture.name}: a forbidden column in the argv of ${write.verb}`,
      );
    }
  }
});

test("every create of a reader fixture sequence carries both guards", async () => {
  const sequences = [
    readerView({ runId: "run-r1" }),
    readerView({
      runId: "run-r2",
      state: "crash", // the recorded reader outcome (OD-151-10)
      cards: [
        { id: "151-hermes-kanban#1", lane: "approved", rule: "W2", ruleId: "W-approved" },
        { id: "151-hermes-kanban#2", lane: "totally-unknown-lane", rule: "W1", ruleId: "W-unknown" },
      ],
      attention: [{ key: "151-hermes-kanban#run", kind: "blocked-on-human", "one-line": "run ended failed" }],
    }),
  ];
  for (const view of sequences) {
    const writes = await cycle(view, "reader");
    assert.ok(writes.length > 0, "the reader sequence must produce writes");
    for (const write of writes) {
      assertWriteGuards({ argv: write.argv, stdin: "" });
      if (write.verb === "create") {
        assert.equal(write.argv[write.argv.indexOf("--assignee") + 1], "specstride-projection");
        assert.equal(write.argv[write.argv.indexOf("--tenant") + 1], "specstride");
        assert.ok(write.argv.includes("--idempotency-key"));
      }
    }
  }
});

test("every planned column of every fixture write is a target column of the map", async () => {
  // The projection decides the column before any write; re-map every fixture
  // value and assert the column lands in the closed target set, never a
  // forbidden one, and that an unknown value still lands in `scheduled`.
  for (const fixture of engineFixtures()) {
    const view = fixture.view as { state?: string; cards?: { lane?: string }[] };
    if (typeof view.state === "string") {
      const root = columnForRunState(view.state, "v1");
      assert.ok(
        (closedSetTargetColumns as readonly string[]).includes(root.column),
        `${fixture.name}: root column ${root.column}`,
      );
      assert.ok(!closedSetForbiddenColumns.includes(root.column), fixture.name);
    }
    for (const card of view.cards ?? []) {
      if (typeof card.lane !== "string") continue;
      const stage = columnForLane(card.lane, "v1");
      assert.ok((closedSetTargetColumns as readonly string[]).includes(stage.column), fixture.name);
      assert.ok(!closedSetForbiddenColumns.includes(stage.column), fixture.name);
    }
  }
  // And the reader fixtures: `ready` appears NOWHERE under map v1.
  for (const lane of ["proposing", "verifying", "queued", "approved", "blocked", "paused", "failed", "reviewing"]) {
    assert.notEqual(columnForLane(lane, "v1").column, "ready", lane);
  }
});

test("a write that would leave either guard off throws before the spawn", () => {
  const good = { argv: ["hermes", "-p", "specstride", "kanban", "create", "--tenant", "specstride", "--assignee", "specstride-projection", "--idempotency-key", "k"], stdin: "" };
  assert.doesNotThrow(() => assertWriteGuards(good));
  // Guard A off (a profile assignee): throws.
  assert.throws(
    () => assertWriteGuards({ ...good, argv: good.argv.map((v) => (v === "specstride-projection" ? "hermes" : v)) }),
    /assignee/,
  );
  // Assignee flag absent entirely: throws.
  const noAssignee = good.argv.filter((v, i) => !(v === "--assignee" || (i > 0 && good.argv[i - 1] === "--assignee")));
  assert.throws(() => assertWriteGuards({ argv: noAssignee, stdin: "" }), /assignee/);
  // Tenant off: throws.
  const wrongTenant = [...good.argv];
  wrongTenant[6] = "other";
  assert.throws(() => assertWriteGuards({ argv: wrongTenant, stdin: "" }), /tenant/);
  // No idempotency key: throws.
  assert.throws(
    () => assertWriteGuards({ argv: ["hermes", "-p", "specstride", "kanban", "create", "--tenant", "specstride", "--assignee", "specstride-projection"], stdin: "" }),
    /idempotency/,
  );
  // A verb outside the closed set: throws.
  assert.throws(
    () => assertWriteGuards({ argv: ["hermes", "-p", "specstride", "kanban", "claim", "--tenant", "specstride", "--assignee", "specstride-projection", "--idempotency-key", "k"], stdin: "" }),
    /closed set/,
  );
});

test("`ready` appears only under map v2, and v2 is gated on the dispatcher-test record", () => {
  // v2's own tables are the only place `ready` exists.
  const v2 = laneMapFor("v2");
  assert.equal(v2.lanes.proposing, "ready");
  assert.equal(v2.lanes.verifying, "ready");
  assert.ok(!Object.values(v2.runStates).includes("ready" as never));
  // Under v1 (the default) nothing maps to `ready`.
  const v1 = laneMapFor("v1");
  for (const column of [...Object.values(v1.lanes), ...Object.values(v1.runStates)]) {
    assert.notEqual(column, "ready");
  }
  // The gate: `map: v2` without a passing dispatcher-test record still
  // resolves to v1 — the live test's pass file is what unlocks it.
  const home = mkdtempSync(join(tmpdir(), "guards-v2-"));
  try {
    assert.equal(resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }), "v1");
    const record = join(home, "specstride-host", "kanban", "dispatcher-test.json");
    mkdirSync(join(home, "specstride-host", "kanban"), { recursive: true });
    writeFileSync(record, JSON.stringify({ passed: true, hermesVersion: "0.22.2" }));
    assert.equal(resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.22.2" }), "v2");
    // A pass recorded for another Hermes version does not unlock v2.
    assert.equal(resolveMapVersion({ configured: "v2", hermesHome: home, hermesVersion: "0.23.0" }), "v1");
    // Unconfigured stays v1 even with the record present.
    assert.equal(resolveMapVersion({ hermesHome: home, hermesVersion: "0.22.2" }), "v1");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
