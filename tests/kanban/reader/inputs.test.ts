/**
 * The reader's input tests (T014; PT-151-034): the bounds, the path builders
 * of the ten input rows, the test file port's refusal of a path outside the
 * closed set "Reader inputs", the static absence of any spawn, worker or
 * write API under `src/kanban/reader/`, and the tolerant reads (a torn JSON
 * line, an oversized record, an unreadable directory — all skipped, none
 * thrown).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OutsideReaderInputsError, FsPort, buildReaderInputsAllowList } from "../../../tests/helpers/fs-port.ts";
import {
  EVENT_TAIL_BYTES,
  JSON_RECORD_BYTES,
  TASKS_MD_BYTES,
} from "../../../src/kanban/reader/bounds.ts";
import {
  activePath,
  bashEventsPath,
  controlFeatureDirPath,
  controlFeatureFilePath,
  controlProcsPath,
  controlRoot,
  controlRunEventsPath,
  controlRunsPath,
  dshSessionsPath,
  featureDirPath,
  launchFilePath,
  launchesDirPath,
  leasePath,
  listSafe,
  nodeFilePort,
  nodeProcPort,
  pipelineStatePath,
  procPidPath,
  PROC_STAT_PATH,
  readEventTail,
  readJsonRecord,
  tasksMdPath,
  workspaceJsonPath,
} from "../../../src/kanban/reader/ports.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const READER_SRC = join(HERE, "..", "..", "..", "src", "kanban", "reader");

test("the bounds match the closed set: 8 MiB events, 256 KiB records, 2 MiB tasks.md", () => {
  assert.equal(EVENT_TAIL_BYTES, 8_388_608);
  assert.equal(JSON_RECORD_BYTES, 262_144);
  assert.equal(TASKS_MD_BYTES, 2_097_152);
});

test("the path builders spell the ten input rows of §7", () => {
  const ws = "/ws";
  const state = "/state";
  const root16 = controlRoot(state, "002a79217166a359");
  const full = controlRoot(state, "002a79217166a359f229bed6407c7301");
  assert.equal(tasksMdPath(ws, "f"), join(ws, "specs", "f", "tasks.md"));
  assert.equal(workspaceJsonPath(ws), join(ws, ".specstride", "workspace.json"));
  assert.equal(bashEventsPath(ws), join(ws, ".specstride", "events.jsonl"));
  assert.equal(featureDirPath(ws, "f", "gates"), join(ws, ".specstride", "features", "f", "gates"));
  assert.equal(featureDirPath(ws, "f", "evidence"), join(ws, ".specstride", "features", "f", "evidence"));
  assert.equal(launchFilePath(ws, "launch-a", "launch"), join(ws, ".specstride", "launches", "launch-a", "launch.json"));
  assert.equal(launchFilePath(ws, "launch-a", "runtime.status"), join(ws, ".specstride", "launches", "launch-a", "runtime.status.json"));
  assert.equal(launchesDirPath(ws), join(ws, ".specstride", "launches"));
  assert.equal(activePath(ws), join(ws, ".specstride", "active"));
  assert.equal(leasePath(ws, "f", "run-launch-a"), join(ws, ".specstride", "features", "f", "runs", "run-launch-a", "lease.json"));
  assert.equal(pipelineStatePath(ws, "f", "launch-a"), join(ws, ".specstride", "state", "pipeline", "f", "runs", "launch-a", "state.json"));
  // Both control-root spellings sit under $XDG_STATE_HOME.
  assert.equal(root16, join(state, "specstride", "workspaces", "002a79217166a359"));
  assert.equal(full, join(state, "specstride", "workspaces", "002a79217166a359f229bed6407c7301"));
  assert.equal(controlRunEventsPath(root16, "r-1"), join(root16, "runs", "r-1", "events.jsonl"));
  assert.equal(controlRunsPath(root16), join(root16, "runs"));
  assert.equal(controlProcsPath(root16), join(root16, "procs.json"));
  assert.equal(controlFeatureDirPath(root16, "f", "approvals"), join(root16, "features", "f", "approvals"));
  assert.equal(controlFeatureFilePath(root16, "f", "ledger"), join(root16, "features", "f", "ledger.json"));
  assert.equal(controlFeatureFilePath(root16, "f", "loop"), join(root16, "features", "f", "loop.json"));
  assert.equal(procPidPath(7, "stat"), "/proc/7/stat");
  assert.equal(procPidPath(7, "cmdline"), "/proc/7/cmdline");
  assert.equal(PROC_STAT_PATH, "/proc/stat");
  assert.equal(dshSessionsPath("/home", "slug"), join("/home", ".dsh", "sessions", "slug"));
});

test("a path outside the closed set throws in the test file port", () => {
  const port = new FsPort({ root: "/ws", home: "/home" });
  // Inside the list: no throw.
  assert.doesNotThrow(() => port.exists("specs/f/tasks.md"));
  assert.throws(() => port.readFile("runtime.log"), OutsideReaderInputsError);
  assert.throws(() => port.stat("kanban.db"), OutsideReaderInputsError);
  assert.throws(
    () => port.readFile(".specstride/features/f/runtime.log"),
    OutsideReaderInputsError,
  );
  // The allowlist compiled from the closed set is non-empty and covers both
  // control-root spellings.
  const allow = buildReaderInputsAllowList();
  assert.ok(allow.length >= 10);
  assert.ok(allow.some((re) => re.test("/.specstride/workspaces/002a79217166a359/runs/r/events.jsonl")));
});

test("the node file port performs only reads", () => {
  const fx = mkdtempSync(join(tmpdir(), "reader-ports-"));
  try {
    mkdirSync(join(fx, "dir"), { recursive: true });
    writeFileSync(join(fx, "dir", "a.txt"), "hello", "utf8");
    const port = nodeFilePort();
    assert.deepEqual(port.list(join(fx, "dir")), ["a.txt"]);
    assert.equal(port.read(join(fx, "dir", "a.txt")), "hello");
    assert.equal(port.exists(join(fx, "dir", "a.txt")), true);
    assert.equal(port.size(join(fx, "dir", "a.txt")), 5);
    assert.deepEqual(Buffer.from(port.bytes(join(fx, "dir", "a.txt"), 4)).toString(), "hell");
  } finally {
    rmSync(fx, { recursive: true, force: true });
  }
});

test("the /proc port reads stat, cmdline and the boot time", () => {
  const proc = nodeProcPort();
  const self = process.pid;
  const stat = proc.stat(self);
  assert.ok(stat !== null && stat.startsWith(`${self} (`), `stat of self: ${stat ?? "null"}`);
  assert.ok(typeof proc.bootTimeMs() === "number");
  // A gone pid reads as null, never a throw.
  assert.equal(proc.stat(2 ** 22), null);
  assert.equal(proc.cmdline(2 ** 22), null);
});

test("no file under src/kanban/reader/ spawns, threads or writes", () => {
  const forbidden =
    /\b(child_process|worker_threads|writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|truncateSync|ftruncateSync|chmodSync|chownSync|unlinkSync|rmdirSync|rmSync|renameSync|mkdirSync|mkdtempSync|cpSync|copyFileSync|spawn|spawnSync|execFile|execSync|fork)\b/;
  for (const name of readdirSync(READER_SRC)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(READER_SRC, name), "utf8");
    // Strip comments so prose about the rule is not mistaken for code.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const match = forbidden.exec(code);
    assert.equal(match, null, `${name} uses the forbidden API "${match?.[1] ?? ""}"`);
  }
});

test("a torn JSON line, an oversized record and an unreadable directory are skipped without a throw", () => {
  const fx = mkdtempSync(join(tmpdir(), "reader-torn-"));
  try {
    const dir = join(fx, "runs");
    mkdirSync(dir, { recursive: true });
    const events = [
      JSON.stringify({ seq: 1, type: "phase.started", phase: 1 }),
      JSON.stringify({ seq: 2, type: "pass.started" }),
      '{"seq":3,"type":"pass.star', // torn tail
      "not json at all", // malformed line
      "",
    ].join("\n");
    writeFileSync(join(dir, "events.jsonl"), events, "utf8");
    writeFileSync(join(fx, "big.json"), JSON.stringify({ big: "x".repeat(300_000) }), "utf8");
    writeFileSync(join(fx, "torn.json"), '{"half":', "utf8");
    const port = nodeFilePort();
    const tail = readEventTail(port, join(dir, "events.jsonl"), EVENT_TAIL_BYTES);
    assert.deepEqual(
      tail.lines,
      [
        JSON.stringify({ seq: 1, type: "phase.started", phase: 1 }),
        JSON.stringify({ seq: 2, type: "pass.started" }),
      ],
      "the torn and malformed lines are skipped",
    );
    assert.equal(tail.lastSeq, 2);
    // An oversized record is skipped.
    assert.equal(readJsonRecord(port, join(fx, "big.json"), JSON_RECORD_BYTES), null);
    // A torn record is skipped.
    assert.equal(readJsonRecord(port, join(fx, "torn.json"), JSON_RECORD_BYTES), null);
    // An unreadable directory is skipped, not thrown.
    assert.deepEqual(listSafe(port, join(fx, "does-not-exist")), []);
    assert.deepEqual(listSafe(port, join(dir, "events.jsonl")), []); // a file is not a directory
    // A missing event stream yields the empty fold, not a throw.
    assert.deepEqual(readEventTail(port, join(dir, "missing.jsonl"), EVENT_TAIL_BYTES), {
      lines: [],
      offset: 0,
      lastSeq: 0,
    });
  } finally {
    rmSync(fx, { recursive: true, force: true });
  }
});
