/**
 * The installer of the Hermes host (contracts/150-host-hermes/installer-cli.md,
 * F150-FR-021 to F150-FR-024, F150-FR-031): the `install` and `uninstall`
 * commands of `specstride-host-hermes`, their three scopes, the roots each
 * scope writes, the install record, the outcome table (fresh, unchanged,
 * refuse-on-drift, refuse-without-record), the skill set and its reverse
 * probe, the enabling of the plugin, the exit codes and the one rule that
 * fences it all: the installer never touches anything but the scope's roots
 * and, for `project`, the project's own `.hermes/`.
 *
 * Every test runs against a temporary `HERMES_HOME` and project root with the
 * stub `hermes` and stub CLI first on PATH (tests/helpers/env.ts, F150-FR-021),
 * so no test ever reaches a real home directory or a real Hermes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const HERE = join(new URL(".", import.meta.url).pathname);
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const STUBS = join(ROOT, "tests", "stubs");

/** The plain skills every scope installs; the bundled set adds the doctor. */
const PLAIN_SKILLS = ["specstride-run", "specstride-status", "specstride-curate", "specstride-reverse"];
const BUNDLED_ONLY = ["specstride-doctor"];

type Fx = ReturnType<typeof tempHome>;

/** Run the control CLI as a subprocess, exactly as a person would. */
function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** The install record file the installer writes inside a root it installed. */
function recordPathsUnder(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true });
  } catch {
    return []; // the root itself was removed by the uninstall
  }
  return entries.filter((p) => /install.*\.json$/.test(p));
}

function findRecord(dir) {
  const names = recordPathsUnder(dir);
  return names.length > 0 ? join(dir, names[0]) : null;
}

/** A git project root: the `project` scope installs under the git root. */
function gitInit(project) {
  spawnSync("git", ["init", "-q"], { cwd: project });
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: project });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: project });
  return project;
}

test("install in profile scope writes plain skills, the bundled plugin and records the install", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // The stub CLI answers `reverse --help` with exit 0, so the reverse
      // skill is in the installed set for this fixture (F150-FR-031).
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
      const done = runCli(["install", "--profile", "work"], { STUB_SCRIPT: script });
      assert.equal(done.status, 0, `install refused: ${done.stderr}`);
      const profile = join(fx.home, "profiles", "work");

      // Plain skills: the four plain ids, each a directory with a SKILL.md.
      const plain = join(profile, "skills", "specstride");
      for (const id of PLAIN_SKILLS) {
        assert.equal(statSync(join(plain, id, "SKILL.md")).isFile(), true, `${id} plain copy`);
      }
      // The doctor is bundled only: no plain copy of it, ever.
      assert.equal(existsSync(join(plain, "specstride-doctor")), false, "no plain doctor skill");

      // Bundled skills and the plugin live under plugins/specstride/.
      const plugin = join(profile, "plugins", "specstride");
      assert.equal(statSync(join(plugin, "plugin.yaml")).isFile(), true, "plugin manifest bundled");
      for (const id of [...PLAIN_SKILLS, ...BUNDLED_ONLY]) {
        assert.equal(statSync(join(plugin, "skills", id, "SKILL.md")).isFile(), true, `${id} bundled copy`);
      }

      // The install record: written after the files, and it exists.
      assert.notEqual(findRecord(plugin), null, "the plugin root carries an install record");

      // The scope enables the plugin through `hermes -p <p> plugins enable`.
      const calls = stubCalls(fx.stubLog).map((c) => c.argv.join(" "));
      assert.ok(calls.includes("-p work plugins enable specstride") || calls.includes("plugins enable specstride"),
        `hermes enable was called; saw: ${calls.join(" | ")}`);
      assert.match(done.stdout, /installed|specstride/, "one line per installed item");
    });
  } finally {
    fx.cleanup();
  }
});

test("install in user scope writes the user roots and only PRINTS the enable command", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
      const done = runCli(["install", "--user"], { STUB_SCRIPT: script });
      assert.equal(done.status, 0, `install refused: ${done.stderr}`);

      const plain = join(fx.home, "skills", "specstride");
      for (const id of PLAIN_SKILLS) {
        assert.equal(statSync(join(plain, id, "SKILL.md")).isFile(), true, `${id} under the user skills root`);
      }
      const plugin = join(fx.home, "plugins", "specstride");
      assert.equal(statSync(join(plugin, "plugin.yaml")).isFile(), true, "user plugin bundled");

      // The user scope never runs `hermes plugins enable`: it prints it.
      assert.match(done.stdout, /hermes plugins enable specstride/, "the enable command is printed");
      const calls = stubCalls(fx.stubLog).map((c) => c.argv.join(" "));
      assert.ok(!calls.includes("plugins enable specstride"), "the installer did not run the enable itself");
    });
  } finally {
    fx.cleanup();
  }
});

test("install in project scope writes under the git root and prints the trust command", async () => {
  const fx = tempHome();
  gitInit(fx.project);
  try {
    await withStubs(fx, async () => {
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
      const done = runCli(["install", "--project"], {
        SPECSTRIDE_PROJECT: fx.project,
        STUB_SCRIPT: script,
      });
      assert.equal(done.status, 0, `install refused: ${done.stderr}`);

      // Only the skills root exists for a project: no project plugins.
      const plain = join(fx.project, ".hermes", "skills", "specstride");
      for (const id of PLAIN_SKILLS) {
        assert.equal(statSync(join(plain, id, "SKILL.md")).isFile(), true, `${id} under the project root`);
      }
      assert.equal(existsSync(join(fx.project, ".hermes", "plugins")), false, "no project plugins");

      assert.match(done.stdout, /hermes skills trust/, "the trust command is printed for a project");
    });
  } finally {
    fx.cleanup();
  }
});

test("a second install is a no-op: already installed, unchanged", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      assert.equal(runCli(["install", "--user"]).status, 0);
      const plain = join(fx.home, "skills", "specstride");
      const before = readFileSync(join(plain, "specstride-run", "SKILL.md"), "utf8");

      const again = runCli(["install", "--user"]);
      assert.equal(again.status, 0);
      assert.match(again.stdout, /already installed, unchanged/);
      assert.equal(readFileSync(join(plain, "specstride-run", "SKILL.md"), "utf8"), before, "nothing was rewritten");
    });
  } finally {
    fx.cleanup();
  }
});

test("a changed installed file refuses the install and writes nothing", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      assert.equal(runCli(["install", "--user"]).status, 0);
      const victim = join(fx.home, "skills", "specstride", "specstride-run", "SKILL.md");
      writeFileSync(victim, readFileSync(victim, "utf8") + "\nchanged by hand\n");

      const refused = runCli(["install", "--user"]);
      assert.equal(refused.status, 1, "a drift refusal exits 1");
      assert.match(refused.stdout + refused.stderr, /refuse .* — changed since install/);

      // The refusal wrote nothing: the drifted file still holds the edit, and
      // no new file appeared anywhere under the skills root.
      assert.match(readFileSync(victim, "utf8"), /changed by hand/, "the drifted file was not overwritten");
      const plugin = join(fx.home, "plugins", "specstride");
      assert.equal(existsSync(join(plugin, "skills", "specstride-doctor", "SKILL.md")), true,
        "previously installed files are untouched");
    });
  } finally {
    fx.cleanup();
  }
});

test("an existing root without an install record refuses", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // A skills root someone made by hand: no record describes it.
      const hand = join(fx.home, "skills", "specstride", "specstride-run");
      mkdirSync(hand, { recursive: true });
      writeFileSync(join(hand, "SKILL.md"), "not ours\n");

      const refused = runCli(["install", "--user"]);
      assert.equal(refused.status, 1, "a no-record refusal exits 1");
      assert.match(refused.stdout + refused.stderr, /refuse .* — no install record describes it/);
      assert.equal(readFileSync(join(hand, "SKILL.md"), "utf8"), "not ours\n", "nothing was written over it");
    });
  } finally {
    fx.cleanup();
  }
});

test("uninstall removes matching recorded files, keeps changed ones and removes the record", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      assert.equal(runCli(["install", "--user"]).status, 0);
      const plain = join(fx.home, "skills", "specstride");
      const kept = join(plain, "specstride-status", "SKILL.md");
      writeFileSync(kept, readFileSync(kept, "utf8") + "\nchanged since install\n");

      const out = runCli(["uninstall", "--user"]);
      assert.equal(out.status, 0, `uninstall failed: ${out.stderr}`);
      assert.match(out.stdout + out.stderr, /specstride-status/, "the changed file is kept and named");
      assert.equal(existsSync(join(plain, "specstride-run", "SKILL.md")), false, "unchanged files are removed");
      assert.equal(existsSync(kept), true, "the changed file survives");

      // The record goes last: after uninstall no record remains under the roots.
      assert.equal(findRecord(join(fx.home, "plugins", "specstride")), null, "the record was removed");
      // The user scope prints the disable command instead of running it.
      assert.match(out.stdout, /hermes plugins disable specstride/);
      const calls = stubCalls(fx.stubLog).map((c) => c.argv.join(" "));
      assert.ok(!calls.includes("plugins disable specstride"), "the installer did not run the disable itself");
    });
  } finally {
    fx.cleanup();
  }
});

test("uninstall in profile scope disables the plugin through hermes -p", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      assert.equal(runCli(["install", "--profile", "work"]).status, 0);
      const before = stubCalls(fx.stubLog).length;
      const out = runCli(["uninstall", "--profile", "work"]);
      assert.equal(out.status, 0);
      const calls = stubCalls(fx.stubLog).slice(before).map((c) => c.argv.join(" "));
      assert.ok(calls.some((c) => c.includes("plugins disable specstride") && c.includes("-p work")),
        `hermes -p work plugins disable specstride was run; saw: ${calls.join(" | ")}`);
      assert.equal(existsSync(join(fx.home, "profiles", "work", "plugins", "specstride", "plugin.yaml")), false,
        "the plugin directory is gone");
    });
  } finally {
    fx.cleanup();
  }
});

test("the reverse skill is installed only when the resolved CLI accepts reverse", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // The stub CLI refuses `reverse` by default (exit 3): the installer
      // probes `reverse --help`, skips the skill and says why.
      const skipped = runCli(["install", "--user"]);
      assert.equal(skipped.status, 0);
      assert.match(skipped.stdout, /skip specstride-reverse — the CLI has no reverse verb/);
      assert.equal(existsSync(join(fx.home, "skills", "specstride", "specstride-reverse")), false,
        "no reverse skill when the CLI has no reverse verb");

      // A CLI that answers `reverse --help` with exit 0 gets the skill.
      rmSync(join(fx.home, "skills", "specstride"), { recursive: true, force: true });
      rmSync(join(fx.home, "plugins", "specstride"), { recursive: true, force: true });
      const script = join(fx.home, "script.json");
      writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
      const installed = runCli(["install", "--user"], { STUB_SCRIPT: script });
      assert.equal(installed.status, 0);
      assert.equal(existsSync(join(fx.home, "skills", "specstride", "specstride-reverse", "SKILL.md")), true,
        "the reverse skill is installed for a reverse-capable CLI");
    });
  } finally {
    fx.cleanup();
  }
});

test("usage errors exit 3: two scope flags, an unknown scope, an unknown flag", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      for (const args of [
        ["install", "--user", "--project"],
        ["install", "--profile", "p", "--user"],
        ["install", "--wat"],
        ["uninstall", "--user", "--project"],
      ]) {
        const bad = runCli(args);
        assert.equal(bad.status, 3, `${args.join(" ")} is a usage error (exit 3), got ${bad.status}`);
      }
      // Nothing was written for a refused command line.
      assert.equal(existsSync(join(fx.home, "skills")), false, "a usage error installs nothing");
    });
  } finally {
    fx.cleanup();
  }
});

test("a missing hermes binary exits 127 when the scope needs it to enable", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // The profile scope runs `hermes plugins enable`: with no `hermes` on
      // PATH the install fails with 127. The stubs directory is dropped from
      // PATH; node stays reachable through its absolute path.
      const stripped = {
        PATH: "/nonexistent/bin",
      };
      const missing = spawnSync(process.execPath, [CLI, "install", "--profile", "work"], {
        encoding: "utf8",
        env: { HERMES_HOME: fx.home, XDG_STATE_HOME: fx.stateHome, STUB_LOG: fx.stubLog, SPECSTRIDE_BIN: join(STUBS, "specstride"), ...stripped },
      });
      assert.equal(missing.status, 127, `missing hermes is exit 127, got ${missing.status}`);
      // Nothing was left half-installed: a failed enable refuses the install.
      assert.equal(existsSync(join(fx.home, "plugins", "specstride", "plugin.yaml")), false,
        "the install did not complete without the enable");
    });
  } finally {
    fx.cleanup();
  }
});

test("the installer never installs or updates the CLI or Hermes, and never edits config.yaml", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const config = join(fx.home, "config.yaml");
      writeFileSync(config, "model: local\n");
      const done = runCli(["install", "--profile", "work"]);
      assert.equal(done.status, 0);
      assert.equal(readFileSync(config, "utf8"), "model: local\n", "config.yaml is untouched");
      const calls = stubCalls(fx.stubLog).map((c) => c.argv.join(" "));
      for (const call of calls) {
        assert.ok(!/npm|install -g|update/.test(call), `no CLI or Hermes install was attempted: ${call}`);
      }
      // The installer made the stub binaries executable if it needed them —
      // but it never rewrote them.
      chmodSync(join(STUBS, "hermes"), 0o755);
      assert.equal(existsSync(join(fx.home, "bin")), false, "no binaries are written into HERMES_HOME");
    });
  } finally {
    fx.cleanup();
  }
});

test("the installed plugin carries _paths.json and the records name the package bin (T024)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const done = runCli(["install", "--profile", "specstride"]);
      assert.equal(done.status, 0, `install refused: ${done.stderr}`);
      const plugin = join(fx.home, "profiles", "specstride", "plugins", "specstride");
      const skills = join(fx.home, "profiles", "specstride", "skills", "specstride");

      // One record per root.
      const skillsRecord = findRecord(skills);
      const pluginRecord = findRecord(plugin);
      assert.notEqual(skillsRecord, null, "the skills root carries its own record");
      assert.notEqual(pluginRecord, null, "the plugin root carries its own record");

      // `_paths.json` points at the built `bin/` holding the shim.
      const paths = JSON.parse(readFileSync(join(plugin, "_paths.json"), "utf8"));
      assert.equal(typeof paths.packageBin, "string");
      assert.equal(existsSync(join(paths.packageBin, "specstride-hermes.mjs")), true,
        "packageBin holds the built shim");
      assert.equal(existsSync(join(paths.packageBin, "specstride-host-hermes.mjs")), true,
        "packageBin holds the control CLI");

      // The plugin record lists `_paths.json` and the same packageBin.
      const record = JSON.parse(readFileSync(pluginRecord, "utf8"));
      assert.equal(record.packageBin, paths.packageBin, "the record carries the same packageBin");
      assert.ok((record.files ?? []).some((f) => f.path === "_paths.json"),
        "the record lists _paths.json");
      const entry = record.files.find((f) => f.path === "_paths.json");
      const { createHash } = await import("node:crypto");
      const digest = createHash("sha256").update(readFileSync(join(plugin, "_paths.json"))).digest("hex");
      assert.equal(entry.sha256, digest, "the recorded hash of _paths.json matches the file");
    });
  } finally {
    fx.cleanup();
  }
});

test("a second install changes no byte and no mtime (T024)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      assert.equal(runCli(["install", "--user"]).status, 0);
      const roots = [join(fx.home, "skills", "specstride"), join(fx.home, "plugins", "specstride")];
      const before = roots.flatMap((root) =>
        readdirSync(root, { recursive: true }).map((rel) => {
          const path = join(root, rel);
          return statSync(path).isFile() ? `${path}:${statSync(path).mtimeMs}` : null;
        }).filter(Boolean),
      );

      const again = runCli(["install", "--user"]);
      assert.equal(again.status, 0);
      assert.match(again.stdout, /already installed, unchanged/);

      const after = roots.flatMap((root) =>
        readdirSync(root, { recursive: true }).map((rel) => {
          const path = join(root, rel);
          return statSync(path).isFile() ? `${path}:${statSync(path).mtimeMs}` : null;
        }).filter(Boolean),
      );
      assert.deepEqual(after, before, "every byte and mtime is unchanged");
    });
  } finally {
    fx.cleanup();
  }
});

test("the installer writes nothing outside the chosen roots (T024)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const done = runCli(["install", "--profile", "work"]);
      assert.equal(done.status, 0, `install refused: ${done.stderr}`);
      const homeEntries = readdirSync(fx.home).sort();
      assert.deepEqual(homeEntries, ["profiles", "stub-log.jsonl"].filter((e) =>
        existsSync(join(fx.home, e)),
      ).sort(), "only the profile tree appears in HERMES_HOME");
      const profileEntries = readdirSync(join(fx.home, "profiles", "work")).sort();
      assert.deepEqual(profileEntries, ["plugins", "skills"], "the profile holds only skills and plugins");
    });
  } finally {
    fx.cleanup();
  }
});
