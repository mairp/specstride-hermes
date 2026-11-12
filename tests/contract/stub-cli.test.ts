/**
 * The stub CLI contract test (T003, PT-151-051): through the **real** shim
 * (`bin/specstride-hermes.mjs`, regenerated from `src/shim.ts`) with
 * `SPECSTRIDE_BIN` pointed at `tests/stubs/specstride`, a `status --json`
 * call logs exactly one probe (`probe: true`, argv `["--protocol"]`) and
 * exactly one verb (`probe: false`, argv `["status", "--json"]`), the probe
 * first; with `STUB_PROTOCOL=2` the shim exits 4 and no verb is logged.
 * The scripted steps (`{stdout, stderr, exit, delayMs}`) of F151 T003 are
 * answered verbatim: exit 70, exit 1 with the engine's `no-feature`
 * envelope, exit 0 with the empty view of engine `27e7d71b`, a body that is
 * not JSON, and a delayed answer. Nothing is called outside the fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesShimScript } from "../../src/shim.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");

type LogLine = { probe: boolean; argv: string[]; cwd: string; stdin?: string };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stub-cli-151-"));
  const bin = join(root, "bin");
  const home = join(root, "hermes-home");
  const script = join(root, "stub-script.json");
  const log = join(root, "stub-log.jsonl");
  const cgroup = join(root, "self-cgroup");
  const shimPath = join(bin, "specstride-hermes.mjs");
  mkdirSync(bin, { recursive: true });
  writeFileSync(shimPath, hermesShimScript());
  chmodSync(shimPath, 0o755);
  return {
    root,
    script,
    log,
    cgroup,
    shimPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    read(): LogLine[] {
      try {
        const text = readFileSync(log, "utf8").trim();
        return text === "" ? [] : (JSON.parse("[" + text.split("\n").join(",") + "]") as LogLine[]);
      } catch {
        return [];
      }
    },
    run(args: string[], env: Record<string, string | undefined>) {
      return spawnSync(shimPath, args, {
        encoding: "utf8",
        env: {
          PATH: `${join(process.execPath, "..")}`,
          HOME: home,
          HERMES_HOME: home,
          SPECSTRIDE_BIN: STUB_CLI,
          STUB_LOG: log,
          STUB_SCRIPT: script,
          SPECSTRIDE_CGROUP_FILE: cgroup,
          ...env,
        },
      });
    },
  };
}

/** The empty engine view of `27e7d71b` recorded on 2026-11-11 (U-151-01). */
const EMPTY_VIEW = JSON.stringify({
  schema: "specstride.view/1",
  workspace: "/nowhere/project",
  state: "none",
  runId: null,
  cards: [],
  attention: [],
});

test("a status --json call through the real shim logs exactly one probe and one verb, probe first", () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, JSON.stringify({ "status --json": { stdout: EMPTY_VIEW, exit: 0 } }));
    const run = fx.run(["status", "--json"], {});
    assert.equal(run.status, 0, `shim exit: ${run.status} stderr: ${run.stderr}`);
    const lines = fx.read();
    assert.equal(lines.length, 2, `log lines: ${JSON.stringify(lines)}`);
    assert.equal(lines[0].probe, true);
    assert.deepEqual(lines[0].argv, ["--protocol"]);
    assert.equal(lines[1].probe, false);
    assert.deepEqual(lines[1].argv, ["status", "--json"]);
    // The verb's answer reaches the caller verbatim.
    assert.equal((run.stdout ?? "").trim(), EMPTY_VIEW);
  } finally {
    fx.cleanup();
  }
});

test("STUB_PROTOCOL=2 makes the shim exit 4 and no verb is logged", () => {
  const fx = fixture();
  try {
    writeFileSync(fx.script, JSON.stringify({ "status --json": { stdout: EMPTY_VIEW, exit: 0 } }));
    const run = fx.run(["status", "--json"], { STUB_PROTOCOL: "2" });
    assert.equal(run.status, 4);
    assert.match(run.stdout ?? "", /\[SPECSTRIDE-REFUSE\] action=protocol/);
    const lines = fx.read();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].probe, true);
    assert.deepEqual(lines[0].argv, ["--protocol"]);
  } finally {
    fx.cleanup();
  }
});

test("the scripted steps of T003 pass through the shim verbatim", () => {
  const steps: Record<string, { stdout?: string; stderr?: string; exit: number; delayMs?: number }> = {
    // The engine's exit 70 (`reason="internal"` with --feature, U-151-01).
    "status --json": { stdout: "", stderr: '[SPECSTRIDE-ERR] reason="internal"', exit: 70 },
    // Exit 1 bare with the `no-feature` envelope.
    "wait --until-change --cursor 0 --timeout 25": {
      stdout: JSON.stringify({ error: "no-feature", feature: null }),
      exit: 1,
    },
  };
  const fx = fixture();
  try {
    writeFileSync(fx.script, JSON.stringify(steps));
    const r1 = fx.run(["status", "--json"], {});
    assert.equal(r1.status, 70);
    assert.match(r1.stderr ?? "", /SPECSTRIDE-ERR/);
    const r2 = fx.run(["wait", "--until-change", "--cursor", "0", "--timeout", "25"], {});
    assert.equal(r2.status, 1);
    assert.match(r2.stdout ?? "", /no-feature/);
    const verbs = fx.read().filter((line) => !line.probe);
    assert.deepEqual(
      verbs.map((line) => line.argv),
      [
        ["status", "--json"],
        ["wait", "--until-change", "--cursor", "0", "--timeout", "25"],
      ],
    );
  } finally {
    fx.cleanup();
  }
});

test("a non-JSON body and a delayed step are answered as scripted", async () => {
  const fx = fixture();
  try {
    writeFileSync(
      fx.script,
      JSON.stringify({
        "status --json": { stdout: "<html>not json</html>", exit: 0 },
        "wait --until-change": { stdout: EMPTY_VIEW, exit: 0, delayMs: 50 },
      }),
    );
    const r1 = fx.run(["status", "--json"], {});
    assert.equal(r1.status, 0);
    assert.equal((r1.stdout ?? "").trim(), "<html>not json</html>");
    const started = Date.now();
    const r2 = fx.run(["wait", "--until-change"], {});
    assert.equal(r2.status, 0);
    assert.ok(Date.now() - started >= 45, "the delayed step was not delayed");
    assert.equal(fx.read().filter((line) => !line.probe).length, 2);
  } finally {
    fx.cleanup();
  }
});
