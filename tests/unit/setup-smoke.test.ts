/**
 * The setup-phase smoke test of the Hermes host (T001–T009): the pinned core
 * installs and serves the host port, the shim core renders, and the fixture
 * environment — temporary `HERMES_HOME`, the stub CLI and the stub `hermes` —
 * records the argv a host component sends. The later phases build on this
 * harness, so it must hold before any of them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_PROTOCOL_VERSION } from "@specstride/host-kit";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8"));

test("the pin digests the vendored bytes and the pinned packages install", () => {
  assert.match(pin.coreCommit, /^[0-9a-f]{40}$/);
  for (const row of pin.packages) {
    const digest = createHash("sha256")
      .update(readFileSync(join(ROOT, "vendor", "core", row.file)))
      .digest("hex");
    assert.equal(digest, row.sha256, `${row.file} matches the pin`);
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "node_modules", ...row.name.split("/"), "package.json"), "utf8"),
    );
    assert.equal(manifest.version, row.version, `${row.name} at the pinned version`);
  }
});

test("the engine protocol integer is the one this package declares", () => {
  assert.equal(CLI_PROTOCOL_VERSION, 1);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.specstride.protocol, { min: 1, max: 1 });
  assert.equal(pkg.specstride.engineVersion, pin.version);
});

test("the stub CLI records argv, answers --protocol and refuses reverse", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, (fx) => {
      const specstride = join(ROOT, "tests", "stubs", "specstride");
      chmodSync(specstride, 0o755);
      const out = execFileSync(specstride, ["--protocol"], { encoding: "utf8" });
      assert.equal(out.trim(), "1");
      const refused = spawnSync(specstride, ["reverse", "specification"], {
        encoding: "utf8",
        env: process.env,
      });
      assert.equal(refused.status, 3);
      assert.match(refused.stderr, /reverse specification is not in this build/);
      // A scripted verb answers from STUB_SCRIPT.
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ status: { stdout: "run-1 running", exit: 0 } }));
      const scripted = spawnSync(specstride, ["status"], {
        encoding: "utf8",
        env: { ...process.env, STUB_SCRIPT: script },
      });
      assert.equal(scripted.status, 0);
      assert.equal(scripted.stdout.trim(), "run-1 running");
      const calls = stubCalls(fx.stubLog);
      assert.deepEqual(calls[0], { argv: ["--protocol"], cwd: process.cwd() });
      assert.deepEqual(calls[2].argv, ["status"]);
    });
  } finally {
    fx.cleanup();
  }
});

test("the stub hermes answers the calls the installer and notifier will make", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const hermes = join(ROOT, "tests", "stubs", "hermes");
      chmodSync(hermes, 0o755);
      const version = execFileSync(hermes, ["--version"], { encoding: "utf8" });
      assert.match(version, /0\.22\.2/);
      const enabled = execFileSync(hermes, ["plugins", "enable", "specstride"], {
        encoding: "utf8",
      });
      assert.match(enabled, /enabled/);
      const list = execFileSync(hermes, ["plugins", "list", "--json"], { encoding: "utf8" });
      assert.equal(JSON.parse(list).plugins[0].name, "specstride");
      const sent = execFileSync(hermes, ["send", "--text", "run-1 parked"], {
        encoding: "utf8",
        env: process.env,
      });
      assert.match(sent, /sent/);
      const calls = stubCalls(fx.stubLog).map((c) => c.argv.join(" "));
      assert.deepEqual(calls, [
        "--version",
        "plugins enable specstride",
        "plugins list --json",
        "send --text run-1 parked",
      ]);
    });
  } finally {
    fx.cleanup();
  }
});

test("tempHome isolates HERMES_HOME, XDG_STATE_HOME and the project root", async () => {
  const fx = tempHome();
  try {
    assert.notEqual(fx.home, process.env.HERMES_HOME);
    assert.ok(existsSync(join(fx.project, "specs")));
    await withStubs(fx, () => {
      assert.equal(process.env.HERMES_HOME, fx.home);
      assert.equal(process.env.XDG_STATE_HOME, fx.stateHome);
      assert.match(process.env.PATH ?? "", /tests[\\/]stubs/);
      assert.equal(process.env.SPECSTRIDE_BIN, join(ROOT, "tests", "stubs", "specstride"));
    });
    assert.notEqual(process.env.HERMES_HOME, fx.home);
  } finally {
    fx.cleanup();
    assert.ok(!existsSync(fx.home), "cleanup removes the fixture home");
  }
});
