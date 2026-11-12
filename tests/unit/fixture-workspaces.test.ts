/**
 * The workspace fixture smoke test (T006): every fixture workspace under
 * `tests/fixtures/workspaces/` holds the minimal closed-set inputs its
 * case needs, at the paths of the closed set "Reader inputs" of
 * `contracts/151-hermes-kanban/closed-sets.json`, and every JSON file in
 * the tree parses. This fails fast when a fixture loses a file or gains a
 * path the reader must never open.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "fixtures", "workspaces");

/** Every .json file of a fixture workspace parses. */
function assertJsonParses(dir: string): void {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join((entry.parentPath ?? entry.path) as string, entry.name);
    const raw = readFileSync(path, "utf8");
    assert.doesNotThrow(() => JSON.parse(raw), `${path} must parse as JSON`);
  }
}

function workspaceId(feature: string): string {
  return JSON.parse(readFileSync(join(ROOT, feature, ".specstride", "workspace.json"), "utf8")) as {
    workspaceId: string;
  };
}

const BASE = ["specs", ".specstride/workspace.json"];

const EXPECTED: Record<string, string[]> = {
  relaunch: [
    ...BASE,
    "specs/151-relaunch/tasks.md",
    ".specstride/events.jsonl",
    ".specstride/launches/launch-r0/launch.json",
    ".specstride/launches/launch-r0/supervision.json",
    ".specstride/launches/launch-r0/runtime.status.json",
    ".specstride/launches/launch-r1/launch.json",
    ".specstride/launches/launch-r1/supervision.json",
    ".specstride/launches/launch-r1/runtime.status.json",
    ".specstride/features/151-relaunch/runs/run-launch-r1/lease.json",
    ".specstride/state/pipeline/151-relaunch/runs/launch-r1/state.json",
  ],
  "pid-reuse": [
    ...BASE,
    "specs/151-reuse/tasks.md",
    ".specstride/launches/launch-p1/launch.json",
    ".specstride/features/151-reuse/runs/run-launch-p1/lease.json",
    ".specstride/state/pipeline/151-reuse/runs/launch-p1/state.json",
  ],
  signalled: [
    ...BASE,
    "specs/151-signal/tasks.md",
    ".specstride/launches/launch-s1/launch.json",
    ".specstride/launches/launch-s1/supervision.json",
    ".specstride/launches/launch-s1/runtime.status.json",
    ".specstride/features/151-signal/runs/run-launch-s1/lease.json",
    ".specstride/state/pipeline/151-signal/runs/launch-s1/state.json",
  ],
  vanished: [...BASE, "specs/151-vanish/tasks.md", ".specstride/events.jsonl"],
  "engine-died": [...BASE, "specs/151-dead/tasks.md", ".specstride/events.jsonl"],
  "no-launch": [...BASE, "specs/151-nolaunch/tasks.md"],
  "voided-approval": [...BASE, "specs/151-voided/tasks.md"],
  salted: [...BASE, "specs/151-salted/tasks.md"],
  "feature-150": [...BASE, "specs/150-host-hermes/tasks.md"],
};

test("every fixture workspace holds its minimal closed-set inputs", () => {
  for (const [fixture, expected] of Object.entries(EXPECTED)) {
    for (const rel of expected) {
      assert.ok(existsSync(join(ROOT, fixture, rel)), `${fixture} is missing ${rel}`);
    }
    assertJsonParses(join(ROOT, fixture));
  }
});

test("fixtures that judge liveness carry a procs.json in the control root", () => {
  // The control root of the closed set, member 8:
  // .specstride/workspaces/<id16>/procs.json
  for (const fixture of ["relaunch", "pid-reuse", "vanished", "engine-died"]) {
    const id = workspaceId(fixture).workspaceId;
    const path = join(ROOT, fixture, ".specstride", "workspaces", id, "procs.json");
    assert.ok(existsSync(path), `${fixture} misses .specstride/workspaces/${id}/procs.json`);
    const procs = JSON.parse(readFileSync(path, "utf8")) as { processes: unknown[] };
    assert.ok(Array.isArray(procs.processes));
  }
});

test("engine-died carries no engine process and vanished carries a stale event", () => {
  const died = JSON.parse(
    readFileSync(
      join(ROOT, "engine-died", ".specstride", "workspaces", "enginedied0000001", "procs.json"),
      "utf8",
    ),
  ) as { processes: unknown[] };
  assert.deepEqual(died.processes, []);

  const lines = readFileSync(join(ROOT, "vanished", ".specstride", "events.jsonl"), "utf8")
    .trim()
    .split("\n");
  const last = JSON.parse(lines[lines.length - 1]) as { at: string };
  assert.equal(last.at, "2026-11-11T08:00:00.000Z"); // 1 h before the recorded 09:00
});

test("the signalled launch names its signal where the reader reads it", () => {
  for (const file of ["runtime.status.json", "supervision.json"]) {
    const record = JSON.parse(
      readFileSync(join(ROOT, "signalled", ".specstride", "launches", "launch-s1", file), "utf8"),
    ) as { signal?: string; exitSignal?: number };
    assert.equal(record.signal, "SIGTERM");
    assert.equal(record.exitSignal, 15);
  }
});

test("the pid-reuse lease records a pid whose live starttime differs", () => {
  const lease = JSON.parse(
    readFileSync(
      join(ROOT, "pid-reuse", ".specstride", "features", "151-reuse", "runs", "run-launch-p1", "lease.json"),
      "utf8",
    ),
  ) as { pid: number; starttime: number };
  const procs = JSON.parse(
    readFileSync(
      join(ROOT, "pid-reuse", ".specstride", "workspaces", "pidreuse000000001", "procs.json"),
      "utf8",
    ),
  ) as { processes: { pid: number; starttime: number }[] };
  const live = procs.processes.find((p) => p.pid === lease.pid);
  assert.ok(live, "the reused pid must be present in procs.json");
  assert.notEqual(live.starttime, lease.starttime); // reuse: more than 1 s apart
});

test("relaunch carries an earlier launch behind the relaunching one", () => {
  const supervision = JSON.parse(
    readFileSync(
      join(ROOT, "relaunch", ".specstride", "launches", "launch-r1", "supervision.json"),
      "utf8",
    ),
  ) as { state: string; previousLaunchId: string };
  assert.equal(supervision.state, "relaunching");
  assert.ok(
    existsSync(
      join(ROOT, "relaunch", ".specstride", "launches", supervision.previousLaunchId, "launch.json"),
    ),
  );
});

test("salted salts every member of the closed set Never in a view", () => {
  const ledger = JSON.parse(
    readFileSync(
      join(ROOT, "salted", ".specstride", "workspaces", "saltedws0000001", "features", "151-salted", "ledger.json"),
      "utf8",
    ),
  ) as { title: string };
  for (const member of [
    "/tmp/secret/path",
    "prompt",
    "reply",
    "tool argument",
    "command line",
    "signature",
    "key",
    "log line",
  ]) {
    assert.ok(ledger.title.includes(member), `the salted title misses "${member}"`);
  }
  assert.match(ledger.title, /\u0001/); // control characters
  assert.ok(Buffer.byteLength(ledger.title, "utf8") >= 2000); // over the 240-byte cut
  const tasks = readFileSync(join(ROOT, "salted", "specs", "151-salted", "tasks.md"), "utf8");
  assert.ok((tasks.match(/^- \[ \]/gm)?.length ?? 0) >= 500, "salted needs 500 unticked tasks");
  for (let i = 1; i <= 40; i++) {
    const n = String(i).padStart(2, "0");
    assert.ok(
      existsSync(join(ROOT, "salted", ".specstride", "launches", `launch-salt-${n}`, "launch.json")),
      `salted misses launch-salt-${n}`,
    );
  }
});

test("corpus-42 holds 42 features, 250 approvals and exactly one live run", () => {
  const features = readdirSync(join(ROOT, "corpus-42", "specs")).filter((n) => !n.startsWith("."));
  assert.equal(features.length, 42);
  let approvals = 0;
  const control = join(ROOT, "corpus-42", ".specstride", "workspaces", "c0rpus42fix0000a1");
  for (const feature of readdirSync(join(control, "features"))) {
    const dir = join(control, "features", feature, "approvals");
    if (existsSync(dir)) approvals += readdirSync(dir).filter((n) => n.endsWith(".json")).length;
  }
  assert.equal(approvals, 250);
  const procs = JSON.parse(readFileSync(join(control, "procs.json"), "utf8")) as {
    processes: { feature?: string }[];
  };
  const live = procs.processes.filter((p) => typeof p.feature === "string");
  assert.equal(live.length, 1);
  assert.equal(live[0].feature, "corpus-f00");
});

test("feature-150 records 10 approved phases and a completed pipeline state", () => {
  const control = join(ROOT, "feature-150", ".specstride", "workspaces", "150recorded0001");
  const approvals = readdirSync(join(control, "features", "150-host-hermes", "approvals")).filter((n) =>
    n.endsWith(".json"),
  );
  assert.equal(approvals.length, 10);
  for (const file of approvals) {
    const record = JSON.parse(readFileSync(join(control, "features", "150-host-hermes", "approvals", file), "utf8")) as {
      outcome: string;
    };
    assert.equal(record.outcome, "approved");
  }
  const states = readdirSync(
    join(ROOT, "feature-150", ".specstride", "state", "pipeline", "150-host-hermes", "runs"),
  );
  assert.ok(states.length >= 1);
});
