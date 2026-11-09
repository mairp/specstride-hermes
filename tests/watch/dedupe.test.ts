/**
 * The dedupe tests (T053, PT-150-036, F150-FR-036): the key
 * `<run-id>:<cursor>` in `notify/seen.json`, atomic writes, the 1,000-key
 * cap, and a restarted watcher that sends nothing for a seen cursor.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SEEN_CAP, loadSeen, parseWaitOutput, recordSeen, seenKey } from "../../src/watch/notify.ts";
import { addWorkspaces, cliCalls, runWatchOnce, sendCalls, watchFixture, writeScript } from "./fixture.ts";

const CHANGE_LINE = "run=run-1 st=running cursor=5 next=/specstride status";

test("the dedupe key is <run-id>:<cursor> and lands in notify/seen.json", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    const event = parseWaitOutput(CHANGE_LINE)[0];
    assert.equal(seenKey(event), "run-1:5");
    const stored = JSON.parse(readFileSync(join(fx.home, "specstride-host", "notify", "seen.json"), "utf8"));
    assert.deepEqual(stored, ["run-1:5"]);
  } finally {
    fx.cleanup();
  }
});

test("seen.json is written atomically: no .tmp left behind", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    const directory = join(fx.home, "specstride-host", "notify");
    const leftovers = readdirSync(directory).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
    // A reader always sees valid JSON (atomic rename, never a torn file).
    assert.deepEqual(loadSeen(fx.home), ["run-1:5"]);
  } finally {
    fx.cleanup();
  }
});

test("the dedupe store is capped at the last 1,000 keys", () => {
  const fx = watchFixture();
  try {
    for (let index = 0; index < SEEN_CAP + 100; index += 1) {
      recordSeen(fx.home, `run-${index}:${index}`);
    }
    const seen = loadSeen(fx.home);
    assert.equal(seen.length, SEEN_CAP);
    assert.ok(!seen.includes("run-0:0"), "the oldest key was dropped");
    assert.ok(seen.includes(`run-${SEEN_CAP + 99}:${SEEN_CAP + 99}`), "the newest key is kept");
  } finally {
    fx.cleanup();
  }
});

test("a restart with the same cursor sends nothing", async () => {
  const fx = watchFixture();
  try {
    addWorkspaces(fx, 1);
    writeScript(fx, { wait: { stdout: CHANGE_LINE, exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    assert.equal(sendCalls(fx).length, 1);
    // A restart of the watcher (a fresh process) meets the same cursor.
    assert.equal(runWatchOnce(fx).status, 0);
    assert.equal(sendCalls(fx).length, 1, "a restarted watcher must not resend");
    // Only the dedupe suppresses it: a NEW cursor on the same state change is sent.
    writeScript(fx, { wait: { stdout: "run=run-1 st=waiting-human cursor=6 next=/specstride status", exit: 0 } });
    assert.equal(runWatchOnce(fx).status, 0);
    assert.equal(sendCalls(fx).length, 2);
  } finally {
    fx.cleanup();
  }
});
