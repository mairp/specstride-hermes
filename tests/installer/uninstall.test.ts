/**
 * The uninstall tests of the Hermes host's installer (T026, PT-150-024,
 * contracts/installer-cli.md "Uninstall"): unchanged recorded files are
 * removed together with their emptied item directories, a file that changed
 * since the install is kept and named in the output, the install record is
 * removed last, and only the `profile` scope runs
 * `hermes -p <p> plugins disable specstride` — the other scopes only print it.
 *
 * The tests drive `src/installer.ts` in process through its CLI-shaped entry
 * `run(argv: string[]): {exit, stdout, stderr}` (exit codes 0 done,
 * 1 refused, 3 usage), always inside the fixture environment of
 * `tests/helpers/env.ts` (temporary `HERMES_HOME`, both stubs first on PATH).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/installer.ts";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const RECORD = ".specstride-host-hermes-install.json";

/** The skill and plugin roots the installer uses for each scope. */
function roots(fx, scope) {
  if (scope === "profile") {
    return {
      skills: join(fx.home, "profiles", "specstride", "skills", "specstride"),
      plugin: join(fx.home, "profiles", "specstride", "plugins", "specstride"),
    };
  }
  if (scope === "user") {
    return { skills: join(fx.home, "skills", "specstride"), plugin: join(fx.home, "plugins", "specstride") };
  }
  return { skills: join(fx.project, ".hermes", "skills", "specstride"), plugin: null };
}

function recordPath(fx, scope) {
  const r = roots(fx, scope);
  return join(r.plugin ?? r.skills, RECORD);
}

/** Install the given scope through the real installer; assert it succeeded. */
function install(fx, scope, profile) {
  const argv = ["install", scope === "profile" ? "--profile" : `--${scope}`];
  if (scope === "profile") argv.push(profile ?? "specstride");
  const done = run(argv);
  assert.equal(done.exit, 0, `install ${scope} exited 0: ${done.stderr || done.stdout}`);
}

test("uninstall removes the unchanged recorded files and their empty item directories", async (t) => {
  const fx = tempHome();
  t.after(fx.cleanup);
  await withStubs(fx, (fx) => {
    install(fx, "profile");
    const { skills, plugin } = roots(fx, "profile");
    const installed = readFileSync(join(skills, "specstride-run", "SKILL.md"), "utf8");
    assert.ok(installed.length > 0, "the install wrote the skill");
    assert.ok(existsSync(join(plugin, "plugin.yaml")), "the install wrote the plugin");

    const out = run(["uninstall", "--profile", "specstride"]);
    assert.equal(out.exit, 0, `uninstall exited 0: ${out.stderr}`);
    assert.ok(!existsSync(skills), "the emptied skill root is gone");
    assert.ok(!existsSync(plugin), "the emptied plugin root is gone");
    assert.ok(!existsSync(recordPath(fx, "profile")), "the record is gone");
  });
});

test("a changed file is kept and named, the unchanged siblings are removed", async (t) => {
  const fx = tempHome();
  t.after(fx.cleanup);
  await withStubs(fx, (fx) => {
    install(fx, "profile");
    const { skills } = roots(fx, "profile");
    const changed = join(skills, "specstride-run", "SKILL.md");
    writeFileSync(changed, readFileSync(changed, "utf8") + "\n<!-- edited after install -->\n");

    const out = run(["uninstall", "--profile", "specstride"]);
    assert.equal(out.exit, 0, `uninstall still succeeds: ${out.stderr}`);
    assert.ok(out.stdout.includes(changed) || out.stderr.includes(changed),
      `the output names the changed file: ${out.stdout}`);
    assert.ok(existsSync(changed), "the changed file is kept");
    assert.match(readFileSync(changed, "utf8"), /edited after install/, "its bytes are untouched");
    assert.ok(!existsSync(join(skills, "specstride-status")), "an unchanged sibling is removed");
    assert.ok(!existsSync(recordPath(fx, "profile")), "the record is removed");
  });
});

test("the install record is removed last, after every recorded file", async (t) => {
  const fx = tempHome();
  t.after(fx.cleanup);
  await withStubs(fx, (fx) => {
    install(fx, "profile");
    const record = recordPath(fx, "profile");
    assert.ok(existsSync(record), "the install wrote the record");

    // Track every removal the installer performs while it runs.
    const removed = [];
    const realRm = fs.rmSync;
    const realUnlink = fs.unlinkSync;
    const track = (path) => {
      if (path.startsWith(fx.home)) removed.push(path);
    };
    fs.rmSync = function (path, ...rest) {
      track(String(path));
      return realRm.call(fs, path, ...rest);
    };
    fs.unlinkSync = function (path) {
      track(String(path));
      return realUnlink.call(fs, path);
    };
    let out;
    try {
      out = run(["uninstall", "--profile", "specstride"]);
    } finally {
      fs.rmSync = realRm;
      fs.unlinkSync = realUnlink;
    }
    assert.equal(out.exit, 0, `uninstall exited 0: ${out.stderr}`);
    assert.ok(removed.includes(record), "the record is removed by the uninstall");
    assert.equal(removed.at(-1), record,
      `the record removal is the last filesystem removal: ${JSON.stringify(removed)}`);
  });
});

test("--profile runs hermes -p <p> plugins disable specstride through the stub", async (t) => {
  const fx = tempHome();
  t.after(fx.cleanup);
  await withStubs(fx, (fx) => {
    install(fx, "profile");
    const before = stubCalls(fx.stubLog).length;
    run(["uninstall", "--profile", "specstride"]);
    const calls = stubCalls(fx.stubLog).slice(before).map((c) => c.argv);
    assert.ok(
      calls.some((argv) => JSON.stringify(argv) === JSON.stringify(["-p", "specstride", "plugins", "disable", "specstride"])),
      `the stub hermes saw the exact disable argv: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      !calls.some((argv) => argv.includes("enable")),
      "uninstall never enables the plugin",
    );
  });
});

for (const scope of ["user", "project"]) {
  test(`--${scope} uninstall only prints the disable line, it never runs hermes`, async (t) => {
    const fx = tempHome();
    t.after(fx.cleanup);
    mkdirSync(join(fx.project, ".git"), { recursive: true });
    await withStubs(fx, (fx) => {
      const previousCwd = process.cwd();
      if (scope === "project") process.chdir(fx.project);
      try {
        install(fx, scope);
        const before = stubCalls(fx.stubLog).length;
        const out = run(["uninstall", `--${scope}`]);
        assert.equal(out.exit, 0, `uninstall ${scope} exited 0: ${out.stderr}`);
        assert.match(out.stdout, /hermes plugins disable specstride/,
          `the ${scope} scope prints the disable command`);
        const calls = stubCalls(fx.stubLog).slice(before).map((c) => c.argv);
        assert.ok(
          !calls.some((argv) => argv.includes("disable") || argv.includes("plugins")),
          `the ${scope} scope runs no hermes plugin command: ${JSON.stringify(calls)}`,
        );
        assert.ok(!existsSync(recordPath(fx, scope)), "the record is removed");
        assert.ok(!existsSync(roots(fx, scope).skills), "the skill files are removed");
      } finally {
        if (scope === "project") process.chdir(previousCwd);
      }
    });
  });
}
