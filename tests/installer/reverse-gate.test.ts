/**
 * The reverse gate of the installer (T047, PT-150-031, F150-FR-031, US4):
 * `specstride-reverse` is installed — plain AND bundled — only where the
 * pinned CLI accepts `reverse` (`reverse --help` exits 0); where it refuses
 * ("not in this build", exit 3, U-150-05) the installer SKIPS the skill with
 * the contract's line, and `host.skills-installed` reports it as `info`.
 * The conformance set covers the skill where it installs.
 *
 * Every fixture runs the control CLI as a subprocess against a temporary
 * `HERMES_HOME` with the stub CLI and stub `hermes` first on PATH
 * (tests/helpers/env.ts). The stub refuses `reverse` by default (exit 3)
 * and accepts it under a `$STUB_SCRIPT` entry. No model call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";
import { hermesSkillRenders } from "../../src/skills.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");

type Fx = ReturnType<typeof tempHome>;

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** The doctor line for one check id, parsed into severity and message. */
function doctorLineFor(fx, id) {
  const done = runCli(["doctor"]);
  assert.equal(done.status, 0, `doctor failed: ${done.stderr}`);
  const lines = done.stdout.trim().split("\n");
  const found = lines
    .map((line) => /^(\S+) (host\.[a-z-]+) — (.*)$/.exec(line))
    .filter((m) => m !== null && m[2] === id);
  assert.ok(found.length > 0, `no doctor line for ${id} in:\n${done.stdout}`);
  return { severity: found[0][1], message: found[0][3] };
}

test("a CLI without reverse skips the skill, plain and bundled, and the doctor reports it as info", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // The stub's default answer for `reverse` is the "not in this build"
      // exit 3 (U-150-05): no scripted answer is given here.
      const done = runCli(["install", "--profile", "specstride"]);
      assert.equal(done.status, 0, `install failed: ${done.stderr}`);

      // The contract's skip line.
      assert.match(done.stdout, /skip specstride-reverse — the CLI has no reverse verb/);
      // The probe reached the CLI exactly once, through the resolution steps.
      const calls = stubCalls(fx.stubLog);
      assert.ok(
        calls.some((c) => JSON.stringify(c.argv) === JSON.stringify(["reverse", "--help"])),
        `the reverse probe did not run: ${JSON.stringify(calls)}`,
      );

      // Neither copy of the skill exists.
      const plain = join(fx.home, "profiles", "specstride", "skills", "specstride");
      const bundled = join(fx.home, "profiles", "specstride", "plugins", "specstride", "skills");
      assert.equal(existsSync(join(plain, "specstride-reverse")), false, "no plain reverse copy");
      assert.equal(existsSync(join(bundled, "specstride-reverse")), false, "no bundled reverse copy");
      // The other skills installed all the same.
      assert.equal(existsSync(join(plain, "specstride-run", "SKILL.md")), true, "run installed");
      assert.equal(existsSync(join(plain, "specstride-curate", "SKILL.md")), true, "curate installed");
      assert.equal(existsSync(join(bundled, "specstride-run", "SKILL.md")), true, "bundled run installed");

      // The doctor names the missing verb as informational.
      const line = doctorLineFor(fx, "host.skills-installed");
      assert.equal(line.severity, "info");
      assert.match(line.message, /specstride-reverse not installed — the CLI has no reverse verb/);
    });
  } finally {
    fx.cleanup();
  }
});

test("a CLI with reverse installs the plain and bundled copies and the conformance set covers them", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse <feature>", exit: 0 } }));
      const done = runCli(["install", "--profile", "specstride"], { STUB_SCRIPT: script });
      assert.equal(done.status, 0, `install failed: ${done.stderr}`);
      assert.doesNotMatch(done.stdout, /skip specstride-reverse/);

      // Plain copy: byte for byte the built skill.
      const built = readFileSync(join(ROOT, "skills", "specstride", "specstride-reverse", "SKILL.md"));
      const plain = join(fx.home, "profiles", "specstride", "skills", "specstride", "specstride-reverse", "SKILL.md");
      assert.ok(existsSync(plain), "the plain reverse copy is installed");
      assert.equal(readFileSync(plain).equals(built), true, "plain copy matches the build");

      // Bundled copy: byte for byte the built plugin copy.
      const builtBundled = readFileSync(
        join(ROOT, "hermes-plugin", "specstride", "skills", "specstride-reverse", "SKILL.md"),
      );
      const bundled = join(
        fx.home,
        "profiles",
        "specstride",
        "plugins",
        "specstride",
        "skills",
        "specstride-reverse",
        "SKILL.md",
      );
      assert.ok(existsSync(bundled), "the bundled reverse copy is installed");
      assert.equal(readFileSync(bundled).equals(builtBundled), true, "bundled copy matches the build");

      // The doctor is `ok`, not `info`.
      const line = doctorLineFor(fx, "host.skills-installed");
      assert.equal(line.severity, "ok", `expected ok: ${line.severity} ${line.message}`);

      // The conformance set covers the installed skill: the render ships both
      // copies, the kit source of the host's set is the reverse skill, and
      // scripts/conformance.ts registers it among the kit skills it drives.
      const render = hermesSkillRenders().find((r) => r.logicalId === "specstride-reverse");
      assert.ok(render, "the reverse render exists");
      assert.deepEqual([...render.copies], ["plain", "bundled"]);
      const conformance = readFileSync(join(ROOT, "scripts", "conformance.ts"), "utf8");
      assert.match(conformance, /"specstride-reverse"/, "conformance.ts drives the reverse skill");
    });
  } finally {
    fx.cleanup();
  }
});
