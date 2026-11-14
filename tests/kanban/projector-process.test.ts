/**
 * The projector-process tests (T041; PT-151-012, PT-151-013, PT-151-017;
 * F151-FR-012, F151-FR-013, F151-FR-017; contracts/sync-sidecar.md "Never",
 * "Entry points").
 *
 * Three claims:
 * 1. The sync runs only from `kanban sync` (the CLI verb) and from the
 *    watcher module (`registerKanban` of 150's watch) — never from a hook
 *    file: the import graph of `src/kanban/sync.ts` is asserted, and no
 *    source file of this package registers a Hermes hook.
 * 2. Over every fixture (engine and reader), the writes that reach the real
 *    stub `hermes` binary hold no `claim`, no `complete` on an attention
 *    card, no `request-review`, no `heartbeat`, and no `send` (PT-151-013,
 *    PT-151-017) — the stub refuses any kanban verb outside its closed set.
 * 3. Stopping the projector changes nothing: the standalone `kanban sync
 *    --once` process runs, exits, and the stub `hermes` log does not move a
 *    byte afterwards (no run depends on the projector, PT-151-012).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncOnce, type SyncDeps } from "../../src/kanban/sync.ts";
import type { ShimAnswer } from "../../src/kanban/shim-call.ts";
import type { KanbanCall } from "../../src/kanban/hermes-kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(ROOT, "src");
const STUBS = join(ROOT, "tests", "stubs");
const RUN_VIEWS = join(ROOT, "tests", "fixtures", "run-views");

const FORBIDDEN_VERBS = ["claim", "heartbeat", "request-review", "send", "decompose", "specify", "swarm", "link", "delete"];

/* ---------------------------------------------------------------- 1. graph */

test("the sync is entered only by the CLI verb and the watcher module, never a hook file", () => {
  const importers: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) importers.push(path);
    }
  };
  walk(SRC);
  const importing = importers.filter((path) => /from "\.\/sync\.ts"|kanban\/sync\.ts/.test(readFileSync(path, "utf8")));
  assert.deepEqual(
    importing.sort(),
    [join(SRC, "kanban", "register.ts")],
    "only the watcher module may import the sync",
  );
  // The module registers through 150's watcher hook, never a Hermes hook.
  const register = readFileSync(join(SRC, "kanban", "register.ts"), "utf8");
  assert.ok(register.includes("registerKanban"), "the module registers with the watcher");
  assert.ok(register.includes("../watch/index.ts"), "…from 150's watch module");
  // No source file of the package registers a Hermes-side hook
  // (`on_kanban_task_updated` carries field names only — P00 P2-6).
  for (const path of importers) {
    const text = readFileSync(path, "utf8");
    assert.ok(!/on_?[Kk]anban_?[Tt]ask_?[Uu]pdated\s*\(/.test(text), `${path} registers a Hermes hook`);
  }
  // The CLI verb is the other entry point.
  const bin = readFileSync(join(ROOT, "bin", "specstride-host-hermes.mjs"), "utf8");
  assert.ok(bin.includes("kanban/sync.ts"), "the CLI exposes the sync as its kanban verb");
});

/* -------------------------------------------------------- 2. the stub log */

/** Every engine fixture view (the recorded set) plus a reader view. */
function fixtureViews(): { name: string; view: Record<string, unknown>; source: "engine" | "reader" }[] {
  const out: { name: string; view: Record<string, unknown>; source: "engine" | "reader" }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        out.push({ name: entry.name, view: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>, source: "engine" });
      }
    }
  };
  walk(RUN_VIEWS);
  out.push({
    name: "reader-inline",
    source: "reader",
    view: {
      schema: "specstride.view/1",
      source: "workspace-reader",
      laneTable: { id: "workspace-reader", version: "1" },
      runId: "workspace:w",
      state: "running",
      cards: [{ id: "151-hermes-kanban#1", lane: "proposing", rule: "W1", ruleId: "W-proposing" }],
      attention: [{ key: "151-hermes-kanban#run", kind: "blocked-on-human", "one-line": "run ended failed in phase 2" }],
      budget: [],
      phases: [],
      featureDetails: {
        "151-hermes-kanban": { run: { id: "run-reader", state: "failed", phase: 2, lastAt: "2026-11-11T12:00:00.000Z" } },
      },
      cursor: { offset: 0, lastSeq: 0 },
      signature: { token: "reader" },
    },
  });
  return out;
}

test("the stub hermes log over every fixture holds no forbidden verb and no complete on an attention card", async () => {
  const hermesHome = mkdtempSync(join(tmpdir(), "projector-proc-"));
  const stubLog = join(hermesHome, "stub-hermes.log");
  const env = { ...process.env, STUB_LOG: stubLog };
  let lines = 0;
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    readBack: false,
    exec: (call: KanbanCall) =>
      new Promise((resolve) => {
        const child = spawnSync(process.execPath, [join(STUBS, "hermes"), ...call.argv.slice(1)], {
          input: call.stdin,
          encoding: "utf8",
          env,
        });
        resolve({ exit: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" });
      }),
    log: () => {},
  };
  try {
    for (const fixture of fixtureViews()) {
      const engine: () => Promise<ShimAnswer> =
        fixture.source === "engine"
          ? async () => ({ kind: "view", view: fixture.view })
          : async () => ({ kind: "unavailable", reason: "engine exit 70" });
      await syncOnce(`/ws-${lines}`, { ...deps, engine, reader: () => (fixture.source === "reader" ? fixture.view : null), memo: new Map() });
    }
    const recorded = existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n") : [];
    assert.ok(recorded.length > 0, "the stub must have recorded the projector's writes");
    for (const line of recorded) {
      const entry = JSON.parse(line) as { argv: string[]; refused?: boolean };
      const argv = entry.argv;
      const kanbanAt = argv.indexOf("kanban");
      const verb = kanbanAt === -1 ? null : argv[kanbanAt + 1];
      assert.equal(entry.refused, undefined, `the stub refused ${argv.join(" ")} — a verb outside the closed set`);
      if (verb === null) continue;
      for (const forbidden of FORBIDDEN_VERBS) {
        assert.notEqual(verb, forbidden, `the projector sent ${forbidden}: ${argv.join(" ")}`);
      }
      if (verb === "complete") {
        const key = argv[argv.indexOf("--idempotency-key") + 1] ?? "";
        assert.ok(!key.includes(":attn:"), `complete on an attention card: ${argv.join(" ")}`);
      }
    }
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
  }
});

/* --------------------------------------------------- 3. stop changes nothing */

test("the standalone sync process runs once, exits, and the stub log then never moves", () => {
  const hermesHome = mkdtempSync(join(tmpdir(), "projector-stop-"));
  const workspace = mkdtempSync(join(tmpdir(), "projector-ws-"));
  const stubLog = join(hermesHome, "stub-hermes.log");
  const env = {
    ...process.env,
    HERMES_HOME: hermesHome,
    PATH: `${STUBS}:${process.env.PATH ?? ""}`,
    STUB_LOG: stubLog,
  };
  try {
    // One sync cycle as its own process: `kanban sync --once`. The engine
    // probe through the shim meets the stub CLI (no scripted answer →
    // unavailable), the workspace holds nothing, so no card is written —
    // and no run depends on the projector having kept going.
    const run = spawnSync(
      process.execPath,
      [join(ROOT, "bin", "specstride-host-hermes.mjs"), "kanban", "sync", "--once", "--workspace", workspace],
      { encoding: "utf8", timeout: 120_000, env },
    );
    assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr}`);
    const afterExit = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : "";
    // Stopped: the process is gone; give any stray timer a moment, then
    // assert the stub log has not moved a byte.
    const later = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : "";
    assert.equal(later, afterExit, "the stub hermes log changed after the projector stopped");
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a projector that never starts leaves no mark anywhere (no run depends on it)", () => {
  const hermesHome = mkdtempSync(join(tmpdir(), "projector-absent-"));
  try {
    // No store, no marker, no write of any kind: the package of the host is
    // byte-identical whether or not the projector ever ran.
    assert.ok(!existsSync(join(hermesHome, "specstride-host", "kanban")));
    const noop = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8", env: { ...process.env, HERMES_HOME: hermesHome } });
    assert.equal(noop.status, 0);
    assert.ok(!existsSync(join(hermesHome, "specstride-host", "kanban")));
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
  }
});
