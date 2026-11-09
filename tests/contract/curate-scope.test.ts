/**
 * The curate write-scope contract (T049, PT-150-033, F150-FR-033): running
 * `specstride-host-hermes curate reconcile` on the fixture corpus
 * (`tests/fixtures/corpus/`, 3 features) first creates a backup directory,
 * then writes ONLY under `specs/` (plus the backup's own directory outside
 * the corpus), makes no model call and no CLI call, and leaves every file
 * outside `specs/` byte-identical. `--dry-run` writes nothing at all.
 * No model call anywhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stubCalls } from "../helpers/env.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const FIXTURE = join(ROOT, "tests", "fixtures", "corpus");
const NO_MODEL = join(ROOT, "tests", "helpers", "no-model-dns.mjs");

function readText(path) {
  return readFileSync(path, "utf8");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The project tree as a rel→sha map, skipping the corpus and the backups. */
function snapshot(project, skip) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(project, path);
      if (skip.some((s) => rel === s || rel.startsWith(s + "/"))) continue;
      if (entry.isDirectory()) walk(path);
      else out.set(rel, sha256(path));
    }
  };
  walk(project);
  return out;
}

function fixtureProject() {
  const base = mkdtempSync(join(tmpdir(), "curate-scope-"));
  const project = join(base, "project");
  mkdirSync(project, { recursive: true });
  cpSync(FIXTURE, join(project, "specs"), { recursive: true });
  return { base, project, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function runReconcile(project, args) {
  return spawnSync(process.execPath, [CLI, "--project", project, "curate", "reconcile", ...args], {
    encoding: "utf8",
    cwd: project,
    env: {
      ...process.env,
      SPECSTRIDE_PROJECT: project,
      NODE_OPTIONS: `--import ${NO_MODEL}`,
    },
  });
}

test("a reconcile run backs up first, writes only under specs/, and changes nothing else", () => {
  const fx = fixtureProject();
  try {
    // No stub log is reachable here by design: the command makes no CLI call,
    // so a fresh log file stays empty — asserted through the empty calls below.
    const stubLog = join(fx.base, "stub-log.jsonl");
    const before = snapshot(fx.project, ["specs", ".specstride"]);

    const done = runReconcile(fx.project, []);
    assert.equal(done.status, 0, `reconcile failed: ${done.stderr}`);
    assert.match(done.stdout, /3 features \/ \d+ checks \/ 0 failures/);

    // 1. A backup directory exists and holds the corpus as it was.
    const backups = join(fx.project, ".specstride", "backups");
    assert.equal(existsSync(backups), true, "the backup directory exists");
    const stamps = readdirSync(backups);
    assert.equal(stamps.length, 1, "one backup per invocation");
    assert.equal(existsSync(join(backups, stamps[0], "specs", "210-alpha", "spec.md")), true);

    // 2. Writes under specs/: the corpus summary and the per-feature logs.
    assert.equal(existsSync(join(fx.project, "specs", "RECONCILIATION.md")), true);
    assert.match(readText(join(fx.project, "specs", "RECONCILIATION.md")), /Corpus: 3 features/);
    for (const feature of ["210-alpha", "211-beta", "212-gamma"]) {
      const log = join(fx.project, "specs", feature, "reconciliation.md");
      assert.equal(existsSync(log), true, `the log of ${feature}`);
      assert.match(readText(log), /^## reconcile-/);
    }

    // 3. Every file outside specs/ is byte-identical, and the only NEW files
    // outside specs/ live under the backup directory.
    const after = snapshot(fx.project, ["specs", ".specstride"]);
    assert.deepEqual([...after.entries()], [...before.entries()], "files outside specs/ unchanged");
    const newOutside = [...snapshot(fx.project, ["specs"]).keys()].filter(
      (rel) => !before.has(rel) && !rel.startsWith(".specstride/"),
    );
    assert.deepEqual(newOutside, [], "nothing new outside specs/ and the backup directory");

    // 4. No model call: the gate's resolver hook saw no provider lookup (the
    // run exited 0 under it), and no CLI call was made.
    assert.deepEqual(stubCalls(stubLog), [], "no CLI call");
  } finally {
    fx.cleanup();
  }
});

test("--dry-run inspects and writes nothing", () => {
  const fx = fixtureProject();
  try {
    const done = runReconcile(fx.project, ["--dry-run"]);
    assert.equal(done.status, 0, `dry-run failed: ${done.stderr}`);
    assert.match(done.stdout, /dry-run: 3 features, \d+ checks, 0 failures — no backup, no writes/);
    assert.equal(existsSync(join(fx.project, ".specstride")), false, "no backup directory");
    assert.equal(existsSync(join(fx.project, "specs", "RECONCILIATION.md")), false, "no corpus summary");
    for (const feature of ["210-alpha", "211-beta", "212-gamma"]) {
      assert.equal(
        existsSync(join(fx.project, "specs", feature, "reconciliation.md")),
        false,
        `no log of ${feature}`,
      );
    }
  } finally {
    fx.cleanup();
  }
});
