/**
 * The installer's plugin-enable tests (T025, PT-150-022, PT-150-023): the
 * `profile` scope enables the bundled plugin by running
 * `hermes -p <p> plugins enable specstride` (PT-150-022), while the `user` and
 * `project` scopes — where the host must not touch Hermes state itself — only
 * print the command the person has to run (PT-150-023), and a `profile` install
 * without `hermes` on PATH exits 127 (F150-FR-031, exit-code table of
 * contracts/150-host-hermes/installer-cli.md).
 *
 * Everything runs against a temporary `HERMES_HOME` with the stub `hermes` and
 * stub CLI first on PATH (F150-FR-021), so no call ever reaches a real Hermes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const STUBS = join(ROOT, "tests", "stubs");

/**
 * Run the installer CLI with the fixture environment and extra PATH entries.
 * @param {string[]} args
 * @param {{path?: string[]}} [opts]
 */
function runCli(args, opts = {}) {
  const path = opts.path?.length
    ? `${opts.path.join(":")}:${process.env.PATH ?? ""}`
    : process.env.PATH ?? "";
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: path },
  });
}

/** The recorded stub calls that invoked hermes with a `plugins enable specstride` verb. */
function enableCalls(calls) {
  return calls.filter(
    (call) =>
      call.argv.includes("plugins") &&
      call.argv.includes("enable") &&
      call.argv.includes("specstride"),
  );
}

test("the profile scope enables the plugin by running hermes for that profile (PT-150-022)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = runCli(["install", "--profile", "work"]);
      assert.equal(result.status, 0, `install --profile work failed: ${result.stderr}`);
      const calls = enableCalls(stubCalls(fx.stubLog));
      assert.equal(calls.length, 1, `expected exactly one enable call, got ${JSON.stringify(calls)}`);
      const argv = calls[0].argv;
      assert.ok(argv.includes("plugins"), `argv runs the plugins verb: ${argv.join(" ")}`);
      assert.ok(argv.includes("enable"), `argv enables: ${argv.join(" ")}`);
      assert.ok(argv.includes("specstride"), `argv names the plugin: ${argv.join(" ")}`);
      assert.ok(argv.includes("-p"), `argv selects the profile: ${argv.join(" ")}`);
      assert.ok(argv.includes("work"), `argv uses the requested profile name: ${argv.join(" ")}`);
    });
  } finally {
    fx.cleanup();
  }
});

test("the user scope only prints the enable command and never runs hermes (PT-150-023)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = runCli(["install", "--user"]);
      assert.equal(result.status, 0, `install --user failed: ${result.stderr}`);
      assert.match(result.stdout, /hermes plugins enable specstride/);
      assert.deepEqual(enableCalls(stubCalls(fx.stubLog)), []);
    });
  } finally {
    fx.cleanup();
  }
});

test("the project scope only prints the skills-trust command for the git root (PT-150-023)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = runCli(["--project", fx.project, "install", "--project"], {
        path: [STUBS],
      });
      // `--project` is a scope flag of the installer; run from the fixture
      // project so the git-root resolution lands inside the temporary tree.
      assert.ok(result.status === 0 || result.status === 1, `unexpected exit: ${result.status} ${result.stderr}`);
      assert.match(result.stdout, /hermes skills trust/);
      assert.match(result.stdout, new RegExp(fx.project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.deepEqual(enableCalls(stubCalls(fx.stubLog)), []);
    });
  } finally {
    fx.cleanup();
  }
});

test("the profile scope exits 127 when hermes is missing from PATH", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      // A PATH with only the stub specstride CLI: the installer can probe the
      // engine, but the `hermes` binary the profile scope needs is absent.
      const onlySpecstride = mkdtempSync(join(tmpdir(), "enable-path-"));
      try {
        copyFileSync(join(STUBS, "specstride"), join(onlySpecstride, "specstride"));
        chmodSync(join(onlySpecstride, "specstride"), 0o755);
        const result = spawnSync(process.execPath, [CLI, "install", "--profile", "specstride"], {
          encoding: "utf8",
          env: {
            HERMES_HOME: fx.home,
            XDG_STATE_HOME: fx.stateHome,
            STUB_LOG: fx.stubLog,
            SPECSTRIDE_BIN: join(STUBS, "specstride"),
            PATH: onlySpecstride,
          },
        });
        assert.equal(result.status, 127);
        assert.match(result.stderr, /hermes/);
      } finally {
        rmSync(onlySpecstride, { recursive: true, force: true });
      }
    });
  } finally {
    fx.cleanup();
  }
});

test("two scope flags together refuse with the usage exit code", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, () => {
      const result = runCli(["install", "--profile", "specstride", "--user"]);
      assert.equal(result.status, 3);
      assert.deepEqual(enableCalls(stubCalls(fx.stubLog)), []);
    });
  } finally {
    fx.cleanup();
  }
});
