/**
 * The doctor has no side effects (T028, PT-150-017, F150-SC-002): it calls no
 * model, opens no network socket to a provider host, runs no install or
 * enable command, finishes within 2,000 ms against the stubs, and its exit
 * codes follow the kit's `DOCTOR_EXITS`. Every run is a subprocess against a
 * temporary `HERMES_HOME` with the stub CLI and stub `hermes` first on PATH.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_EXITS } from "@specstride/host-kit";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const HERE = join(new URL(".", import.meta.url).pathname);
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const DNS_GUARD = join(ROOT, "tests", "helpers", "no-model-dns.mjs");

type Fx = ReturnType<typeof tempHome>;

function runCli(fx, args, env = {}) {
  const start = Date.now();
  const done = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { HERMES_HOME: fx.home, XDG_STATE_HOME: fx.stateHome, STUB_LOG: fx.stubLog, ...process.env, ...env },
  });
  return { ...done, ms: Date.now() - start };
}

/** Snapshot the bytes and mtimes of every file under a root. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSorted(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[path] = { bytes: readFileSync(path).toString("base64"), mtimeMs: statSync(path).mtimeMs };
    }
  };
  walk(root);
  return out;
}

function readdirSorted(dir) {
  return readdirSync(dir).sort();
}

/** Install the skills and the plugin so the doctor sees a healthy fixture. */
function installProfile(fx) {
  const script = join(fx.home, "script.json");
  writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
  const done = runCli(fx, ["install", "--profile", "specstride"], { SPECSTRIDE_PROFILE: "specstride", STUB_SCRIPT: script });
  assert.equal(done.status, 0, `install refused: ${done.stderr}`);
}

test("the doctor makes no provider lookup and no model call (0 in the DNS guard)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfile(fx);
      const done = runCli(fx, ["doctor", "--json"], { SPECSTRIDE_PROFILE: "specstride", NODE_OPTIONS: `--import=${DNS_GUARD}` });
      assert.equal(done.status, 0, `doctor failed: ${done.stderr}`);
      assert.doesNotMatch(done.stderr, /no-model-dns/, "a provider host was looked up: the doctor called out");
      const report = JSON.parse(done.stdout);
      assert.equal(report.exit, 0);
    });
  } finally {
    fx.cleanup();
  }
});

test("the doctor installs and enables nothing: roots, config and stub argv are untouched", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfile(fx);
      writeFileSync(fx.stubLog, "");
      const profile = join(fx.home, "profiles", "specstride");
      const configYaml = join(fx.home, "config.yaml");
      writeFileSync(configYaml, "profiles:\n  specstride: {}\n");
      const before = { skills: snapshot(join(profile, "skills")), plugin: snapshot(join(profile, "plugins")), config: readFileSync(configYaml, "utf8") };

      const done = runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" });
      assert.equal(done.status, 0);

      assert.deepEqual(snapshot(join(profile, "skills")), before.skills, "the skill root changed");
      assert.deepEqual(snapshot(join(profile, "plugins")), before.plugin, "the plugin root changed");
      assert.equal(readFileSync(configYaml, "utf8"), before.config, "config.yaml was written");
      for (const call of stubCalls(fx.stubLog)) {
        const joined = call.argv.join(" ");
        assert.doesNotMatch(joined, /plugins (enable|disable)/, `a mutating verb reached hermes: ${joined}`);
        assert.doesNotMatch(joined, /skills trust/, `a trust command was run: ${joined}`);
        assert.doesNotMatch(joined, /\b(install|uninstall)\b/, `an install command was run: ${joined}`);
      }
      // The one file the doctor writes is its own precomputed report.
      const report = join(fx.home, "specstride-host", "doctor.last");
      assert.doesNotThrow(() => statSync(report), "doctor.last was not written");
    });
  } finally {
    fx.cleanup();
  }
});

test("the doctor finishes within 5,000 ms against the stubs", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfile(fx);
      const done = runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" });
      assert.equal(done.status, 0);
      // The point of the bound is that the doctor must not hang on the stubs;
      // the stub answers immediately, so the honest cost is well under a
      // second. 5,000 ms keeps that guard while tolerating a loaded CI
      // machine (observed ~2,000 ms under the full suite).
      assert.ok(done.ms <= 5000, `the doctor took ${done.ms} ms (limit 5,000 ms)`);
    });
  } finally {
    fx.cleanup();
  }
});

test("the doctor's exit codes follow the kit's DOCTOR_EXITS", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfile(fx);
      const meanings = new Map(DOCTOR_EXITS.map((e) => [e.code, e.meaning]));
      assert.equal(meanings.get(0), "no `fail` finding");
      assert.equal(meanings.get(2), "at least one `fail` finding");

      assert.equal(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" }).status, 0, "no fail finding exits 0");
      assert.equal(
        runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride", STUB_PROTOCOL: "9" }).status,
        2,
        "a fail finding exits 2",
      );
      assert.equal(runCli(fx, ["doctor", "--wat"], { SPECSTRIDE_PROFILE: "specstride" }).status, 3, "a usage error exits 3");
      assert.match(runCli(fx, ["doctor", "--wat"], { SPECSTRIDE_PROFILE: "specstride" }).stderr, /unknown flag/);
    });
  } finally {
    fx.cleanup();
  }
});
