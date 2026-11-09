/**
 * The failure tests (T054, PT-150-037, F150-FR-037): a failing `hermes send`
 * costs one log line and still records the key, the next cycle starts at
 * once, and the watcher refuses to run inside a Kanban session or the
 * gateway's cgroup. Nothing here can gate a run (H5).
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCycle, watchRefusal } from "../../src/watch/index.ts";
import { loadSeen } from "../../src/watch/notify.ts";
import { addWorkspaces, cliCalls, runWatchOnce, sendCalls, watchFixture, writeScript } from "./fixture.ts";

const CHANGE_LINE = "run=run-1 st=running cursor=5 next=/specstride status";

/**
 * The stub environment for an in-process `runCycle`: the fixture's stub paths
 * in `process.env`, restored afterwards (the shim and the stubs read them).
 */
function withStubEnv(fx: ReturnType<typeof watchFixture>, fn: () => Promise<void>): Promise<void> {
  const previous = { ...process.env };
  process.env.STUB_LOG = fx.stubLog;
  process.env.STUB_SCRIPT_FILE = join(fx.root, "stub-script.json");
  process.env.SPECSTRIDE_BIN = join(fx.stubs, "specstride");
  process.env.SPECSTRIDE_CGROUP_FILE = fx.cgroupFile;
  process.env.HERMES_HOME = fx.home;
  process.env.PATH = `${fx.stubs}:${previous.PATH ?? ""}`;
  return fn().finally(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("a failing hermes send gives one log line and records the key", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const run = runWatchOnce(fx, { STUB_SEND_EXIT: "1" });
    assert.equal(run.status, 0, run.stderr);
    const failures = run.stderr.split("\n").filter((line) => line.includes("notice delivery failed"));
    assert.equal(failures.length, 1, run.stderr);
    assert.equal(sendCalls(fx).length, 1, "the delivery was attempted once");
    assert.deepEqual(loadSeen(fx.home), ["run-1:5"], "the key is recorded despite the failure");
  } finally {
    fx.cleanup();
  }
});

test("a failed delivery does not delay the next cycle", async () => {
  const fx = watchFixture();
  try {
    const workspace = addWorkspaces(fx, 1)[0];
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const start = Date.now();
    const first = await withStubEnv(fx, () => runCycle({ home: fx.home, log: () => {} }));
    const firstElapsed = Date.now() - start;
    assert.equal(first.delivered, 0, "the send failed");
    // The next cycle — unchanged, cursor replayed — starts immediately.
    const secondStart = Date.now();
    const second = await withStubEnv(fx, () => runCycle({ home: fx.home, log: () => {} }));
    const secondElapsed = Date.now() - secondStart;
    assert.equal(second.workspaces, 1);
    assert.ok(secondElapsed < 1_000, `next cycle took ${secondElapsed} ms`);
    assert.ok(firstElapsed < 5_000, `first cycle took ${firstElapsed} ms`);
    const waits = cliCalls(fx).filter((call) => call.argv[0] === "wait");
    assert.equal(waits.length, 2, "both cycles waited once per workspace");
    assert.deepEqual(waits[1].argv, ["wait", "--until-change", "--cursor", "5", "--timeout", "25"]);
    void workspace;
  } finally {
    fx.cleanup();
  }
});

test("the watcher does not run inside a Kanban or cron session", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const kanban = runWatchOnce(fx, { HERMES_SESSION_SOURCE: "kanban" });
    assert.equal(kanban.status, 0);
    assert.ok(kanban.stderr.includes("watcher skipped"), kanban.stderr);
    assert.equal(cliCalls(fx).length, 0, "no CLI call was made");
    const cron = runWatchOnce(fx, { HERMES_SESSION_SOURCE: "cron" });
    assert.equal(cron.status, 0);
    assert.ok(cron.stderr.includes("watcher skipped"), cron.stderr);
    assert.equal(cliCalls(fx).length, 0);
  } finally {
    fx.cleanup();
  }
});

test("the watcher does not run inside the gateway cgroup", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const cgroupFile = join(fx.root, "gateway-cgroup");
    writeFileSync(cgroupFile, "0::/system.slice/hermes-gateway.service\n");
    const run = runWatchOnce(fx, { SPECSTRIDE_CGROUP_FILE: cgroupFile });
    assert.equal(run.status, 0);
    assert.ok(run.stderr.includes("hermes-gateway.service"), run.stderr);
    assert.equal(cliCalls(fx).length, 0, "no CLI call was made");
    // A workspace session whose cgroup names nothing special runs normally.
    assert.equal(watchRefusal({ SPECSTRIDE_CGROUP_FILE: fx.cgroupFile }, fx.cgroupFile), null);
    assert.ok(
      watchRefusal({ SPECSTRIDE_CGROUP_FILE: cgroupFile }, cgroupFile)?.includes("watcher skipped"),
      "the gateway cgroup is a refusal",
    );
  } finally {
    fx.cleanup();
  }
});

test("a cycle error costs one log line and the watcher goes on (fail open, H5)", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { exit: 7, stderr: "stub wait exploded" } });
    const lines: string[] = [];
    const result = await withStubEnv(fx, () =>
      runCycle({
        home: fx.home,
        log: (line) => lines.push(line),
      }));
    assert.equal(result.delivered, 0);
    assert.equal(result.workspaces, 1);
    const failures = lines.filter((line) => line.includes("wait failed"));
    assert.equal(failures.length, 1, lines.join("\n"));
    assert.ok(failures[0].includes("7"));
    // The state root still holds no half-written status line.
    const statusDirectory = join(fx.home, "specstride-host", "status");
    assert.equal(existsLenient(statusDirectory), false);
  } finally {
    fx.cleanup();
  }
});

function existsLenient(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}
