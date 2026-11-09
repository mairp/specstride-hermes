/**
 * The gateway-cgroup tests of the shim (T017, PT-150-013 unit part): a
 * fixture cgroup file naming the gateway unit (HF-GW-UNIT,
 * `hermes-gateway.service`) turns `launch` into the exact `systemd-run` argv
 * a stub records; a `--user` failure prints the one warning line and runs
 * the CLI directly; `status` is never wrapped; the watch list holds the cwd
 * once, atomically, after two launches.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runShim, shimFixture, writeStubCli, STUB_PATH, type ShimFixture } from "./helper.ts";

const GATEWAY_CGROUP = "12:p0:/system.slice/hermes-gateway.service\n";
const PLAIN_CGROUP = "12:p0:/user.slice/user-1000.slice/session-1.scope\n";
const WARN = "[SPECSTRIDE-WARN] action=launch reason=gateway-cgroup";

/** A stub `systemd-run`: records its argv, then runs the target after `--`. */
function writeStubSystemdRun(fx: ShimFixture, mode: "exec" | "fail-user"): void {
  const path = join(fx.stubs, "systemd-run");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, writeFileSync } from "node:fs";',
      'import { spawnSync } from "node:child_process";',
      "const argv = process.argv.slice(2);",
      'if (process.env.STUB_SYSTEMD_LOG) appendFileSync(process.env.STUB_SYSTEMD_LOG, JSON.stringify({ argv }) + "\\n");',
      'if (process.env.STUB_SYSTEMD_MODE === "fail-user") { process.exit(1); }',
      'const i = argv.indexOf("--");',
      "if (i === -1) process.exit(1);",
      "const result = spawnSync(argv[i + 1], argv.slice(i + 2), { stdio: 'inherit' });",
      "process.exit(result.status ?? 1);",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  void mode;
}

function withFixture(fn: (fx: ShimFixture) => void): void {
  const fx = shimFixture();
  try {
    fn(fx);
  } finally {
    fx.cleanup();
  }
}

test("launch inside the gateway cgroup runs under the exact systemd-run argv", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, GATEWAY_CGROUP);
    writeStubCli(fx, 1);
    writeStubSystemdRun(fx, "exec");
    const systemdLog = join(fx.root, "systemd-log.jsonl");
    const run = runShim(fx, ["launch", "--project", "."], {
      STUB_SYSTEMD_LOG: systemdLog,
      STUB_SYSTEMD_MODE: "exec",
    });
    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    const lines = JSON.parse(`[${readFileSync(systemdLog, "utf8").trim().split("\n").join(",")}]`) as {
      argv: string[];
    }[];
    assert.equal(lines.length, 1, "exactly one systemd-run call");
    const argv = lines[0].argv;
    assert.deepEqual(argv.slice(0, 3), ["--scope", "--collect", "--quiet"]);
    assert.match(argv[3], /^--unit=specstride-[0-9a-f]{8}$/);
    const dashDash = argv.indexOf("--");
    const asUser = typeof process.getuid === "function" && process.getuid() !== 0;
    if (asUser) assert.equal(argv[4], "--user");
    // The target after `--` is the CLI with the launch argv unchanged.
    assert.equal(argv[dashDash + 1], join(fx.stubs, "specstride"));
    assert.deepEqual(argv.slice(dashDash + 2), ["launch", "--project", "."]);
    // The CLI really ran, through the wrapper.
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["launch", "--project", "."]]);
  });
});

test("a --user failure prints the warning line and runs the CLI directly", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, GATEWAY_CGROUP);
    writeStubCli(fx, 1);
    writeStubSystemdRun(fx, "fail-user");
    const systemdLog = join(fx.root, "systemd-log.jsonl");
    const run = runShim(fx, ["launch"], {
      STUB_SYSTEMD_LOG: systemdLog,
      STUB_SYSTEMD_MODE: "fail-user",
    });
    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    const stderrLines = (run.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
    assert.deepEqual(stderrLines, [WARN]);
    // The CLI ran directly, after the failed wrap.
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["launch"]]);
  });
});

test("a missing systemd-run prints the warning line and runs the CLI directly", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, GATEWAY_CGROUP);
    // A PATH with the CLI's directory but no `systemd-run` anywhere on it.
    const cliOnly = join(fx.root, "cli-only");
    mkdirSync(cliOnly, { recursive: true });
    writeStubCli(fx, 1, 0, "specstride");
    copyFileSync(join(fx.stubs, "specstride"), join(cliOnly, "specstride"));
    chmodSync(join(cliOnly, "specstride"), 0o755);
    // The interpreter itself, so no system directory is needed on PATH.
    symlinkSync(process.execPath, join(cliOnly, "node"));
    const run = runShim(fx, ["launch"], { PATH: cliOnly });
    const noSystemdRun = readdirSafe(cliOnly).every((name) => name !== "systemd-run");
    assert.ok(noSystemdRun);
    assert.equal(run.status, 0);
    assert.deepEqual(
      (run.stderr ?? "").split("\n").filter((l) => l.trim() !== ""),
      [WARN],
    );
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["launch"]]);
  });
});
function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

test("status is never wrapped, even inside the gateway cgroup", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, GATEWAY_CGROUP);
    writeStubCli(fx, 1);
    writeStubSystemdRun(fx, "exec");
    const systemdLog = join(fx.root, "systemd-log.jsonl");
    const run = runShim(fx, ["status"], { STUB_SYSTEMD_LOG: systemdLog, STUB_SYSTEMD_MODE: "exec" });
    assert.equal(run.status, 0);
    assert.equal(readFileSyncOr(systemdLog, ""), "", "systemd-run was never called");
    assert.deepEqual(run.argvLines.map((line) => line.argv), [["--protocol"], ["status"]]);
  });
});

test("resume is wrapped like launch", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, GATEWAY_CGROUP);
    writeStubCli(fx, 1);
    writeStubSystemdRun(fx, "exec");
    const systemdLog = join(fx.root, "systemd-log.jsonl");
    runShim(fx, ["resume"], { STUB_SYSTEMD_LOG: systemdLog, STUB_SYSTEMD_MODE: "exec" });
    assert.match(readFileSyncOr(systemdLog, ""), /--scope/);
  });
});

test("outside the gateway cgroup the CLI runs directly", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, PLAIN_CGROUP);
    writeStubCli(fx, 1);
    writeStubSystemdRun(fx, "exec");
    const systemdLog = join(fx.root, "systemd-log.jsonl");
    const run = runShim(fx, ["launch"], { STUB_SYSTEMD_LOG: systemdLog, STUB_SYSTEMD_MODE: "exec" });
    assert.equal(run.status, 0);
    assert.equal(readFileSyncOr(systemdLog, ""), "", "no systemd-run call outside the gateway cgroup");
    assert.equal((run.stderr ?? "").trim(), "");
  });
});

test("the watch list holds the cwd once, even after two launches", () => {
  withFixture((fx) => {
    writeFileSync(fx.cgroupFile, PLAIN_CGROUP);
    writeStubCli(fx, 1);
    const first = runShim(fx, ["launch"]);
    const second = runShim(fx, ["launch"]);
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    const watch = JSON.parse(readFileSync(join(fx.home, "specstride-host", "watch.json"), "utf8")) as string[];
    assert.deepEqual(watch, [process.cwd()], "set semantics: one entry, the cwd of the fixture run");
    // A failed launch adds nothing.
    writeStubCli(fx, 1, 5);
    runShim(fx, ["launch"]);
    const afterFailure = JSON.parse(
      readFileSync(join(fx.home, "specstride-host", "watch.json"), "utf8"),
    ) as string[];
    assert.deepEqual(afterFailure, [process.cwd()]);
  });
});

function readFileSyncOr(path: string, fallback: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}
