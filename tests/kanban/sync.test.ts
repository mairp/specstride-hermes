/**
 * The sync tests (T029, T032, T033; PT-151-007, PT-151-008, PT-151-040,
 * PT-151-041, PT-151-042; contracts/sync-sidecar.md, card-projection.md
 * "Write sequence per transition"). A scripted sequence of views over an
 * injected engine probe, reader and verb executor: the exact verb list per
 * transition, the signature short-cut, restart idempotency, archive on a
 * run gone, `kanban.db` never opened, live-fact edits, and the card-volume
 * rule over corpus-42.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncOnce, workspaceKey, type SyncDeps } from "../../src/kanban/sync.ts";
import { ProjectionStore } from "../../src/kanban/store.ts";
import type { ShimAnswer } from "../../src/kanban/shim-call.ts";
import type { KanbanCall } from "../../src/kanban/hermes-kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** A reader view with one feature's run and its phase cards. */
function readerViewOf(opts: {
  runId: string;
  state?: string;
  lastAt?: string | null;
  cards?: { id: string; lane: string; rule?: string; ruleId?: string; title?: string }[];
  features?: Record<string, { run: { id: string; state: string; phase: number | null; lastAt: string | null } }>;
}): Record<string, unknown> {
  const features = opts.features ?? {
    "151-hermes-kanban": { run: { id: opts.runId, state: opts.state ?? "running", phase: 1, lastAt: opts.lastAt ?? "2026-11-11T12:00:00.000Z" } },
  };
  const cards = opts.cards ?? [
    { id: "151-hermes-kanban#1", lane: "proposing", rule: "W1", ruleId: "W-proposing", title: "Projection" },
  ];
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: `workspace:w`,
    state: "running",
    cards,
    attention: [],
    budget: [],
    phases: [],
    featureDetails: features,
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: "reader" },
  };
}

interface Executed {
  verb: string;
  key: string;
}

/** The harness: tmp HERMES_HOME, counting executor, stub engine/reader. */
function harness(opts: { engine?: () => ShimAnswer; reader?: () => Record<string, unknown> | null }) {
  const hermesHome = mkdtempSync(join(tmpdir(), "sync-test-"));
  const executed: Executed[] = [];
  let nextId = 1;
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    engine: async () => opts.engine?.() ?? { kind: "unavailable", reason: "engine exit 70" },
    reader: () => opts.reader?.() ?? null,
    readBack: false,
    exec: async (call: KanbanCall) => {
      executed.push({ verb: call.argv[4] ?? "", key: call.key ?? "" });
      return { exit: 0, stdout: JSON.stringify({ id: `hermes-${nextId++}` }) + "\n", stderr: "" };
    },
    log: () => {},
  };
  return {
    deps,
    executed,
    hermesHome,
    cleanup: () => rmSync(hermesHome, { recursive: true, force: true }),
  };
}

const verbsOf = (executed: readonly Executed[]) => executed.map((call) => call.verb);

test("the scripted sequence gives the contract verb list per transition (T029)", async () => {
  const view = readerViewOf({ runId: "run-a1" });
  const h = harness({ reader: () => view });
  try {
    // Transition 1: everything new → `create` + `schedule` per card (root + stage).
    const first = await syncOnce("/ws", h.deps);
    assert.equal(first.kind, "view");
    assert.deepEqual(verbsOf(h.executed), ["create", "schedule", "create", "schedule"]);
    assert.deepEqual(
      h.executed.map((call) => call.key),
      ["specstride:run-a1", "specstride:run-a1", "specstride:run-a1:151-hermes-kanban#1", "specstride:run-a1:151-hermes-kanban#1"],
    );

    // Transition 2: an unchanged signature → 0 hermes calls.
    h.executed.length = 0;
    const second = await syncOnce("/ws", { ...h.deps, memo: new Map() });
    assert.equal(second.shortCircuit, true);
    assert.deepEqual(h.executed, []);

    // Transition 3: the root's live fact changed → exactly one `edit` of the root card.
    h.executed.length = 0;
    const changed = readerViewOf({ runId: "run-a1", lastAt: "2026-11-11T12:30:00.000Z" });
    const third = await syncOnce("/ws", { ...h.deps, reader: () => changed, memo: new Map() });
    assert.deepEqual(verbsOf(h.executed), ["edit"]);
    assert.deepEqual(h.executed.map((call) => call.key), ["specstride:run-a1"]);

    // Transition 4: the run is gone from the view → `archive`, never `delete`.
    h.executed.length = 0;
    const gone = readerViewOf({
      runId: "run-none",
      features: {},
      cards: [{ id: "another#1", lane: "queued", rule: "W4", ruleId: "W-queued" }],
    });
    const fourth = await syncOnce("/ws", { ...h.deps, reader: () => gone, memo: new Map() });
    assert.equal(fourth.kind, "view");
    assert.deepEqual(verbsOf(h.executed), ["archive", "archive"]);
    assert.ok(!verbsOf(h.executed).includes("delete"));
  } finally {
    h.cleanup();
  }
});

test("a restart with the same store gives 0 creates (T029)", async () => {
  const h = harness({ reader: () => readerViewOf({ runId: "run-a1" }) });
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    // A brand-new memo map: the restart's view source has no engine memory.
    const result = await syncOnce("/ws", { ...h.deps, memo: new Map(), now: () => 2_000_000 });
    assert.ok(!verbsOf(h.executed).includes("create"), JSON.stringify(verbsOf(h.executed)));
    assert.ok(result.shortCircuit, "the unchanged view is short-circuited from the store");
  } finally {
    h.cleanup();
  }
});

test("kanban.db is never opened during a full cycle (T029)", async () => {
  const hermesHome = mkdtempSync(join(tmpdir(), "sync-db-"));
  const driver = join(hermesHome, "driver.mjs");
  const preload = join(hermesHome, "no-kanban-db.mjs");
  // The preload makes ANY open of kanban.db (sync, callback or promises) throw.
  writeFileSync(
    preload,
    `
const { createRequire } = await import("node:module");
const fs = createRequire(import.meta.url)("node:fs");
const guard = (path) => { if (String(path).includes("kanban.db")) throw new Error("kanban.db must never be opened"); };
for (const name of ["openSync", "open"]) {
  const original = fs[name];
  fs[name] = (...args) => { guard(args[0]); return original(...args); };
}
const promisify = fs.promises.open.bind(fs.promises);
fs.promises.open = async (...args) => { guard(args[0]); return promisify(...args); };
`,
  );
  writeFileSync(
    driver,
    `
const { syncOnce } = await import(${JSON.stringify(join(ROOT, "src/kanban/sync.ts"))});
const view = ${JSON.stringify(readerViewOf({ runId: "run-a1" }))};
const executed = [];
let nextId = 1;
const result = await syncOnce("/ws", {
  hermesHome: process.argv[2],
  now: () => 1_000_000,
  engine: async () => ({ kind: "unavailable", reason: "engine exit 70" }),
  reader: () => view,
  readBack: false,
  exec: async (call) => {
    executed.push(call.argv[4]);
    return { exit: 0, stdout: JSON.stringify({ id: "hermes-" + nextId++ }) };
  },
  log: () => {},
});
console.log(JSON.stringify({ kind: result.kind, verbs: executed, ok: result.ok }));
`,
  );
  try {
    const out = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, driver, hermesHome], {
      encoding: "utf8",
    });
    assert.equal(out.status, 0, out.stderr);
    const parsed = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "{}") as { kind: string; verbs: string[]; ok: boolean };
    assert.equal(parsed.kind, "view");
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.verbs, ["create", "schedule", "create", "schedule"]);
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
  }
});

test("two reader views differing only in a live fact give exactly one root edit (T032)", async () => {
  const h = harness({ reader: () => readerViewOf({ runId: "run-live" }) });
  try {
    await syncOnce("/ws", h.deps);
    // Live fact 1: a fresh last-event time (an alive run's newest event).
    h.executed.length = 0;
    const later = readerViewOf({ runId: "run-live", lastAt: "2026-11-11T13:00:00.000Z" });
    const result = await syncOnce("/ws", { ...h.deps, reader: () => later, memo: new Map() });
    assert.deepEqual(verbsOf(h.executed), ["edit"], JSON.stringify(verbsOf(h.executed)));
    assert.deepEqual(h.executed.map((call) => call.key), ["specstride:run-live"]);
    assert.ok(!verbsOf(h.executed).includes("create"));

    // Live fact 2: the agent count (an alive pid appeared) — still only the root.
    h.executed.length = 0;
    const withAgent = JSON.parse(JSON.stringify(later)) as Record<string, unknown>;
    withAgent.agents = [{ role: "proposer", pid: 4321, what: "proposing" }];
    const result2 = await syncOnce("/ws", { ...h.deps, reader: () => withAgent, memo: new Map() });
    void result2;
    assert.deepEqual(verbsOf(h.executed), ["edit"], JSON.stringify(verbsOf(h.executed)));
    assert.deepEqual(h.executed.map((call) => call.key), ["specstride:run-live"]);
  } finally {
    h.cleanup();
  }
});

test("two equal reader views give no verbs at all (T032)", async () => {
  const view = readerViewOf({ runId: "run-eq" });
  const h = harness({ reader: () => view });
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    const result = await syncOnce("/ws", { ...h.deps, memo: new Map() });
    assert.deepEqual(h.executed, []);
    assert.equal(result.shortCircuit, true);
  } finally {
    h.cleanup();
  }
});

test("over corpus-42 the wanted set holds cards of exactly one feature — the one with a run (T033)", async () => {
  const corpus = join(ROOT, "tests/fixtures/workspaces/corpus-42");
  const specs = readdirSync(join(corpus, "specs"));
  assert.equal(specs.length, 42, "the reader fixture still lists all 42 features");
  const live = specs.find((feature) => feature === "corpus-f00");
  assert.ok(live, "corpus-f00 is the feature with the live run");

  // The reader view itself still holds all 42 features: one card per phase of
  // every feature (the fixture's 250 approved phases + the live lane).
  const h = harness({
    reader: () =>
      readerViewOf({
        runId: "run-c00",
        cards: [
          ...specs.filter((feature) => feature !== live).flatMap((feature) => [{ id: `${feature}#queued`, lane: "queued", rule: "W0", ruleId: "W-queued" }]),
          { id: "corpus-f00#1", lane: "proposing", rule: "W1", ruleId: "W-proposing" },
        ],
        features: { "corpus-f00": { run: { id: "run-c00", state: "running", phase: 1, lastAt: null } } },
      }),
  });
  try {
    const result = await syncOnce("/ws", h.deps);
    assert.equal(result.kind, "view");
    const keys = h.executed.map((call) => call.key);
    const creates = h.executed.filter((call) => call.verb === "create").map((call) => call.key);
    // Only the feature with the run is on the native board (F151-FR-041).
    assert.ok(creates.includes("specstride:run-c00"), "the root card of the live feature is created");
    assert.ok(creates.includes("specstride:run-c00:corpus-f00#1"), "the live stage card is created");
    for (const key of creates) {
      assert.ok(key.startsWith("specstride:run-c00"), `no create names a never-run feature: ${key}`);
      assert.ok(!key.includes("#queued"), `no create names a never-run feature (W0): ${key}`);
    }
    assert.ok(!keys.some((key) => key.includes("corpus-f01")), "no card of a never-run feature is projected");
  } finally {
    h.cleanup();
  }
});

test("a relaunch archives every card of the old run and creates the new run's in one cycle (T031)", async () => {
  const fixture = join(ROOT, "tests/fixtures/workspaces/relaunch");
  assert.ok(readdirSync(join(fixture, "specs")).length > 0, "the relaunch fixture exists");
  const h = harness({ reader: () => readerViewOf({ runId: "run-first" }) });
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    // The relaunch fixture moves to its second state: a new run speaks.
    const second = readerViewOf({
      runId: "run-second",
      cards: [{ id: "151-hermes-kanban#1", lane: "proposing", rule: "W1", ruleId: "W-proposing", title: "Projection" }],
      features: { "151-hermes-kanban": { run: { id: "run-second", state: "running", phase: 1, lastAt: null } } },
    });
    const result = await syncOnce("/ws", { ...h.deps, reader: () => second, memo: new Map() });
    assert.equal(result.kind, "view");
    const verbs = h.executed;
    assert.deepEqual(
      verbs.filter((call) => call.verb === "archive").map((call) => call.key),
      ["specstride:run-first", "specstride:run-first:151-hermes-kanban#1"],
    );
    assert.deepEqual(
      verbs.filter((call) => call.verb === "create").map((call) => call.key),
      ["specstride:run-second", "specstride:run-second:151-hermes-kanban#1"],
    );
    // No cycle shows live cards of both runs.
    const store = new ProjectionStore(h.hermesHome);
    const record = store.load(workspaceKey("/ws"));
    assert.ok(record.cards.every((card) => card.key.startsWith("specstride:run-second")), JSON.stringify(record.cards.map((c) => c.key)));
    assert.equal(record.source, "workspace-reader");
  } finally {
    h.cleanup();
  }
});

test("a store's cards record the view source per card (T031)", async () => {
  const h = harness({ reader: () => readerViewOf({ runId: "run-src" }) });
  try {
    await syncOnce("/ws", h.deps);
    const store = new ProjectionStore(h.hermesHome);
    const record = store.load(workspaceKey("/ws"));
    assert.ok(record.cards.length > 0);
    for (const card of record.cards) assert.equal(card.source, "workspace-reader", card.key);
    // From an engine view no body holds a source line (checked at the store too).
    const h2 = harness({ engine: () => ({ kind: "view", view: JSON.parse(readFileSync(join(ROOT, "tests/fixtures/run-views/every-lane.json"), "utf8")) as Record<string, unknown> }) });
    try {
      await syncOnce("/ws-engine", h2.deps);
      const record2 = new ProjectionStore(h2.hermesHome).load(workspaceKey("/ws-engine"));
      assert.equal(record2.source, "engine");
      for (const card of record2.cards) {
        assert.ok(!card.body.includes("source:"), card.key);
        assert.equal(card.source, "engine", card.key);
      }
    } finally {
      h2.cleanup();
    }
  } finally {
    h.cleanup();
  }
});

test("a failed hermes call sets stale in the store and never a partial store (T029)", async () => {
  mkdirSync(join(tmpdir(), "sync-fail-"), { recursive: true });
  const hermesHome = mkdtempSync(join(tmpdir(), "sync-fail-"));
  let first = true;
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    engine: async () => ({ kind: "unavailable", reason: "engine exit 70" }),
    reader: () => readerViewOf({ runId: "run-x" }),
    readBack: false,
    exec: async () => (first ? { exit: 0, stdout: JSON.stringify({ id: "h1" }) } : { exit: 3, stdout: "", stderr: "boom" }),
    log: () => {},
  };
  try {
    const ok = await syncOnce("/ws", deps);
    assert.equal(ok.ok, true);
    first = false;
    const failed = await syncOnce("/ws", { ...deps, reader: () => readerViewOf({ runId: "run-x", lastAt: "2026-11-11T14:00:00.000Z" }), memo: new Map() });
    assert.equal(failed.ok, false);
    const record = new ProjectionStore(hermesHome).load(workspaceKey("/ws"));
    assert.equal(record.stale, true);
    // The store is whole: the previous complete state is still there.
    assert.equal(record.cards.length, 2);
    assert.equal(record.lastGoodAt !== null, true);
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
  }
});
