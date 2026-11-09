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

// ---------------------------------------------------------------------------
// The hooks mirror (T060, PT-150-038 to PT-150-042, US6): the TypeScript
// reference hook functions of `src/glue-reference.ts` run over EVERY case of
// `tests/glue-fixtures/hooks.json` — the same golden file the pytest suite
// drives the registered Python hooks with.
// ---------------------------------------------------------------------------
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile as fsReadFile } from "node:fs/promises";
import { GUARD_RULES } from "../../src/guard.ts";
import {
  guardTableOf,
  hookStatusPaths,
  onSessionEnd,
  preLlmCall,
  preToolCall,
  type HookPayload,
} from "../../src/glue-reference.ts";

const SHIM_LAUNCH = "specstride-hermes launch --comment ship the parser";

const HOOKS = JSON.parse(
  readFileSync(join(HERE, "..", "glue-fixtures", "hooks.json"), "utf8"),
) as {
  workspace: string;
  key: string;
  cases: {
    name: string;
    hook: string;
    files: Record<string, string | Record<string, unknown>>;
    unreadable?: string;
    payload: {
      workspace: string;
      session_id: string;
      source: string | null;
      child: boolean;
      is_first_turn: boolean;
      last_seq_given: number | null;
      command: string | null;
      turn_exit_reason: string | null;
      provider: string | null;
    };
    expected: Record<string, string> | null;
    expect_file: Record<string, string> | null;
  }[];
};

/** Build a temporary HERMES_HOME holding the case's files. */
function prepareHome(item: (typeof HOOKS.cases)[number]): string {
  const home = mkdtempSync(join(tmpdir(), "hooks-"));
  for (const [relative, content] of Object.entries(item.files)) {
    const path = join(home, relative.replaceAll("@KEY@", HOOKS.key));
    mkdirSync(join(path, ".."), { recursive: true });
    if (typeof content === "string") {
      writeFileSync(path, content);
    } else if (content.rules === "as-written") {
      writeFileSync(path, JSON.stringify({ ...content, rules: GUARD_RULES }, null, 2) + "\n");
    } else {
      writeFileSync(path, JSON.stringify(content, null, 2) + "\n");
    }
  }
  // A directory in place of the line file makes the read raise.
  if (item.unreadable) {
    const path = join(home, item.unreadable.replaceAll("@KEY@", HOOKS.key));
    rmSync(path, { force: true });
    mkdirSync(path, { recursive: true });
  }
  return home;
}

function payloadOf(home: string, item: (typeof HOOKS.cases)[number]): HookPayload {
  return {
    home,
    workspace: item.payload.workspace,
    sessionId: item.payload.session_id,
    source: item.payload.source,
    child: item.payload.child,
    isFirstTurn: item.payload.is_first_turn,
    lastSeqGiven: item.payload.last_seq_given,
    command: item.payload.command,
    turnExitReason: item.payload.turn_exit_reason,
    provider: item.payload.provider,
  };
}

test("every golden hook case agrees with the reference", async () => {
  assert.ok(HOOKS.cases.length >= 15, `expected the full hook table in the fixtures, got ${HOOKS.cases.length}`);
  for (const item of HOOKS.cases) {
    const home = prepareHome(item);
    try {
      const payload = payloadOf(home, item);
      let result: unknown;
      if (item.hook === "pre_llm_call") result = preLlmCall(payload);
      else if (item.hook === "pre_tool_call") result = preToolCall(payload, guardTableOf(home));
      else result = onSessionEnd(payload, "2026-11-08T00:00:00Z");
      // The Python hook returns None here; the reference returns the write it
      // made, so for `on_session_end` the assertion is `expect_file` alone.
      if (item.hook !== "on_session_end") assert.deepEqual(result, item.expected, item.name);
      else assert.ok(item.expected === null, item.name);
      const expected = item.expect_file;
      if (expected === null) {
        const inbox = join(home, "specstride-host", "inbox");
        assert.ok(!existsSync(inbox) || readdirSync(inbox).length === 0, item.name);
      } else {
        const written = JSON.parse(
          await fsReadFile(join(home, "specstride-host", expected.path)),
        ) as Record<string, string>;
        assert.equal(written.kind, expected.kind, item.name);
        assert.equal(written.sessionId, expected.sessionId, item.name);
        assert.equal(written.provider, expected.provider, item.name);
      }
      // No hook leaves a temporary file behind (atomic writes only).
      const status = join(home, "specstride-host", "status");
      if (existsSync(status)) {
        for (const name of readdirSync(status)) assert.ok(!name.endsWith(".tmp"), item.name);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("the session-start line is given once and unchanged turns give nothing (PT-150-038/039)", () => {
  const home = mkdtempSync(join(tmpdir(), "hooks-"));
  mkdirSync(join(home, "specstride-host", "status"), { recursive: true });
  const { lineFile, seqFile } = hookStatusPaths(home, "/work/repo");
  writeFileSync(lineFile, "specstride run r-7 parked — gate G-2\n");
  writeFileSync(seqFile, "7\n");
  const base: HookPayload = {
    home,
    workspace: "/work/repo",
    sessionId: "s",
    source: null,
    child: false,
    isFirstTurn: true,
    lastSeqGiven: null,
    command: null,
    turnExitReason: null,
    provider: null,
  };
  assert.deepEqual(preLlmCall(base), { context: "Specstride: specstride run r-7 parked — gate G-2" });
  assert.equal(
    preLlmCall({ ...base, isFirstTurn: false, lastSeqGiven: 7 }),
    null,
    "an unchanged counter adds nothing",
  );
  assert.deepEqual(preLlmCall({ ...base, isFirstTurn: false, lastSeqGiven: 6 }), {
    context: "Specstride: specstride run r-7 parked — gate G-2",
  });
  rmSync(home, { recursive: true, force: true });
});

test("the guardrail never approves (PT-150-040)", () => {
  const home = mkdtempSync(join(tmpdir(), "hooks-"));
  mkdirSync(join(home, "specstride-host"), { recursive: true });
  writeFileSync(
    join(home, "specstride-host", "guard.json"),
    JSON.stringify({ schema: "specstride.guard/1", blocking: false, fix: null, rules: GUARD_RULES }),
  );
  const payload: HookPayload = {
    home,
    workspace: "/work/repo",
    sessionId: "s",
    source: null,
    child: false,
    isFirstTurn: true,
    lastSeqGiven: null,
    command: SHIM_LAUNCH,
    turnExitReason: null,
    provider: null,
  };
  const verdict = preToolCall(payload, guardTableOf(home));
  assert.equal(verdict, null, "an allowed launch gets no verdict, certainly not an approval");
  rmSync(home, { recursive: true, force: true });
});
