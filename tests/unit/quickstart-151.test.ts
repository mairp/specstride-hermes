/**
 * The quickstart step 1–3 recording test (T082; specs/151-hermes-kanban/
 * quickstart.md steps 1–3; evals/quickstart-151-metrics.md). Everything here
 * is offline: no model call, no network, no provider hostname; the only
 * Hermes binary it may meet is the recorded stub of tests/stubs (or a
 * version detection spawn of `hermes --version`).
 *
 * - Step 3 ("Not dispatchable"): the pinned Hermes 0.22.2 is detected exactly
 *   the way tests/live/dispatcher.live.test.ts does. Without it, the live
 *   lane's own SKIP_REASON semantics are asserted (a skip reason must exist;
 *   the lane never reports `passed` without Hermes — Principle XVII,
 *   F151-FR-032) and the lane file is run once to OBSERVE the `skipped`
 *   outcome. With the pinned Hermes present, `available` is recorded and the
 *   long lane is left alone.
 * - Step 2 (model-free projection check), offline against the committed
 *   fixture workspace `tests/fixtures/workspaces/feature-150` through the
 *   REAL sync sidecar process (`bin/specstride-host-hermes.mjs kanban sync
 *   --once`) with the stub binaries first on PATH: cards keyed correctly,
 *   `source: workspace-reader` in every body while the engine view is empty,
 *   0 kanban writes on a second `--once`, and `absent`/`no-run` (no card, no
 *   store) for a directory without Specstride state.
 * - Steps 4–9 and the live probe are person-run and NOT run here; the claim
 *   is asserted over the recorded measurement file
 *   `evals/quickstart-151-metrics.md` (Deliverable B of T082).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUBS = join(ROOT, "tests", "stubs");
const HOST_CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const LIVE_LANE = join(ROOT, "tests", "live", "dispatcher.live.test.ts");
const METRICS = join(ROOT, "evals", "quickstart-151-metrics.md");
const PINNED_VERSION = "0.22.2";

/** Detect `hermes --version` exactly as tests/live/dispatcher.live.test.ts does. */
function hermesVersion(bin = "hermes"): { version: string; raw: string } | null {
  const run = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (run.status !== 0 && (run.stdout ?? "") === "") return null;
  const raw = (run.stdout ?? "") + (run.stderr ?? "");
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match === null ? null : { version: match[1], raw: raw.trim() };
}

const version = hermesVersion();
const SKIP_REASON =
  version === null
    ? "hermes is not on PATH"
    : version.version !== PINNED_VERSION
      ? `unpinned hermes version ${version.version} != ${PINNED_VERSION}`
      : undefined;

interface SyncRun {
  status: number;
  stdout: string;
  stderr: string;
  kanbanVerbs: number;
}

/** One `kanban sync --once` as its own process, stubs first on PATH. */
function runSync(workspace: string, home: string, stubLog: string): SyncRun {
  const run = spawnSync(
    process.execPath,
    [HOST_CLI, "kanban", "sync", "--once", "--workspace", workspace],
    {
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${STUBS}:${process.env.PATH ?? ""}`,
        SPECSTRIDE_BIN: join(STUBS, "specstride"),
        STUB_LOG: stubLog,
        HERMES_HOME: home,
        XDG_STATE_HOME: join(home, "..", "state"),
      },
    },
  );
  const before = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : "";
  const kanbanVerbs = before
    .split("\n")
    .filter((line) => line.includes('"kanban"'))
    .length;
  return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "", kanbanVerbs };
}

/** The projection store file of a workspace under a temporary HERMES_HOME. */
function storeFile(home: string): { path: string; json: Record<string, unknown> } | null {
  const dir = join(home, "specstride-host", "kanban");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length !== 1) return null;
  const path = join(dir, files[0] ?? "");
  return { path, json: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
}

/* ---------------------------------------------- step 3: not dispatchable --- */

test("quickstart step 3: the dispatcher lane declares skipped semantics without Hermes 0.22.2 and is left alone with it", () => {
  const source = readFileSync(LIVE_LANE, "utf8");
  // The lane's own declaration: the skip is a value on the test options, and
  // the header pins "skipped — never passed" (Principle XVII).
  assert.match(source, /skip: SKIP_REASON/, "the live lane must gate itself on SKIP_REASON");
  assert.match(source, /PINNED_VERSION = "0\.22\.2"/, "the live lane must pin 0.22.2");
  assert.match(source, /The lane is `skipped` — never `passed`/, "the lane header must declare skipped-never-passed");

  if (SKIP_REASON !== undefined) {
    // Without the pinned Hermes: the reason is a value, and the lane file,
    // run as the quickstart documents, reports skipped with 0 failures.
    assert.ok(SKIP_REASON.length > 0, "an absent or unpinned Hermes must give a skip reason");
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", LIVE_LANE], {
      encoding: "utf8",
      timeout: 180_000,
      cwd: ROOT,
    });
    const out = (run.stdout ?? "") + (run.stderr ?? "");
    assert.match(out, /# (tests|pass) /, `the live lane must run as a node:test file:\n${out.slice(0, 500)}`);
    assert.match(out, /# fail 0/, `the live lane must not fail without Hermes:\n${out.slice(0, 500)}`);
    assert.match(out, /# skipped [1-9]/, `the lane must be skipped without the pinned Hermes:\n${out.slice(0, 500)}`);
  } else {
    // With the pinned Hermes the lane would run its ~300 dispatch ticks; the
    // quickstart records `available` and this test leaves it alone.
    assert.equal(version?.version, PINNED_VERSION);
    assert.ok(version !== null && version.raw.includes(PINNED_VERSION), `pinned hermes detected: ${version?.raw}`);
  }
});

/* ---------------------------------------- step 2: the projection check ---- */

test("quickstart step 2, offline: sync --once over the feature-150 fixture keys the cards and marks every body workspace-reader", () => {
  const base = mkdtempSync(join(tmpdir(), "quickstart-151-"));
  const home = join(base, "hermes-home");
  mkdirSync(home, { recursive: true });
  const stubLog = join(base, "stub-log.jsonl");
  const workspace = join(ROOT, "tests", "fixtures", "workspaces", "feature-150");
  try {
    chmodSync(join(STUBS, "hermes"), 0o755);
    chmodSync(join(STUBS, "specstride"), 0o755);

    const first = runSync(workspace, home, stubLog);
    assert.equal(first.status, 0, `exit ${first.status}: ${first.stderr}`);
    const store = storeFile(home);
    assert.ok(store !== null, "the first cycle must write a projection store");
    const cards = (store.json["cards"] ?? []) as Record<string, unknown>[];
    assert.ok(cards.length > 0, "the run of feature-150 must project at least one card");

    // One root card, keyed `specstride:<run-id>`.
    const roots = cards.filter((card) => card["role"] === "root");
    assert.equal(roots.length, 1, "exactly one root card for the run");
    assert.match(String(roots[0]?.["key"]), /^specstride:run-/);
    assert.match(String(roots[0]?.["title"]), /150-host-hermes · run-/);

    // One stage card per phase of the feature.
    const stages = cards.filter((card) => card["role"] === "stage");
    assert.ok(stages.length >= 1, "stage cards per phase");
    for (const stage of stages) assert.match(String(stage["key"]), /^specstride:run-.*:150-host-hermes#/);

    // While the engine view is empty (U-151-01) every body holds the line.
    for (const card of cards) assert.ok(String(card["body"]).includes("source: workspace-reader"), String(card["key"]));

    // A second `--once`: 0 writes — no kanban verb, byte-equal store.
    const storedText = readFileSync(store.path, "utf8");
    const second = runSync(workspace, home, stubLog);
    assert.equal(second.status, 0, `exit ${second.status}: ${second.stderr}`);
    assert.equal(
      second.kanbanVerbs - first.kanbanVerbs,
      0,
      `the second --once must print 0 writes (made ${second.kanbanVerbs - first.kanbanVerbs})`,
    );
    assert.equal(readFileSync(store.path, "utf8"), storedText, "an unchanged view must not rewrite the store");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("quickstart step 2, offline: a directory without Specstride state answers absent/no-run and writes no card", () => {
  const base = mkdtempSync(join(tmpdir(), "quickstart-151-absent-"));
  const home = join(base, "hermes-home");
  const workspace = join(base, "workspace");
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const stubLog = join(base, "stub-log.jsonl");
  try {
    chmodSync(join(STUBS, "hermes"), 0o755);
    chmodSync(join(STUBS, "specstride"), 0o755);
    const run = runSync(workspace, home, stubLog);
    assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr}`);
    assert.equal(run.kanbanVerbs, 0, "no card may be written for a workspace without state");
    assert.equal(storeFile(home), null, "no projection store entry for a workspace without state");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/* -------------------------- steps 4–9 and the live probe: person-run ------ */

test("steps 4 to 9 and the live probe are recorded person-run and NOT run by this task", () => {
  const recorded = readFileSync(METRICS, "utf8");
  assert.match(
    recorded,
    /Quickstart steps 4 to 9 and the live probe — person-run, NOT run by this task/,
    "the metrics file must carry the person-run section",
  );
  for (const step of ["Step 4", "Step 5", "Step 6", "Step 7", "Step 8", "Step 9"]) {
    assert.ok(recorded.includes(step), `the metrics file must record ${step} as person-run`);
  }
  assert.ok(recorded.includes("Live probe (person-started)"));
  // The per-change equivalents the section names must exist.
  for (const cited of [
    "tests/kanban/restore.test.ts",
    "tests/kanban/reader/pick-run.test.ts",
    "tests/kanban/reader/ended.test.ts",
    "tests/kanban/sync.test.ts",
    "tests/tab/window.test.ts",
    "tests/kanban/reader/detail.test.ts",
    "tests/tab/detail-tree.test.ts",
    "tests/tab/actions.test.ts",
    "tests/live/dispatcher.live.test.ts",
  ]) {
    assert.ok(existsSync(join(ROOT, cited)), `${cited} must exist`);
    assert.ok(recorded.includes(cited), `${cited} must be cited in the metrics file`);
  }
});
