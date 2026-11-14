/**
 * The dashboard API handler tests (T053; contracts/151-hermes-kanban/plugin-api.md).
 *
 * Every route answers from the closed set `closedSetApiAnswers`; `GET session`
 * carries `token`, `expiresAt`, `actions` and `laneThreshold` from the profile
 * configuration (an invalid threshold is sent as 100 and logged once). Auth is
 * Hermes session + the run-bound token: no session or no token is a 401 with 0
 * CLI calls; a foreign run is a 409 `run-changed`. Over ALL routes the stub
 * CLI log holds only `status --json` and `wait --until-change …` verbs (the
 * shim's `--protocol` probe is tagged `probe: true` and not counted), a reader
 * view's `wait` makes NO CLI call (the reader signature is compared with the
 * cursor), the handler writes no file and holds only the newest view per token
 * plus the 60 s engine memo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tabSession,
  tabView,
  tabWait,
  tabWorkspaces,
  tabAction,
  type HandlerDeps,
} from "../../src/tab/handler.ts";
import { closedSetApiAnswers } from "../../src/kanban/generated/closed-sets.ts";
import { issueToken, checkToken } from "../../src/tab/token.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");

/** A reader view with one card (the reader is an injectable seam, no file). */
function readerView(runId: string, signature: string): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId,
    state: "running",
    cards: [{ id: "c1", feature: "001-x" }],
    attention: [],
    budget: [],
    phases: [],
    featureDetails: {},
    cursor: { offset: 1, lastSeq: 1 },
    signature: { token: signature },
  };
}

/** One fixture per test: stub CLI on the log, a token bound to the run. */
function fixture(options: { profile?: HandlerDeps["profile"]; reader?: HandlerDeps["reader"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tab-handler-151-"));
  const log = join(root, "stub-log.jsonl");
  const script = join(root, "stub-script.json");
  writeFileSync(log, "");
  writeFileSync(script, "{}");
  const previous = {
    SPECSTRIDE_BIN: process.env.SPECSTRIDE_BIN,
    STUB_LOG: process.env.STUB_LOG,
    STUB_SCRIPT: process.env.STUB_SCRIPT,
  };
  process.env.SPECSTRIDE_BIN = STUB_CLI;
  process.env.STUB_LOG = log;
  process.env.STUB_SCRIPT = script;

  const deps: HandlerDeps = {
    profile: options.profile ?? { actions: false },
    reader: options.reader,
    memo: new Map<string, number>(),
    views: new Map<string, unknown>(),
    log: () => {},
  };

  return {
    root,
    deps,
    /** Every recorded call, probes included. */
    read(): { probe: boolean; argv: string[] }[] {
      const text = readFileSync(log, "utf8").trim();
      if (text === "") return [];
      return JSON.parse(`[${text.split("\n").join(",")}]`) as { probe: boolean; argv: string[] }[];
    },
    /** Verbs only: the probe of the shim is not a verb of this feature. */
    verbs(): string[][] {
      return this.read().filter((line) => !line.probe).map((line) => line.argv);
    },
    /** Names of every file and directory under the fixture root. */
    files(): string[] {
      return readdirSync(root);
    },
    cleanup() {
      Object.assign(process.env, previous);
      for (const key of ["SPECSTRIDE_BIN", "STUB_LOG", "STUB_SCRIPT"]) {
        if (previous[key as keyof typeof previous] === undefined) delete process.env[key];
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const RUN = "run-abc-123";

async function withToken(
  options: Parameters<typeof fixture>[0],
  fn: (fx: ReturnType<typeof fixture>, token: string) => Promise<void>,
): Promise<void> {
  const fx = fixture(options);
  try {
    const token = issueToken(RUN, { now: () => Date.parse("2026-11-11T12:00:00.000Z") });
    await fn(fx, token.value);
  } finally {
    fx.cleanup();
  }
}

test("every route answers with an answer of the closed set", async () => {
  await withToken({}, async (fx, token) => {
    const answers = [
      (await tabSession({ ws: "ws" }, fx.deps)).json,
      (await tabView({ ws: "ws", token }, fx.deps)).json,
      (await tabWait({ ws: "ws", token, cursor: "sig" }, fx.deps)).json,
      (await tabWorkspaces(fx.deps)).json,
    ];
    for (const body of answers) {
      const record = body as { answer?: unknown };
      assert.ok(
        typeof record.answer === "string" && (closedSetApiAnswers as readonly string[]).includes(record.answer),
        `answer "${record.answer}" is a member of closedSetApiAnswers`,
      );
    }
  });
});

test("session carries actions and laneThreshold from the profile configuration", async () => {
  await withToken({ profile: { actions: true, laneThreshold: 250 } }, async (fx, token) => {
    const body = (await tabSession({ ws: "ws" }, fx.deps)).json as {
      token?: string;
      expiresAt?: number;
      actions?: boolean;
      laneThreshold?: number;
    };
    assert.equal(body.actions, true, "actions mirrors specstride.kanban.actions");
    assert.equal(body.laneThreshold, 250, "laneThreshold mirrors specstride.kanban.laneThreshold");
    assert.equal(typeof body.token, "string", "session carries the run-bound token");
    assert.equal(typeof body.expiresAt, "number", "session carries expiresAt");
    assert.ok(
      typeof token === "string" && token.length > 0,
      "the issueToken seam hands out a token for the other routes",
    );
  });
});

test("an invalid configured laneThreshold is sent as 100 and logged once", async () => {
  const fx = fixture({ profile: { laneThreshold: 0 } });
  try {
    const lines: string[] = [];
    fx.deps.log = (line) => lines.push(line);
    const body = (await tabSession({ ws: "ws" }, fx.deps)).json as { laneThreshold?: number };
    assert.equal(body.laneThreshold, 100, "an invalid threshold is sent as 100");
    assert.equal(lines.length, 1, "the invalid threshold is logged exactly once");
  } finally {
    fx.cleanup();
  }
});

test("a request without a session or without the run-bound token gets 401 and 0 CLI calls", async () => {
  await withToken({}, async (fx, token) => {
    void token;
    for (const attempt of [
      tabView({ ws: "ws" }, fx.deps),
      tabWait({ ws: "ws", cursor: "sig" }, fx.deps),
      tabAction({ verb: "stop", confirm: true }, fx.deps),
    ]) {
      const res = await attempt;
      assert.equal(res.status, 401, `a request without a token is 401, got ${res.status}`);
    }
    assert.equal(fx.read().length, 0, "an unauthenticated request makes 0 CLI calls (probes included)");
  });
});

test("a token bound to another run gets 409 with answer run-changed", async () => {
  await withToken({}, async (fx, token) => {
    const foreign = issueToken("run-other-999", { now: () => Date.parse("2026-11-11T12:00:00.000Z") });
    void token;
    const gate = checkToken(foreign.value, RUN);
    assert.equal(gate.ok, false, "a foreign binding fails the gate");
    assert.equal(gate.status, 409, "a foreign binding is 409");
    const res = await tabView({ ws: "ws", token: foreign.value }, fx.deps);
    assert.equal(res.status, 409, "the route answers 409");
    assert.equal((res.json as { answer?: string }).answer, "run-changed", "the answer is run-changed");
  });
});

test("over all routes the stub CLI log holds only the closed-set verbs", async () => {
  await withToken({}, async (fx, token) => {
    await tabSession({ ws: "ws" }, fx.deps);
    await tabView({ ws: "ws", token }, fx.deps);
    await tabWait({ ws: "ws", token, cursor: "sig" }, fx.deps);
    await tabWorkspaces(fx.deps);
    for (const argv of fx.verbs()) {
      const isStatus =
        argv.length === 2 && argv[0] === "status" && argv[1] === "--json";
      const isWait =
        argv[0] === "wait" && argv[1] === "--until-change" && argv[2] === "--cursor" &&
        argv[4] === "--timeout";
      assert.ok(
        isStatus || isWait,
        `argv [${argv.join(" ")}] is a verb of the closed set (probes are tagged, not verbs)`,
      );
    }
  });
});

test("a reader view's wait makes NO CLI call: the signature is compared with the cursor", async () => {
  await withToken(
    { reader: () => readerView(RUN, "reader-sig-1") },
    async (fx, token) => {
      const res = await tabWait({ ws: "ws", token, cursor: "reader-sig-1" }, fx.deps);
      assert.equal((res.json as { answer?: string }).answer, "unchanged", "an equal signature is unchanged");
      assert.equal(fx.read().length, 0, "a reader wait makes 0 CLI calls (probes included)");
    },
  );
});

test("the handler writes no file and holds only the newest view per token plus the memo", async () => {
  await withToken({}, async (fx, token) => {
    const before = fx.files().sort().join(",");
    const memo = fx.deps.memo as Map<string, number>;
    const views = fx.deps.views as Map<string, unknown>;
    assert.ok(memo instanceof Map, "the memo is a Map (workspace → until-ms)");
    assert.ok(views instanceof Map, "the newest views live in a Map keyed by token");
    await tabView({ ws: "ws", token }, fx.deps);
    await tabView({ ws: "ws2", token }, fx.deps);
    assert.equal(
      fx.files().sort().join(","),
      before,
      `no new file under the fixture root: ${fx.files().sort().join(",")}`,
    );
    assert.ok(memo.size <= 64, "the memo holds at most 64 workspaces");
    assert.ok(views.size <= 2, "the handler holds only the newest view per token");
  });
});
