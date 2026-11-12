/**
 * The notice tests (T052, PT-150-034, PT-150-035, F150-FR-034, F150-FR-035,
 * F150-SC-005): line format and size, the trigger list, the exact send argv,
 * the unset target, the only reads (`wait --until-change` through the shim),
 * the same-cycle delivery and the one concurrent `wait` per workspace.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  NOTICE_MAX_BYTES,
  TRIGGER_KINDS,
  noticeLine,
  parseWaitOutput,
  triggeredChanges,
} from "../../src/watch/notify.ts";
import { WAIT_CONCURRENCY_CAP, planWaves } from "../../src/watch/index.ts";
import { addWorkspaces, cliCalls, runWatchOnce, sendCalls, watchFixture, writeScript } from "./fixture.ts";

const CHANGE_LINE = "run=run-1 st=running cursor=5 next=/specstride status";
const ATTENTION_LINE =
  "run=run-1 st=waiting-human attn=blocked-on-human: gate needs your approval cursor=6 next=/specstride stop";

test("notice line follows contracts/notice-line.md and stays within 240 bytes", () => {
  assert.equal(noticeLine("run-1", { kind: "state", state: "running" }, "/specstride status"),
    "[specstride] run-1 st=running — /specstride status");
  assert.equal(noticeLine("run-1", { kind: "attention", item: { kind: "blocked-on-human", text: "gate needs you" } }, null),
    "[specstride] run-1 attn=blocked-on-human: gate needs you — /specstride status");
  const long = noticeLine(
    "run-1",
    { kind: "attention", item: { kind: "budget-alert", text: "caf\u00e9 ".repeat(120) } },
    "/specstride status",
  );
  const bytes = Buffer.byteLength(long, "utf8");
  assert.ok(bytes <= NOTICE_MAX_BYTES, `notice line is ${bytes} bytes`);
  assert.equal(Buffer.from(long, "utf8").toString("utf8"), long, "cut lands on a UTF-8 boundary");
  assert.ok(long.endsWith("…"), "a cut line ends with …");
});

test("the triggers are exactly the contract's list, and a run entering failed notifies", () => {
  assert.deepEqual([...TRIGGER_KINDS], [
    "blocked-on-human",
    "quota-pause",
    "dead-run",
    "launch-abandoned",
    "budget-alert",
  ]);
  const previous = "run=r st=running cursor=4 next=x";
  // A state change always notifies, including `failed`.
  assert.equal(triggeredChanges(parseWaitOutput("run=r st=failed cursor=5 next=x")[0], previous).length, 1);
  // A trigger-kind attention item notifies.
  assert.equal(
    triggeredChanges(parseWaitOutput("run=r st=running attn=budget-alert: over budget cursor=5")[0], previous).length, 1);
  // Another kind does not (it is precomputed only).
  assert.equal(
    triggeredChanges(parseWaitOutput("run=r st=running attn=note: a note cursor=5")[0], previous).length, 0);
  // An unchanged cycle notifies nothing.
  assert.equal(triggeredChanges(parseWaitOutput(CHANGE_LINE)[0], CHANGE_LINE).length, 0);
});

test("the send argv is hermes -p specstride send --to … --subject … --file - with the line on stdin", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const run = runWatchOnce(fx);
    assert.equal(run.status, 0, run.stderr);
    const sends = sendCalls(fx);
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].argv, [
      "-p",
      "specstride",
      "send",
      "--to",
      "telegram:4242",
      "--subject",
      "[specstride] run-1",
      "--file",
      "-",
    ]);
    assert.equal(sends[0].stdin, "[specstride] run-1 st=running — /specstride status");
  } finally {
    fx.cleanup();
  }
});

test("an unset target sends nothing and logs one line", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    const run = runWatchOnce(fx, { STUB_TARGET: "" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(sendCalls(fx).length, 0);
    const lines = run.stderr.split("\n").filter((line) => line.includes("no Telegram target"));
    assert.equal(lines.length, 1, run.stderr);
    // The status line is still precomputed for the hooks.
    const { statusPaths } = await import("../../src/watch/status-line.ts");
    const workspace = join(fx.root, "workspaces", "ws-0");
    const { lineFile } = statusPaths(fx.home, workspace);
    assert.equal(
      readFileSync(lineFile, "utf8"),
      CHANGE_LINE + "\n",
      "the precomputed status line is written even without a target",
    );
  } finally {
    fx.cleanup();
  }
});

test("the only reads are the shim's wait --until-change --cursor <c> --timeout 25", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    assert.equal(runWatchOnce(fx).status, 0);
    const verbs = cliCalls(fx).map((call) => call.argv);
    assert.ok(verbs.length >= 4, String(verbs.length)); // two --protocol probes, two waits
    for (const argv of verbs) {
      assert.ok(argv.includes("--protocol") || argv[0] === "wait", argv.join(" "));
    }
    const waits = verbs.filter((argv) => argv[0] === "wait");
    assert.equal(waits.length, 2);
    assert.deepEqual(waits[0], ["wait", "--until-change", "--timeout", "25"]);
    assert.deepEqual(waits[1], ["wait", "--until-change", "--cursor", "5", "--timeout", "25"]);
  } finally {
    fx.cleanup();
  }
});

test("one send per change, none for unchanged cycles, none repeated after a restart", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    assert.equal(sendCalls(fx).length, 1);
    // The same cursor again: unchanged, and the key is already seen.
    for (let index = 0; index < 2; index += 1) {
      assert.equal(runWatchOnce(fx).status, 0);
      assert.equal(sendCalls(fx).length, 1, `run ${index + 2} must not resend`);
    }
  } finally {
    fx.cleanup();
  }
});

test("a change is sent within the same watcher cycle as the wait return", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    // "Same cycle" is asserted structurally: the send happened before the run
    // returned, exactly once, against exactly one wait. No wall-clock bound:
    // an absolute ms limit is load-dependent and flaked on CI.
    const run = runWatchOnce(fx);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(sendCalls(fx).length, 1);
    assert.equal(cliCalls(fx).filter((call) => call.argv[0] === "wait").length, 1);
    assert.equal(cliCalls(fx).filter((call) => call.argv.includes("--protocol")).length, 1);
  } finally {
    fx.cleanup();
  }
});

test("three workspaces wait concurrently; a change in the third is delivered at once", async () => {
  const fx = watchFixture();
  try {
    // Concurrency is measured against a baseline, not an absolute clock: each
    // wait holds a deterministic 600 ms delay, so a serial wave would take at
    // least 3 × (spawn + 600 ms) and a concurrent one about 1 × it. The run is
    // compared with its own single-workspace baseline, so load spikes cancel.
    const DELAY_MS = 600;
    const singleFx = watchFixture();
    try {
      addWorkspaces(singleFx, 1);
      writeScript(singleFx, { wait: { stdout: CHANGE_LINE, exit: 0, delayMs: DELAY_MS } });
      // Three runs; the max absorbs a load spike that hits a single baseline
      // measurement, so the comparison below is never made against an
      // unloaded outlier baseline.
      let baseline = 0;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        assert.equal(runWatchOnce(singleFx).status, 0, singleFx.stderr);
        baseline = Math.max(baseline, performance.now() - t0);
      }
      const workspaces = addWorkspaces(fx, 3);
      writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0, delayMs: DELAY_MS } });
      // Workspace 3 holds a different precomputed line, so only its cycle sees a change.
      const { writeStatus } = await import("../../src/watch/status-line.ts");
      writeStatus(fx.home, workspaces[0], CHANGE_LINE);
      writeStatus(fx.home, workspaces[1], CHANGE_LINE);
      writeStatus(fx.home, workspaces[2], "run=run-1 st=deriving cursor=5 next=/specstride status");
      const start = performance.now();
      const run = runWatchOnce(fx);
      const elapsed = performance.now() - start;
      assert.equal(run.status, 0, run.stderr);
      assert.equal(sendCalls(fx).length, 1, run.stderr);
      assert.equal(sendCalls(fx)[0].stdin, "[specstride] run-1 st=running — /specstride status");
      const waits = cliCalls(fx).filter((call) => call.argv[0] === "wait");
      assert.equal(waits.length, 3);
      // Serial execution costs ≈ 3 × baseline; concurrent ≈ 1 × baseline.
      // 2.8 × sits well above the concurrent cost while staying below serial
      // even when the baseline measured low; against the max of three
      // baselines it tolerates a transient load spike during the measured run.
      assert.ok(
        elapsed < 2.8 * baseline,
        `three waits took ${Math.round(elapsed)} ms against a ${Math.round(baseline)} ms baseline (they must run concurrently)`,
      );
    } finally {
      singleFx.cleanup();
    }
  } finally {
    fx.cleanup();
  }
});

test("above the cap the watcher round-robins with --timeout 5", () => {
  assert.equal(WAIT_CONCURRENCY_CAP, 16);
  const many = Array.from({ length: 17 }, (_, index) => `/w${index}`);
  const waves = planWaves(many);
  assert.equal(waves.length, 2);
  assert.equal(waves[0].workspaces.length, 16);
  assert.equal(waves[1].workspaces.length, 1);
  assert.equal(waves[0].timeout, 5);
  assert.equal(waves[1].timeout, 5);
  const few = planWaves(many.slice(0, 16));
  assert.deepEqual(few, [{ workspaces: many.slice(0, 16), timeout: 25 }]);
});
