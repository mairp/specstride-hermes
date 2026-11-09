/**
 * The glue-reference tests of US3 (T039, PT-150-028, PT-150-029, PT-150-030):
 * `src/glue-reference.ts` — the TypeScript reference of the `/specstride`
 * slash-command table — runs over EVERY case of
 * `tests/glue-fixtures/slash-command.json`, and the state-changing verbs
 * forward only what was typed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runSlashCommand,
  decideSlashArgs,
  normalizeSlashArgs,
  REFUSED_REPLY,
  RUN_INVOCATION_REPLY,
  DRY_RUN_INVOCATION_REPLY,
  CLI_NOT_FOUND_REPLY,
  NOT_INSTALLED_REPLY,
  SLASH_COMMAND_VERBS,
} from "../../src/glue-reference.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = "/opt/specstride/bin/specstride-hermes";
const CONTROL = "/opt/specstride/bin/specstride-host-hermes";
const PATHS = { shim: SHIM, control: CONTROL };
const CWD = "/work/repo";

type FixtureCase = {
  name: string;
  raw_args: string;
  cwd: string;
  expected_argv: readonly string[] | null;
  stub_result: { exit: number; stdout: string; stderr: string };
  expected_reply: string;
};

const fixture = JSON.parse(
  readFileSync(join(HERE, "..", "glue-fixtures", "slash-command.json"), "utf8"),
) as { cases: FixtureCase[] };

function expand(argv: readonly string[] | null): readonly string[] | null {
  if (argv === null) return null;
  return argv.map((entry) =>
    entry === "$SHIM" ? SHIM : entry === "$CONTROL" ? CONTROL : entry,
  );
}

test("every golden case of the slash-command contract agrees with the reference", () => {
  assert.ok(fixture.cases.length >= 10, `expected the full contract in the fixtures, got ${fixture.cases.length}`);
  for (const item of fixture.cases) {
    const outcome = runSlashCommand(item.raw_args, PATHS, item.cwd, item.stub_result);
    assert.deepEqual(outcome.argv, expand(item.expected_argv), item.name);
    assert.equal(outcome.reply, item.expected_reply, item.name);
    if (outcome.argv !== null) assert.equal(outcome.cwd, item.cwd, item.name);
  }
});

test("PT-150-030: the accepted verbs are exactly the closed set", () => {
  assert.deepEqual([...SLASH_COMMAND_VERBS], [
    "run",
    "dry-run",
    "status",
    "stop",
    "stop --now",
    "resume",
    "doctor",
  ]);
});

test("PT-150-029: stop, stop --now and resume forward exactly the typed argv", () => {
  assert.deepEqual(decideSlashArgs("stop", PATHS, CWD).argv, [SHIM, "stop"]);
  assert.deepEqual(decideSlashArgs("stop --now", PATHS, CWD).argv, [SHIM, "stop", "--now"]);
  assert.deepEqual(decideSlashArgs("resume", PATHS, CWD).argv, [SHIM, "resume"]);
  // The verbs never carry more than what was typed: no default, no flag added.
  for (const verb of ["stop", "stop --now", "resume"]) {
    const decision = decideSlashArgs(verb, PATHS, CWD);
    assert.ok(decision.argv !== null);
    assert.equal(decision.argv.length, verb.split(" ").length + 1);
  }
});

test("PT-150-030: run and dry-run start nothing and reply with the skill invocation", () => {
  const ok = { exit: 0, stdout: "", stderr: "" };
  assert.equal(runSlashCommand("run", PATHS, CWD, ok).argv, null);
  assert.equal(runSlashCommand("run", PATHS, CWD, ok).reply, RUN_INVOCATION_REPLY);
  assert.equal(runSlashCommand("dry-run", PATHS, CWD, ok).argv, null);
  assert.equal(runSlashCommand("dry-run", PATHS, CWD, ok).reply, DRY_RUN_INVOCATION_REPLY);
});

test("PT-150-030: anything else is refused with the list of accepted verbs", () => {
  const ok = { exit: 0, stdout: "", stderr: "" };
  for (const verb of ["deploy", "launch", "contract", "wait", "STOP", "status --json", ""]) {
    const outcome = runSlashCommand(verb, PATHS, CWD, ok);
    assert.equal(outcome.argv, null, verb);
    assert.equal(outcome.reply, REFUSED_REPLY, verb);
    assert.match(outcome.reply, /run, dry-run, status, stop, stop --now, resume, doctor/);
  }
});

test("exit 127 maps to the install line and exit 4 relays the refusal verbatim", () => {
  const missing = { exit: 127, stdout: "", stderr: "no CLI\n" };
  assert.equal(runSlashCommand("status", PATHS, CWD, missing).reply, CLI_NOT_FOUND_REPLY);
  const refusal = {
    exit: 4,
    stdout: "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch\n",
    stderr: "",
  };
  assert.equal(
    runSlashCommand("stop", PATHS, CWD, refusal).reply,
    "[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch",
  );
});

test("a missing _paths.json replies not-installed and forwards nothing", () => {
  const nowhere = { shim: null, control: null };
  const ok = { exit: 0, stdout: "would have run\n", stderr: "" };
  for (const verb of ["status", "doctor", "stop", "resume"]) {
    const outcome = runSlashCommand(verb, nowhere, CWD, ok);
    assert.equal(outcome.argv, null, verb);
    assert.equal(outcome.reply, NOT_INSTALLED_REPLY, verb);
  }
});

test("normalization collapses whitespace and tolerates a leading slash", () => {
  assert.equal(normalizeSlashArgs("  stop   --now "), "stop --now");
  assert.equal(normalizeSlashArgs("/status"), "status");
  assert.deepEqual(decideSlashArgs("/stop --now", PATHS, CWD).argv, [SHIM, "stop", "--now"]);
});
