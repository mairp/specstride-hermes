/**
 * The installer's kanban tests (T039; PT-151-012, PT-151-029). Without
 * `--with-kanban` none of the module files is installed and 150's gate
 * passes unchanged; with it the module lands under
 * `<HERMES_HOME>/specstride-host/kanban/module`, the watcher loads it
 * (the hook registers), and a module of another version is refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempHome, withStubs } from "../helpers/env.ts";
import { run as installerRun } from "../../src/installer.ts";
import { kanbanModuleDir, kanbanModuleMarker, kanbanModuleInstalled, registerInstalledKanban } from "../../src/kanban/register.ts";
import { kanbanHookIsSet } from "../../src/watch/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUBS = join(ROOT, "tests", "stubs");

function moduleFiles(home: string): string[] {
  const dir = kanbanModuleDir(home);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(abs);
    }
  };
  walk(dir);
  return out;
}

test("without --with-kanban no kanban module is installed and 150's gate passes (T039)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = installerRun(["install", "--user"]);
      assert.equal(result.exit, 0, result.stderr);
      assert.deepEqual(moduleFiles(fx.home), [], "no kanban module file is installed");
      assert.equal(existsSync(kanbanModuleMarker(fx.home)), false);
      assert.equal(kanbanModuleInstalled(fx.home), false);
      assert.equal(registerInstalledKanban(fx.home), false, "nothing registers without the module");
      assert.equal(kanbanHookIsSet(), false, "the watcher carries no kanban hook");
      // 150's gate: the cli-spawn scan of the built tree finds no violation.
      const scan = spawnSync(process.execPath, ["--experimental-strip-types", "-e", `
        import { checkCliSpawnScan } from ${JSON.stringify(join(ROOT, "src/gates.ts"))};
        const findings = checkCliSpawnScan(${JSON.stringify(ROOT)});
        const kanban = findings.filter((f) => String(f).toLowerCase().includes("kanban"));
        console.log(JSON.stringify(kanban));
      `], { encoding: "utf8" });
      assert.equal(scan.status, 0, scan.stderr);
      assert.deepEqual(JSON.parse(scan.stdout.trim() || "[]"), []);
    });
  } finally {
    fx.cleanup();
  }
});

test("with --with-kanban the module is installed and the watcher loads it (T039)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = installerRun(["install", "--user", "--with-kanban"]);
      assert.equal(result.exit, 0, result.stderr);
      const files = moduleFiles(fx.home);
      assert.ok(files.length > 0, "the module files are installed");
      assert.ok(files.some((f) => f.endsWith(join("src/kanban", "sync.ts"))), "src/kanban is installed");
      const markerPath = kanbanModuleMarker(fx.home);
      assert.equal(existsSync(markerPath), true);
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { schema: string; version: string };
      assert.equal(marker.schema, "specstride.kanban-module/1");
      assert.ok(/^\d+\.\d+\.\d+/.test(marker.version), `the marker records the package version: ${marker.version}`);
      assert.equal(kanbanModuleInstalled(fx.home), true);
      // The watcher loads the module: the hook registers and the sync runs.
      assert.equal(registerInstalledKanban(fx.home), true);
      assert.equal(kanbanHookIsSet(), true);
    });
  } finally {
    fx.cleanup();
  }
});

test("a kanban module of another version is refused (T039)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      // A module of another package version is already in place.
      const moduleDir = kanbanModuleDir(fx.home);
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(join(moduleDir, "kanban.json"), JSON.stringify({ schema: "specstride.kanban-module/1", version: "0.0.0-other", files: [{ path: "src/kanban/sync.ts", sha256: "x" }] }));
      const result = installerRun(["install", "--user", "--with-kanban"]);
      assert.equal(result.exit, 1);
      assert.match(result.stderr, /refuse .*kanban module/);
      assert.match(result.stderr, /0\.0\.0-other/);
      rmSync(moduleDir, { recursive: true, force: true });
    });
  } finally {
    fx.cleanup();
  }
});

test("the CLI wires `kanban sync` (T038)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      // Usage: an unknown flag exits 3 with the sync usage line.
      const bad = spawnSync(process.execPath, [join(ROOT, "bin", "specstride-host-hermes.mjs"), "kanban", "sync", "--bogus"], {
        encoding: "utf8",
        env: { ...process.env, HERMES_HOME: fx.home },
      });
      assert.equal(bad.status, 3);
      assert.match(bad.stderr, /kanban sync \[--once\] \[--workspace <dir>\]/);
      // One real cycle over an empty watch list: exit 0, nothing written.
      const once = spawnSync(process.execPath, [join(ROOT, "bin", "specstride-host-hermes.mjs"), "kanban", "sync", "--once"], {
        encoding: "utf8",
        env: { ...process.env, HERMES_HOME: fx.home },
      });
      assert.equal(once.status, 0, once.stderr);
    });
  } finally {
    fx.cleanup();
  }
});
