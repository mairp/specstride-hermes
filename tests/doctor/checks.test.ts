/**
 * The eight `host.*` checks of the doctor, one fixture environment per row of
 * the task's matrix (T027, PT-150-016, PT-150-018, PT-150-019): the exact
 * line grammar `<severity> <check> — <fix>`, the check order of
 * contracts/150-host-hermes/doctor-output.md, and the one rule that fences
 * the set — only `host.cli-found` is launch-blocking, every other check is a
 * finding the doctor prints and never acts on.
 *
 * Every fixture runs `specstride-host-hermes doctor` as a subprocess against
 * a temporary `HERMES_HOME`, `XDG_STATE_HOME` and project root, with the stub
 * CLI and stub `hermes` first on PATH (tests/helpers/env.ts). No model call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempHome, withStubs, stubCalls } from "../helpers/env.ts";

const HERE = join(new URL(".", import.meta.url).pathname);
const ROOT = join(HERE, "..", "..");
const CLI = join(ROOT, "bin", "specstride-host-hermes.mjs");
const STUBS = join(ROOT, "tests", "stubs");

/** The eight check ids, in the contract's order. */
const CHECK_ORDER = [
  "host.cli-found",
  "host.protocol-supported",
  "host.hermes-version",
  "host.skills-installed",
  "host.state-root-writable",
  "host.permission-mode",
  "host.plugin-enabled",
  "host.kanban-plugin",
];

type Fx = ReturnType<typeof tempHome>;

function runCli(fx, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { HERMES_HOME: fx.home, XDG_STATE_HOME: fx.stateHome, STUB_LOG: fx.stubLog, ...process.env, ...env },
  });
}

function linesOf(done) {
  return done.stdout.trim().split("\n").filter((l) => l !== "");
}

/** The severity, id and message of one doctor line. */
function parseLine(line) {
  const m = /^(\S+) (host\.[a-z-]+) — (.*)$/.exec(line);
  assert.ok(m, `line does not follow the contract grammar: ${line}`);
  return { severity: m[1], id: m[2], message: m[3] };
}

function parsed(done) {
  return linesOf(done).map(parseLine);
}

/** A stub `hermes` visible on PATH with nothing else, for the no-CLI fixture. */
function binWithHermesOnly(fx) {
  const dir = binWithBlindWhich(fx);
  spawnSync("ln", ["-sf", join(STUBS, "hermes"), join(dir, "hermes")]);
  return dir;
}

/** A `which` stub that finds nothing, so `systemd-run` and `specstride` count as absent. */
function binWithBlindWhich(fx) {
  const dir = join(fx.home, "bin-blind");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "which");
  writeFileSync(path, "#!/usr/bin/env node\nprocess.exit(1);\n");
  spawnSync("chmod", ["755", path]);
  return dir;
}

/** A PATH that holds only the given bin dir, node, and the system dirs — never the stub CLI. */
function restrictedPath(fx, dir) {
  return [dir, join(process.execPath, ".."), "/usr/bin", "/bin"].join(":");
}

/** Install into the default profile (specstride), with reverse accepted. */
function installProfileSkills(fx) {
  const script = join(fx.home, "script.json");
  writeFileSync(script, JSON.stringify({ "reverse --help": { stdout: "reverse", exit: 0 } }));
  const done = runCli(fx, ["install", "--profile", "specstride"], { SPECSTRIDE_PROFILE: "specstride", STUB_SCRIPT: script });
  assert.equal(done.status, 0, `install refused: ${done.stderr}`);
}

test("a clean but uninstalled environment prints all eight checks in the contract order, skills missing is the only fail", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const done = runCli(fx, ["doctor"]);
      const findings = parsed(done);
      assert.deepEqual(findings.map((f) => f.id), CHECK_ORDER, "checks must come in the contract's order");
      assert.deepEqual(
        findings.map((f) => `${f.severity} ${f.id}`),
        [
          "ok host.cli-found",
          "ok host.protocol-supported",
          "ok host.hermes-version",
          "fail host.skills-installed",
          "ok host.state-root-writable",
          "ok host.permission-mode",
          "warn host.plugin-enabled",
          "info host.kanban-plugin",
        ],
        `unexpected findings: ${JSON.stringify(findings)}`,
      );
      assert.equal(done.status, 2, "at least one fail finding exits 2 (kit DOCTOR_EXITS)");
      assert.match(findings[3].message, /specstride-host-hermes install --profile specstride/);
    });
  } finally {
    fx.cleanup();
  }
});

test("a missing CLI makes host.cli-found the only blocking fail and the protocol check degrades to a warning", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const bin = binWithHermesOnly(fx);
      const done = runCli(fx, ["doctor"], { PATH: restrictedPath(fx, bin), SPECSTRIDE_BIN: "" });
      const findings = parsed(done);
      assert.equal(findings[0].severity, "fail");
      assert.equal(findings[0].id, "host.cli-found");
      assert.match(findings[0].message, /install/i);
      assert.equal(findings[1].id, "host.protocol-supported");
      assert.equal(findings[1].severity, "warn", "no CLI to probe: the protocol check warns, never crashes");
      const json = JSON.parse(runCli(fx, ["doctor", "--json"], { PATH: restrictedPath(fx, bin), SPECSTRIDE_BIN: "" }).stdout);
      const blocking = json.checks.filter((c) => c.blocking);
      assert.deepEqual(blocking.map((c) => c.id), ["host.cli-found"], "only host.cli-found blocks a launch");
    });
  } finally {
    fx.cleanup();
  }
});

test("a CLI that speaks another protocol is a fail naming the mismatch", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const done = runCli(fx, ["doctor"], { STUB_PROTOCOL: "2" });
      const line = parsed(done).find((f) => f.id === "host.protocol-supported");
      assert.equal(line.severity, "fail");
      assert.match(line.message, /protocol 2/);
      assert.match(line.message, /SPECSTRIDE-REFUSE|matching specstride release/);
    });
  } finally {
    fx.cleanup();
  }
});

test("a Hermes outside the verified range (0.21 and 0.23) warns with the re-verify fix, 0.22.2 does not", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      for (const version of ["0.21.9", "0.23.1"]) {
        const done = runCli(fx, ["doctor"], { STUB_HERMES_VERSION: version });
        const line = parsed(done).find((f) => f.id === "host.hermes-version");
        assert.equal(line.severity, "warn", `hermes ${version} must warn`);
        assert.match(line.message, /pin hermes-agent 0.22.2 or re-verify the host facts/);
      }
      const ok = parsed(runCli(fx, ["doctor"], { STUB_HERMES_VERSION: "0.22.2" })).find((f) => f.id === "host.hermes-version");
      assert.equal(ok.severity, "ok");
    });
  } finally {
    fx.cleanup();
  }
});

test("skills missing, stale and shadowed each produce their own finding", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // Installed and current: ok, unshadowed.
      installProfileSkills(fx);
      const ok = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" })).find((f) => f.id === "host.skills-installed");
      assert.equal(ok.severity, "ok");
      assert.match(ok.message, /unshadowed/);

      // Stale: the skill's metadata.specstride.version at another version.
      const skill = join(fx.home, "profiles", "specstride", "skills", "specstride", "specstride-run", "SKILL.md");
      const original = readFileSync(skill, "utf8");
      assert.match(original, /  specstride:\n    version: 0\.0\.0\n/);
      writeFileSync(skill, original.replace("    version: 0.0.0", "    version: 0.0.0-older"), "utf8");
      const stale = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" })).find((f) => f.id === "host.skills-installed");
      assert.equal(stale.severity, "warn");
      assert.match(stale.message, /another version than the package/);
      writeFileSync(skill, original, "utf8");

      // Shadowed: a project-root copy of the same spelling gets in the way.
      const shadow = join(fx.project, ".hermes", "skills", "specstride", "specstride-run");
      mkdirSync(shadow, { recursive: true });
      writeFileSync(join(shadow, "SKILL.md"), readFileSync(skill, "utf8"), "utf8");
      const shadowed = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride", SPECSTRIDE_PROJECT: fx.project })).find(
        (f) => f.id === "host.skills-installed",
      );
      assert.equal(shadowed.severity, "warn");
      assert.match(shadowed.message, /shadowed/);
      assert.match(shadowed.message, /specstride-run@0\.0\.0/);
    });
  } finally {
    fx.cleanup();
  }
});

test("a non-local terminal backend and an unwritable state root are findings naming the setting", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const docker = parsed(runCli(fx, ["doctor"], { STUB_CONFIG: JSON.stringify({ "terminal.backend": "docker" }) })).find(
        (f) => f.id === "host.state-root-writable",
      );
      assert.equal(docker.severity, "warn");
      assert.match(docker.message, /terminal\.backend/);
      assert.match(docker.message, /docker/);
      assert.doesNotMatch(docker.message, /working tree|repository/i, "the fix never moves state into the repo");

      // XDG_STATE_HOME under an existing file: the probe file cannot be created.
      const blocker = join(fx.home, "not-a-directory");
      writeFileSync(blocker, "a file, not a state home");
      const unwritable = parsed(
        runCli(fx, ["doctor"], { XDG_STATE_HOME: join(blocker, "state") }),
      ).find((f) => f.id === "host.state-root-writable");
      assert.equal(unwritable.severity, "warn");
      assert.match(unwritable.message, /not writable/);
    });
  } finally {
    fx.cleanup();
  }
});

test("permission-mode reports the default profile, yolo, headless deny and a gateway cgroup without systemd-run", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const defaultProfile = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "default" })).find((f) => f.id === "host.permission-mode");
      assert.equal(defaultProfile.severity, "warn");
      assert.match(defaultProfile.message, /default profile/);

      const yolo = parsed(runCli(fx, ["doctor"], { HERMES_YOLO_MODE: "1" })).find((f) => f.id === "host.permission-mode");
      assert.equal(yolo.severity, "warn");
      assert.match(yolo.message, /HERMES_YOLO_MODE/);

      const headless = parsed(
        runCli(fx, ["doctor"], {
          HERMES_HEADLESS: "1",
          STUB_CONFIG: JSON.stringify({ "approvals.single_query_mode": "deny", "approvals.cron_mode": "deny" }),
        }),
      ).find((f) => f.id === "host.permission-mode");
      assert.equal(headless.severity, "warn");
      assert.match(headless.message, /approvals\.single_query_mode/);
      assert.match(headless.message, /approvals\.cron_mode/);

      const cgroupFile = join(fx.home, "cgroup");
      writeFileSync(cgroupFile, "0::/system.slice/hermes-gateway.service\n");
      const blindBin = binWithBlindWhich(fx);
      const gateway = parsed(
        runCli(fx, ["doctor"], { SPECSTRIDE_CGROUP_FILE: cgroupFile, PATH: restrictedPath(fx, blindBin) }),
      ).find((f) => f.id === "host.permission-mode");
      assert.equal(gateway.severity, "warn");
      assert.match(gateway.message, /hermes-gateway/);
      assert.match(gateway.message, /systemd-run/);

      const clean = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_CGROUP_FILE: join(fx.home, "absent-cgroup") })).find(
        (f) => f.id === "host.permission-mode",
      );
      assert.equal(clean.severity, "ok");
    });
  } finally {
    fx.cleanup();
  }
});

test("plugin-enabled distinguishes enabled, installed-not-enabled and absent", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfileSkills(fx);

      const enabled = parsed(
        runCli(fx, ["doctor"], {
          SPECSTRIDE_PROFILE: "specstride",
          STUB_PLUGINS: JSON.stringify({ plugins: [{ name: "specstride", enabled: true }] }),
        }),
      ).find((f) => f.id === "host.plugin-enabled");
      assert.equal(enabled.severity, "ok");

      const disabled = parsed(runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" })).find(
        (f) => f.id === "host.plugin-enabled",
      );
      assert.equal(disabled.severity, "warn", "installed but not enabled is a warn (the stub default)");
      assert.match(disabled.message, /plugins enable specstride/);

      const absent = parsed(
        runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride", STUB_PLUGINS: JSON.stringify({ plugins: [] }) }),
      ).find((f) => f.id === "host.plugin-enabled");
      assert.equal(absent.severity, "info");
    });
  } finally {
    fx.cleanup();
  }
});

test("the kanban check is informational and never a fail", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      const noKanban = parsed(runCli(fx, ["doctor"])).find((f) => f.id === "host.kanban-plugin");
      assert.equal(noKanban.severity, "info");
      const kanban = parsed(
        runCli(fx, ["doctor"], {
          STUB_PLUGINS: JSON.stringify({ plugins: [{ name: "specstride", enabled: false }, { name: "kanban", enabled: true }] }),
        }),
      ).find((f) => f.id === "host.kanban-plugin");
      assert.notEqual(kanban.severity, "fail");
      assert.match(kanban.message, /151/);
    });
  } finally {
    fx.cleanup();
  }
});

test("the doctor probes read-only: no enable, no disable, no install verb reaches the stub hermes", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfileSkills(fx);
      writeFileSync(fx.stubLog, "");
      runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" });
      for (const call of stubCalls(fx.stubLog)) {
        const argv = call.argv.filter((a, i) => !(a === "-p"));
        const joined = argv.join(" ");
        assert.doesNotMatch(joined, /plugins (enable|disable)/, `the doctor must not mutate: ${joined}`);
        assert.doesNotMatch(joined, /^install/, `the doctor must not install: ${joined}`);
      }
    });
  } finally {
    fx.cleanup();
  }
});

test("a check that cannot run degrades to a warning and the doctor still exits with its finding", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      // A stub hermes that refuses plugins list: the plugin check must warn, not crash.
      const script = join(fx.home, "hermes-script.json");
      writeFileSync(script, JSON.stringify({ "plugins list --json": { stdout: "not json", exit: 0 } }));
      const done = runCli(fx, ["doctor"], { STUB_SCRIPT: script });
      assert.equal(done.status, 2, "the missing skills still fail, whatever the plugin probe does");
      const line = parsed(done).find((f) => f.id === "host.plugin-enabled");
      assert.equal(line.severity, "warn");
    });
  } finally {
    fx.cleanup();
  }
});

test("the written doctor.last report holds every finding for the hooks", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      installProfileSkills(fx);
      runCli(fx, ["doctor"], { SPECSTRIDE_PROFILE: "specstride" });
      const report = JSON.parse(readFileSync(join(fx.home, "specstride-host", "doctor.last"), "utf8"));
      assert.equal(report.schema, "specstride.doctor-report/1");
      assert.deepEqual(report.checks.map((c) => c.id), CHECK_ORDER);
    });
  } finally {
    fx.cleanup();
  }
});

void existsSync;
void rmSync;
