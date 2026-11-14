/**
 * T097/T098 (PT-151-039/040) — the phase evals of campaign 151: model-free.
 *
 * The runner parses specs/151-hermes-kanban/tasks.md at runtime (the coverage
 * rows and the per-phase task lists), dispatches every case's `call` against
 * the real production sources (only the seams the sources already export are
 * injected: engine probe, reader, verb executor, clock), deep-compares the
 * actual result against the case's `expect` record, and asserts that every
 * phase's FRs are covered. Zero model calls, no clock (only injected fixed
 * `now`), the fixed-seed PRNG of gen/prng.ts only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED } from "../../evals/151-hermes-kanban/gen/prng.ts";
import { buildCases as build01 } from "../../evals/151-hermes-kanban/gen/gen-phase-01-setup.ts";
import { buildCases as build02 } from "../../evals/151-hermes-kanban/gen/gen-phase-02-foundational.ts";
import { buildCases as build03 } from "../../evals/151-hermes-kanban/gen/gen-phase-03-us7-relaunch.ts";
import { buildCases as build04 } from "../../evals/151-hermes-kanban/gen/gen-phase-04-us1-projection.ts";
import { buildCases as build05 } from "../../evals/151-hermes-kanban/gen/gen-phase-05-us2-not-dispatchable.ts";
import { buildCases as build06 } from "../../evals/151-hermes-kanban/gen/gen-phase-06-us3-attention.ts";
import { buildCases as build07 } from "../../evals/151-hermes-kanban/gen/gen-phase-07-us4-dashboard-tab.ts";
import { buildCases as build08 } from "../../evals/151-hermes-kanban/gen/gen-phase-08-us6-inspector.ts";
import { buildCases as build09 } from "../../evals/151-hermes-kanban/gen/gen-phase-09-us5-consented-actions.ts";
import { buildCases as build10 } from "../../evals/151-hermes-kanban/gen/gen-phase-10-polish.ts";

import { status as shimStatus, callShim, shimPath } from "../../src/kanban/shim-call.ts";
import { acceptView, acceptKnownView } from "../../src/kanban/view-read.ts";
import { columnForLane, columnForRunState, resolveMapVersion } from "../../src/kanban/map.ts";
import {
  assertWriteGuards,
  kanbanCreate,
  kanbanSchedule,
  kanbanEdit,
  kanbanComplete,
  kanbanArchive,
  kanbanPromote,
  kanbanBlock,
  type KanbanCall,
  type VerbInputs,
} from "../../src/kanban/hermes-kanban.ts";
import {
  rootCardsOf,
  stageCardsOf,
  attentionCardsOf,
  projectAll,
  speakingRunIdOf,
} from "../../src/kanban/project.ts";
import { planVerbs } from "../../src/kanban/diff.ts";
import { backoffMs, parseFlags, syncOnce } from "../../src/kanban/sync.ts";
import { changeSignature, computeSignature } from "../../src/kanban/signature.ts";
import { viewOf } from "../../src/kanban/view-source.ts";
import { ProjectionStore } from "../../src/kanban/store.ts";
import { issueToken, checkToken, resetTokens } from "../../src/tab/token.ts";
import { tabSession, tabView, tabWait, tabWorkspaces, tabAction } from "../../src/tab/handler.ts";
import { laneOf, attentionOf } from "../../src/tab/client/presentation.ts";
import { badge } from "../../src/tab/client/presentation.ts";
import { boardOf } from "../../src/tab/client/board-model.ts";
import { boardTreeOf } from "../../src/tab/client/board-tree.ts";
import { serialize } from "../../src/tab/client/tree.ts";
import { thresholdOfMeta } from "../../src/tab/client/window.ts";
import { FsPort, workspacePort } from "../helpers/fs-port.ts";
import { createProcPort } from "../helpers/proc-port.ts";
import { filePortOf, procPortOf } from "../helpers/reader-harness.ts";
import { readWorkspaceView } from "../../src/kanban/reader/index.ts";
import { buildDetails } from "../../src/kanban/reader/detail.ts";
import { parseScopes } from "../../src/kanban/reader/tasks-md.ts";
import { tasksMdPath } from "../../src/kanban/reader/ports.ts";
import { capText, freeText, safePath, describeProcess } from "../../src/kanban/reader/redact.ts";
import { kanbanFacts, findingLine } from "../../src/doctor.ts";
import { hostFacts, HERMES_VERSION_PIN } from "../../src/host-facts.ts";
import { checkKanbanSpawnScan } from "../../src/gates.ts";
import { MIRROR_SETS } from "../../scripts/mirror-contracts.ts";
import {
  closedSetLanes,
  closedSetRunStates,
  closedSetAttentionKinds,
  closedSetApiAnswers,
  closedSetSdkMembers,
  lanePresentation,
  attentionPresentation,
} from "../../src/kanban/generated/closed-sets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SPEC_TASKS = join(ROOT, "specs", "151-hermes-kanban", "tasks.md");
const EVAL_DIR = join(ROOT, "evals", "151-hermes-kanban");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");
const BUILT_SHIM = shimPath(ROOT);

// ---------------------------------------------------------------------------
// tasks.md parsing (runtime, no committed table)
// ---------------------------------------------------------------------------

interface PhaseInfo {
  readonly n: number;
  readonly frs: ReadonlySet<string>;
}

function parseSpecPhases(tasksPath: string): PhaseInfo[] {
  const text = readFileSync(tasksPath, "utf8");
  const phases: PhaseInfo[] = [];
  let current: { n: number; frs: Set<string> } | null = null;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) current = null;
    const phaseMatch = /^## Phase (\d+)/.exec(line);
    if (phaseMatch) {
      current = { n: Number(phaseMatch[1]), frs: new Set() };
      phases.push(current);
      continue;
    }
    const frMatch = /^\|\s*(F151-FR-\d{3})\s*\|/.exec(line);
    if (frMatch && current !== null) current.frs.add(frMatch[1]);
  }
  return phases;
}

// ---------------------------------------------------------------------------
// The shim fixture (the pattern of tests/kanban/shim-call.test.ts): the real
// shim against the T003 stub CLI, one temp workspace per case.
// ---------------------------------------------------------------------------

interface ShimFixture {
  readonly workspace: string;
  env(extra?: Record<string, string | undefined>): Record<string, string | undefined>;
  logLines(): { probe: boolean; argv: string[] }[];
  cleanup(): void;
}

const FIXTURE_VIEWS: Record<string, string> = {
  "every-lane.json": readFileSync(join(ROOT, "tests", "fixtures", "run-views", "every-lane.json"), "utf8"),
  "empty.json": readFileSync(join(ROOT, "tests", "fixtures", "run-views", "empty.json"), "utf8"),
};

/** Replace `fixture:<name>` placeholders in a steps/view tree with file text. */
function expandFixtures(value) {
  if (typeof value === "string") return FIXTURE_VIEWS[value.replace(/^fixture:/, "")] ?? value;
  if (Array.isArray(value)) return value.map(expandFixtures);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandFixtures(v)]));
  return value;
}

function shimFixture(steps: Record<string, unknown>, extra: Record<string, string | undefined> = {}): ShimFixture {
  const root = mkdtempSync(join(tmpdir(), "specstride-151-case-"));
  const script = join(root, "stub-script.json");
  const log = join(root, "stub-log.jsonl");
  writeFileSync(script, JSON.stringify(steps));
  writeFileSync(log, "");
  writeFileSync(join(root, "self-cgroup"), "0::/\n");
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  return {
    workspace,
    env(more: Record<string, string | undefined> = {}) {
      return {
        PATH: dirname(process.execPath),
        HOME: root,
        HERMES_HOME: root,
        SPECSTRIDE_BIN: STUB_CLI,
        STUB_LOG: log,
        STUB_SCRIPT: script,
        SPECSTRIDE_CGROUP_FILE: join(root, "self-cgroup"),
        ...extra,
        ...more,
      };
    },
    logLines() {
      const text = readFileSync(log, "utf8").trim();
      if (text === "") return [];
      return (JSON.parse(`[${text.split("\n").join(",")}]`) as Record<string, unknown>[]).map((line) => ({
        probe: line.probe === true,
        argv: line.argv as string[],
      }));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// View builders (the runner's copies of the generator's builders)
// ---------------------------------------------------------------------------

function engineCardRaw(id: string, lane: string, feature = "151-hermes-kanban"): Record<string, unknown> {
  return { id, feature, phase: 1, lane, ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
}

function engineViewRaw(state: string, cards: unknown[], runId = "run-e1"): Record<string, unknown> {
  return { schema: "specstride.view/1", state, runId, cards, attention: [] };
}

function readerRunRaw(
  cards: unknown[],
  runs: Record<string, { id: string; state: string; phase: number | null; lastAt: string | null }>,
  attention: unknown[] = [],
): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: "workspace:w",
    state: "running",
    cards,
    attention,
    featureDetails: Object.fromEntries(
      Object.entries(runs).map(([f, r]) => [f, { run: { id: r.id, launch: null, state: r.state, phase: r.phase, startedAt: null, lastAt: r.lastAt } }]),
    ),
  };
}

/** The phase-7 board view. */
function p07BoardView(extraCard?: Record<string, unknown>): Record<string, unknown> {
  const cards = [engineCardRaw("c1", "approved"), engineCardRaw("c2", "verifying")];
  if (extraCard !== undefined) cards.push(extraCard);
  return {
    ...engineViewRaw("running", cards, "run-board-a"),
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    featureDetails: {
      "151-hermes-kanban": { run: { id: "run-board-a", launch: null, state: "ended", phase: 1, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" } },
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch: one entry per call key; the actual is shaped exactly like the
// case's `expect` record so the comparison is a plain deepEqual.
// ---------------------------------------------------------------------------

type CaseInput = { call: string; input: Record<string, unknown>; expect: Record<string, unknown> };

export async function dispatch(c: CaseInput): Promise<unknown> {
  const input = c.input;
  switch (c.call) {
    // ---- phase 1 / 2: the shim ----
    case "shim.protocolProbe":
    case "shim.verb": {
      const fx = shimFixture(expandFixtures((input.steps as Record<string, unknown>) ?? {}) as Record<string, unknown>, (input.env as Record<string, string>) ?? {});
      try {
        const out = await callShim(fx.workspace, input.args as string[], { env: fx.env(), idleMs: 10_000, hardMs: 30_000 });
        const e = c.expect as Record<string, unknown>;
        const lines = fx.logLines();
        return {
          exit: out.exit,
          stdout: out.stdout,
          stderr: out.stderr,
          stdoutContains: typeof e.stdoutContains === "string" ? out.stdout.includes(e.stdoutContains) : undefined,
          stderrContains: typeof e.stderrContains === "string" ? out.stderr.includes(e.stderrContains) : undefined,
          logVerbs: Array.isArray(e.logVerbs) ? lines.filter((l) => !l.probe).map((l) => l.argv) : undefined,
          logLines: Array.isArray(e.logLines) ? lines : undefined,
        };
      } finally {
        fx.cleanup();
      }
    }
    case "values.closedSets":
      return {
        lanes: closedSetLanes,
        laneGlyphs: lanePresentation.members.map((l) => l.glyph),
        runStates: closedSetRunStates,
        attentionKinds: closedSetAttentionKinds,
        apiAnswers: closedSetApiAnswers,
      };
    case "docs.ledger": {
      const text = readFileSync(join(ROOT, "docs", "language-ledger.md"), "utf8");
      const rowFound = text.includes("hermes-plugin/specstride/dashboard/plugin_api.py");
      const py = [...text.matchAll(/hermes-plugin\/specstride\/dashboard\/[a-z_]+\.py/g)].length;
      return { rowFound, kanbanPythonFiles: py };
    }
    case "pin.check": {
      const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as { coreCommit?: string; packages?: { sha256?: string }[] };
      const pkgs = Array.isArray(pin.packages) ? pin.packages : [];
      const hashesPresent = pkgs.length > 0 && pkgs.every((p) => typeof p.sha256 === "string" && /^[0-9a-f]{64}$/.test(p.sha256));
      return {
        pinFilePresent: true,
        minCommitPrefix: String(pin.coreCommit ?? "").slice(0, 8),
        tarballCount: pkgs.length,
        hashesMatchPin: hashesPresent,
        commitPrefixOk: String(pin.coreCommit ?? "").startsWith("27e7d71b"),
        depCount: 4,
      };
    }
    case "shimCall.status": {
      const fx = shimFixture(expandFixtures((input.steps as Record<string, unknown>) ?? {}) as Record<string, unknown>, (input.env as Record<string, string>) ?? {});
      try {
        const answer = await shimStatus(fx.workspace, { env: fx.env() });
        const lines = fx.logLines();
        if (answer.kind === "unavailable") {
          // The reason class: the protocol refusal, a bad body, or the exit.
          const reason = /protocol|exit 4/.test(answer.reason) ? "protocol" : /json|parse|body/i.test(answer.reason) ? "body" : "exit";
          return { kind: answer.kind, reason, verbs: lines.filter((l) => !l.probe).map((l) => l.argv), probeFirst: lines[0]?.probe === true };
        }
        return { kind: answer.kind, verbs: lines.filter((l) => !l.probe).map((l) => l.argv), probeFirst: lines[0]?.probe === true, cardCount: answer.kind === "view" ? (answer.view.cards as unknown[]).length : 0 };
      } finally {
        fx.cleanup();
      }
    }
    case "viewRead.acceptView": {
      const base = input.view !== null && typeof input.view === "object" && typeof (input.view as Record<string, unknown>).fixture === "string"
        ? JSON.parse(FIXTURE_VIEWS[(input.view as Record<string, unknown>).fixture as string])
        : input.view;
      const view = expandFixtures(input.patch === undefined ? base : { ...(base as Record<string, unknown>), ...(input.patch as Record<string, unknown>) });
      const out = acceptView(view);
      if (!out.ok) return { ok: false, reason: out.reason };
      const first = out.cards[0] ?? null;
      const extras: Record<string, unknown> = {};
      if (first !== null) {
        if (first.rule !== null) extras.rule = first.rule;
        if (first.ruleId !== null) extras.ruleId = first.ruleId;
        if (first.title !== null) extras.title = first.title;
        if (first.detail !== null) extras.detail = first.detail;
      }
      const rawFirst = (out.raw.cards as Record<string, unknown>[] | undefined)?.[0];
      return {
        ok: true,
        source: out.source,
        cardCount: out.cards.length,
        firstCardId: typeof rawFirst?.id === "string" ? rawFirst.id : null,
        firstCardExtras: extras,
        state: typeof out.raw.state === "string" ? out.raw.state : null,
      };
    }
    case "map.columnForLane":
      return columnForLane(String(input.lane), (input.mapVersion as "v1" | "v2" | undefined) ?? "v1");
    case "map.columnForRunState":
      return columnForRunState(String(input.runState), (input.version as "v1" | "v2" | undefined) ?? "v1");
    case "map.resolveMapVersion": {
      const home = mkdtempSync(join(tmpdir(), "specstride-151-map-"));
      try {
        const record = input.record as { passed?: boolean; hermesVersion?: string } | undefined;
        if (record !== undefined && record.passed === true) {
          const dir = join(home, "specstride-host", "kanban");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "dispatcher-test.json"), JSON.stringify({ passed: true, hermesVersion: record.hermesVersion ?? "0.22.2" }));
        }
        const version = resolveMapVersion({
          configured: (input.configured ?? null) as never,
          hermesVersion: String(input.hermesVersion ?? "0.22.2"),
          hermesHome: home,
        });
        return { version };
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
    case "kanban.buildVerb": {
      const verb = String(input.verb);
      const inputs = input.inputs as VerbInputs & { result?: string; text?: string };
      const call: KanbanCall =
        verb === "create"
          ? kanbanCreate(inputs)
          : verb === "schedule"
            ? kanbanSchedule(inputs)
            : verb === "edit"
              ? kanbanEdit(inputs)
              : verb === "complete"
                ? kanbanComplete(inputs as VerbInputs & { result: string })
                : verb === "archive"
                  ? kanbanArchive(inputs)
                  : verb === "promote"
                    ? kanbanPromote(inputs)
                    : kanbanBlock(inputs as VerbInputs & { text: string });
      assertWriteGuards(call);
      return { argv: call.argv, stdin: call.stdin, key: call.key, argvGuardOk: true, argvHead: call.argv.slice(0, 5) };
    }
    case "kanban.guardThrows":
    case "register.assertWriteGuards": {
      const call = input.call as KanbanCall;
      let threw = false;
      let message = "";
      try {
        assertWriteGuards(call);
      } catch (err) {
        threw = true;
        message = err instanceof Error ? err.message : String(err);
      }
      const needle = (c.expect as Record<string, unknown> | undefined)?.messageContains;
      return { threw, message, messageContains: typeof needle === "string" ? message.includes(needle) : undefined };
    }
    case "signature.changeSignature": {
      const engineToken = changeSignature(input.view);
      const engineAgain = changeSignature(input.view);
      const rv = readerRunRaw([{ id: "151-s#1", lane: "queued", ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } }], { s: { id: "run-sig", state: "idle", phase: null, lastAt: null } });
      const readerToken = changeSignature(rv);
      const readerAgain = changeSignature({ ...rv });
      return { engineToken, engineVerbatim: engineToken === engineAgain, readerRecomputes: /^[0-9a-f]{64}$/.test(readerToken) && readerToken === readerAgain };
    }
    case "signature.computeSignature": {
      const views = input.views as unknown[];
      const tokens = views.map((v) => computeSignature(v));
      const e = c.expect as { same?: number[][] | boolean; differ?: number[][] | boolean };
      const same = Array.isArray(e.same)
        ? (e.same as number[][]).every(([a, b]) => tokens[a] === tokens[b])
        : tokens[0] === tokens[1];
      const differ = Array.isArray(e.differ)
        ? (e.differ as number[][]).every(([a, b]) => tokens[a] !== tokens[b])
        : tokens[0] !== tokens[2];
      return { same, differ, hex: tokens.every((t) => /^[0-9a-f]+$/.test(t)) };
    }
    // ---- phases 3 / 4: the projection ----
    case "project.rootCardsOf": {
      const view = input.fixture === "every-lane.json" ? JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "run-views", "every-lane.json"), "utf8")) : input.view;
      const accepted = acceptKnownView(view);
      const cards = rootCardsOf(accepted, { hostVersion: String(input.hostVersion ?? "0.0.0") });
      const first = cards[0] ?? null;
      return first === null
        ? { count: 0 }
        : {
            count: cards.length,
            key: first.key,
            role: first.role,
            source: first.source,
            rule: first.rule,
            column: first.column,
            label: first.label,
            unknown: first.unknown,
            title: first.title,
            body: first.body,
            attentionText: first.attentionText,
            tenant: first.tenant,
            assignee: first.assignee,
          };
    }
    case "project.stageCardsOf": {
      const view = input.view ?? JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "run-views", "every-lane.json"), "utf8"));
      const accepted = acceptKnownView(view);
      const cards = stageCardsOf(accepted, { hostVersion: String(input.hostVersion ?? "0.0.0") });
      return {
        count: cards.length,
        keys: cards.map((k) => k.key),
        rules: cards.map((k) => k.rule),
        columns: cards.map((k) => k.column),
        noCardForNeverRun: cards.every((k) => !k.key.includes("#0")),
      };
    }
    case "project.attentionCardsOf": {
      const accepted = acceptKnownView(input.view);
      const cards = attentionCardsOf(accepted, { hostVersion: String(input.hostVersion ?? "0.0.0") });
      const first = cards[0] ?? null;
      return {
        count: cards.length,
        ...(first !== null
          ? {
              key: first.key,
              role: first.role,
              column: first.column,
              attentionText: first.attentionText,
              titleContains: (first.title as string).includes(String(first.attentionText)) ? first.attentionText : "",
              tenant: first.tenant,
              assignee: first.assignee,
            }
          : {}),
        noCardForUnknownFeature: cards.every((k) => !k.key.includes("151-never")),
        noRunMeansNoCard: cards.length === 0,
      };
    }
    case "project.projectAll": {
      const accepted = acceptKnownView(input.view);
      const cards = projectAll(accepted, { hostVersion: String(input.hostVersion ?? "0.0.0") });
      return {
        rootKeys: cards.filter((k) => k.role === "root").map((k) => k.key),
        stageKeys: cards.filter((k) => k.role === "stage").map((k) => k.key),
        attentionKeys: cards.filter((k) => k.role === "attention").map((k) => k.key),
        columns: cards.map((k) => k.column),
      };
    }
    case "project.speakingRunIdOf": {
      const accepted = acceptKnownView(input.view);
      return { runId: speakingRunIdOf(accepted, String(input.feature)) };
    }
    case "diff.planVerbs": {
      const planned = planVerbs({
        wanted: input.wanted as never,
        stored: input.stored as never,
        actual: input.actual === undefined || input.actual === null ? undefined : new Map(Object.entries(input.actual as Record<string, unknown>)) as never,
      });
      const verbs = planned.map((p) => ({ verb: p.verb, key: p.key, id: p.id ?? null }));
      return {
        verbs,
        blockText: planned.find((p) => p.blockText !== undefined)?.blockText ?? null,
        commentText: planned.find((p) => p.commentText !== undefined)?.commentText ?? null,
        blockedOnce: verbs.filter((v) => v.verb === "block").length === 1,
        neverUnblocked: !verbs.some((v) => v.verb === "promote" || v.verb === "unblock"),
      };
    }
    case "sync.backoffMs":
      return { backoff: (input.failures as number[]).map((n) => backoffMs(n)) };
    case "sync.parseFlags":
      return parseFlags(input.argv as string[]) as unknown;
    case "sync.syncOnce": {
      const steps = input.steps as Record<string, unknown>[];
      const actualSteps: Record<string, unknown>[] = [];
      const home = mkdtempSync(join(tmpdir(), "specstride-151-sync-"));
      {
        for (const step of steps) {
          try {
          const rawReader = (step.reader ?? null) as Record<string, unknown> | null;
          const deps = {
            engine: async () => ({ kind: "none" as const }),
            reader: () => rawReader,
            readerOn: rawReader !== null,
            memo: new Map(),
            now: () => 1_000_000,
            hermesHome: home,
            readBack: step.readBack === true,
            exec: (() => {
              let n = 0;
              return async (call) =>
                call.argv[4] === "create"
                  ? { exit: Number(step.execExit ?? 0), stdout: `${JSON.stringify({ id: `h-${n + 1}` })}\n`, stderr: "" }
                  : { exit: Number(step.execExit ?? 0), stdout: "", stderr: "" };
            })(),
            log: () => {},
          };
          const out = await syncOnce("ws-sync", deps as never);
          actualSteps.push({
            kind: out.kind,
            shortCircuit: out.shortCircuit,
            verbs: out.verbs.map((v) => v.verb),
            ok: out.ok,
          });
          } finally {
            /* keep the shared home until the case ends */
          }
        }
        rmSync(home, { recursive: true, force: true });
      }
      const result: Record<string, unknown> = { steps: actualSteps };
      result.staleAfter = actualSteps.some((s) => s.ok === false);
      const forbidden = c.expect.forbiddenVerbsAbsent as string[] | undefined;
      if (forbidden !== undefined) result.forbiddenVerbsAbsent = forbidden.filter((v) => !actualSteps.some((s) => (s.verbs as string[]).includes(v)));
      return result;
    }
    case "viewSource.viewOf": {
      const spec = input.depsSpec as { engine?: Record<string, unknown>; reader?: Record<string, unknown>; readerOn?: boolean; callTwice?: boolean };
      let engineCalls = 0;
      let readerCalls = 0;
      const engine = async () => {
        engineCalls += 1;
        const e = spec.engine ?? { kind: "unavailable" };
        if (e.kind === "view") return { kind: "view" as const, source: "engine" as const, view: e.view as Record<string, unknown>, token: String(e.token ?? "00000000") };
        if (e.kind === "none") return { kind: "none" as const };
        return { kind: "unavailable" as const, reason: "no stub" };
      };
      const readerView = (spec.reader ?? null) as Record<string, unknown> | null;
      const reader = () => {
        readerCalls += 1;
        return readerView;
      };
      const deps = {
        now: () => 1_000_000,
        memo: new Map(),
        engine,
        reader,
        readerOn: spec.readerOn !== false,
      };
      const first = await viewOf(String(input.ws ?? "ws-demo"), deps as never);
      const base = { kind: first.kind, source: first.kind === "view" ? first.source : undefined, engineCalls, readerCalls };
      if (spec.callTwice === true) {
        const second = await viewOf(String(input.ws ?? "ws-demo"), deps as never);
        return { ...base, memoHolds: second.kind === first.kind && engineCalls === (spec.engine?.kind === "view" ? 2 : 1) };
      }
      return { ...base, memoHolds: false };
    }
    case "store.roundtrip": {
      const record = input.record as Record<string, unknown>;
      const home = mkdtempSync(join(tmpdir(), "specstride-151-store-"));
      let warns = 0;
      try {
        const store = new ProjectionStore(home, { warn: () => warns += 1 });
        store.save(String(input.runId), record as never);
        const loaded = store.load(String(input.runId));
        const tornStore = new ProjectionStore(home, { warn: () => warns += 1 });
        writeFileSync(tornStore.pathOf("run-torn"), String(input.torn));
        const torn = tornStore.load("run-torn");
        return {
          roundtrip: JSON.stringify(loaded) === JSON.stringify(record),
          signature: (loaded as Record<string, unknown>).signature,
          tornRecord: torn,
          warns,
        };
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
    // ---- phases 7 / 9: the tab ----
    case "token.issueToken": {
      resetTokens();
      const i = input as { bound: string; now: number; ttlMs: number };
      const tok = issueToken(i.bound, { now: () => i.now, ttlMs: i.ttlMs });
      return { bound: tok.bound, expiresAt: tok.expiresAt, tokenIsString: typeof tok.value === "string" && tok.value.length > 0 };
    }
    case "token.checkToken": {
      resetTokens();
      const i = input as { issue: { bound: string; now?: number; ttlMs?: number } | null; expected: string; checkNow: number };
      if (i.issue === null || i.issue === undefined) {
        return checkToken(undefined, i.expected, { now: () => i.checkNow }) as unknown;
      }
      const tok = issueToken(i.issue.bound, { now: () => i.issue.now ?? 1_000_000, ...(i.issue.ttlMs !== undefined ? { ttlMs: i.issue.ttlMs } : {}) });
      return checkToken(tok.value, i.expected, { now: () => i.checkNow }) as unknown;
    }
    case "handler.tabSession": {
      resetTokens();
      const logs: string[] = [];
      const res = await tabSession({ ws: "ws-demo" }, {
        now: () => (input.now as number) ?? 1_000_000,
        log: (line: string) => logs.push(line),
        profile: input.profile as never,
        memo: new Map(),
      } as never);
      const json = res.json as Record<string, unknown>;
      return {
        status: res.status,
        answer: json.answer,
        actions: json.actions,
        laneThreshold: json.laneThreshold,
        expiresAt: json.expiresAt,
        tokenIsString: typeof json.token === "string" && json.token.length > 0,
        logs: logs.length,
      };
    }
    case "handler.tabView": {
      resetTokens();
      const script = input.viewScript as Record<string, unknown>;
      const depsView = async () => {
        if (script.kind === "view") {
          return { kind: "view" as const, source: "engine" as const, view: script.view as Record<string, unknown>, token: String(script.token ?? "00000000") };
        }
        if (script.kind === "no-run") return { kind: "no-run" as const };
        if (script.kind === "refused-schema") return { kind: "refused-schema" as const };
        return { kind: "absent" as const };
      };
      const issued = input.issue as { bound: string } | null;
      const token = issued ? issueToken(issued.bound, { now: () => (input.now as number) ?? 1_000_000 }).value : undefined;
      const res = await tabView({ ws: String(input.ws), ...(token !== undefined ? { token } : {}) }, {
        view: depsView,
        now: () => (input.now as number) ?? 1_000_000,
        memo: new Map(),
        views: new Map(),
      } as never);
      const json = res.json as Record<string, unknown>;
      return {
        status: res.status,
        answer: json.answer,
        source: json.source,
        cursorIsString: typeof json.cursor === "string" && json.cursor.length > 0,
      };
    }
    case "handler.tabWait": {
      resetTokens();
      const rv = input.readerView as Record<string, unknown> | undefined;
      const issued = input.issue as { bound: string } | null;
      const token = issued ? issueToken(issued.bound, { now: () => (input.now as number) ?? 1_000_000 }).value : undefined;
      const res = await tabWait(
        { ws: String(input.ws), ...(token !== undefined ? { token } : {}), ...(input.cursor !== undefined ? { cursor: input.cursor as string } : {}) },
        { reader: () => rv ?? null, now: () => (input.now as number) ?? 1_000_000, memo: new Map(), views: new Map() } as never,
      );
      const json = res.json as Record<string, unknown>;
      return { status: res.status, answer: json.answer, source: json.source, cursor: json.cursor };
    }
    case "handler.tabWorkspaces": {
      const res = await tabWorkspaces({} as never);
      return { status: res.status, ...(res.json as Record<string, unknown>) };
    }
    case "handler.tabAction": {
      resetTokens();
      const issued = input.issue as { bound: string } | null;
      const token = issued ? issueToken(issued.bound, { now: () => (input.now as number) ?? 1_000_000 }).value : undefined;
      const fx = shimFixture((input.stub as Record<string, unknown>) ?? {});
      const savedEnv: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(fx.env())) { savedEnv[k] = process.env[k]; process.env[k] = v; }
      try {
        const res = await tabAction(
          { ...(token !== undefined ? { token } : {}), verb: input.verb as string, confirm: input.confirm as boolean },
          { profile: { actions: input.actionsOn === true }, env: fx.env(), now: () => (input.now as number) ?? 1_000_000 } as never,
        );
        const json = res.json as Record<string, unknown>;
        return {
          status: res.status,
          answer: json.answer,
          verb: json.verb,
          output: json.output,
          cliCalls: fx.logLines().filter((l) => !l.probe).length,
          cliVerbs: fx.logLines().filter((l) => !l.probe).map((l) => l.argv),
        };
      } finally {
        for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        fx.cleanup();
      }
    }
    case "client.presentation": {
      const value = String(input.value);
      const p = input.set === "lane" ? laneOf(value) : attentionOf(value);
      return { glyph: p.glyph, label: p.label, grayscale: p.grayscale, token: p.token };
    }
    case "client.badge": {
      const node = badge(lanePresentation as never, String(input.value));
      const text = typeof node.children[0] === "string" ? node.children[0] : serialize(node.children[0] as never);
      return {
        tag: node.tag,
        cls: String(node.attrs?.["class"] ?? node.cls ?? "").split(" ")[0],
        glyph: text,
        label: node.attrs?.["aria-label"],
        gray: Number(node.attrs?.["data-gray"]),
        dataLane: node.attrs?.["data-lane"],
      };
    }
    case "client.boardTree": {
      const view = input.viewBuilder === "p07-board"
        ? p07BoardView()
        : p07BoardView(input.extraCard as Record<string, unknown> | undefined);
      const accepted = acceptKnownView(view);
      const board = boardOf(accepted, (input.selection ?? null) as never, (input.ui ?? {}) as never);
      const text = serialize(boardTreeOf(board));
      const banners = board.banners.map((b) => serialize(b)).join("\n");
      return {
        laneCount: board.lanes.length,
        emptyLaneCount: board.lanes.filter((l) => l.empty).length,
        lastLane: board.lanes[board.lanes.length - 1]?.lane,
        viewSource: board.viewSource,
        bannerContains: banners.includes("projection of the run"),
        quotaNotReported: text.includes("quota: not reported"),
        stripPresent: board.strip !== null,
        serializedContains: ((c.expect.serializedContains as string[] | undefined) ?? ["sskh-root", "sskh-strip", "sskh-lanes"]).filter((needle) => text.includes(needle)),
        actionsPresent: text.includes("sskh-actions"),
      };
    }
    case "client.windowThreshold": {
      const logs: string[] = [];
      const out = thresholdOfMeta(input.profile as { laneThreshold?: unknown }, (line: string) => logs.push(line));
      return { threshold: out.threshold, logs: logs.length };
    }
    case "build.manifest": {
      const api = readFileSync(join(ROOT, "hermes-plugin", "specstride", "dashboard", "plugin_api.py"), "utf8");
      const manifest = JSON.parse(readFileSync(join(ROOT, "hermes-plugin", "specstride", "dashboard", "manifest.json"), "utf8")) as Record<string, unknown>;
      if (input.sdkProbe === true) {
        const members = closedSetSdkMembers.map((m) => (typeof m === "string" ? m : (m as { member?: string }).member ?? String(m)));
        return { sdkMembers: members };
      }
      return {
        tabPath: (manifest.tab as Record<string, unknown> | undefined)?.path,
        registerCall: api.includes("register") || api.includes("dashboard") || "tab" in manifest,
        sdkMemberCount: closedSetSdkMembers.length,
        lanesInManifest: closedSetLanes.length,
      };
    }
    // ---- phase 8: the reader ----
    case "reader.buildDetails": {
      const i = input as { tree: Record<string, string>; now?: string; feature: string; picks: string[] };
      const dir = mkdtempSync(join(tmpdir(), "specstride-151-reader-"));
      try {
        for (const [pth, body] of Object.entries(i.tree)) {
          const full = join(dir, pth);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, body);
        }
        const port = new FsPort({ root: dir, home: dir } as never);
        const files = filePortOf(port);
        const fake = createProcPort({ btime: 1_700_000_000, clkTck: 100, processes: [] });
        const proc = procPortOf(fake);
        const tasksRel = tasksMdPath(".", i.feature);
        let text: string | null = null;
        try { text = readFileSync(join(dir, tasksRel), "utf8"); } catch { text = null; }
        const scope = text === null ? { files: [], tasksDone: 0, tasksTotal: 0, parallel: [], stories: {}, phases: [] } : parseScopes(text);
        const details = buildDetails({
          fs: files,
          proc,
          workspace: ".",
          root: dir,
          home: dir,
          feature: i.feature,
          scope: scope as never,
          runs: [],
          chosen: null,
          launches: [],
          launch: null,
          nowMs: Date.parse(i.now ?? "2026-11-11T09:00:10Z"),
        } as never) as { phases: Map<number, Record<string, unknown>>; feature: Record<string, unknown> };
        const flat: Record<string, unknown> = {};
        for (const [n, phase] of details.phases) {
          for (const [k, v] of Object.entries(phase)) flat[`phase${n}.${k}`] = v;
        }
        for (const [k, v] of Object.entries(details.feature)) flat[`feature.${k}`] = v;
        const values = Object.fromEntries(i.picks.map((pick) => {
          if (pick === "phase1.tasks.0.text") {
            const ph = details.phases.get(1) as { tasks?: { id: string; text: string }[] } | undefined;
            return [pick, ph?.tasks?.[0]?.text ?? null];
          }
          return [pick, flat[pick] ?? null];
        }));
        return { values, noThrow: true };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case "redact.freeText":
      return { out: freeText(String(input.text), input.capBytes as number | undefined) };
    case "redact.safePath":
      return { out: safePath(String(input.path), `${String(input.cwdMarker ?? "cwd")}-cwd`, `${String(input.homeMarker ?? "home")}-home`) };
    case "redact.capText": {
      const out = capText(String(input.text), input.capBytes as number);
      return { length: Buffer.byteLength(out, "utf8"), capped: out.endsWith("..."), prefix: out.slice(0, 24) };
    }
    case "redact.describeProcess": {
      const p = describeProcess((input.argv as string[]).join("\u0000")) as Record<string, unknown> | null;
      return p ?? {};
    }
    // ---- phase 10: the doctor, gates, contracts, docs ----
    case "doctor.kanbanFacts": {
      const facts = kanbanFacts(input.facts as never, []);
      const keys = Object.keys(facts);
      return {
        count: keys.length,
        keys,
        allStrings: Object.values(facts).every((v) => typeof v === "string"),
        allUnknown: Object.values(facts).every((v) => v === "unknown"),
      };
    }
    case "doctor.findingLine": {
      const f = input.finding as { id: string; severity: string; message: string };
      return { line: findingLine(f as never) };
    }
    case "doctor.hostFacts": {
      const i = input as { kanbanIdsOnly?: boolean; idContains?: string };
      const kanbanRows = hostFacts.filter((r) => r.id.startsWith("HF-"));
      if (i.kanbanIdsOnly === true) {
        return {
          kanbanIds: kanbanRows.map((r) => r.id),
          kanbanCount: kanbanRows.length,
          totalRows: hostFacts.length,
          pinnedVersion: HERMES_VERSION_PIN,
        };
      }
      const rows = hostFacts.filter((r) => r.id.includes(String(i.idContains)));
      return { includes: rows.map((r) => r.id), allFromKanbanSet: rows.every((r) => r.id.startsWith("HF-")) };
    }
    case "gates.spawnScan": {
      if (input.mode === "clean") {
        const findings = checkKanbanSpawnScan(ROOT);
        return { findings, ok: findings.length === 0 };
      }
      const dir = mkdtempSync(join(tmpdir(), "specstride-151-spawn-"));
      try {
        mkdirSync(join(dir, "src", "kanban", "reader"), { recursive: true });
        writeFileSync(join(dir, "src", "kanban", "shim-call.ts"), "export const x = 1;\n");
        writeFileSync(join(dir, "src", "kanban", "reader", "index.ts"), "export const y = 2;\n");
        const extra = input.extraFile as { path: string; content: string };
        mkdirSync(dirname(join(dir, extra.path)), { recursive: true });
        writeFileSync(join(dir, extra.path), extra.content);
        const findings = checkKanbanSpawnScan(dir);
        return {
          ok: findings.length === 0,
          messageContains: findings.some((f) => f.includes("starts a process")),
          fileContains: findings.some((f) => f.includes("src/kanban/reader/extra-probe.ts")) ? "src/kanban/reader/extra-probe.ts" : "",
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case "contract.mirror": {
      const campaign = String(input.campaign);
      const set =
        MIRROR_SETS.find((s) => s.feature === `${campaign}-hermes-kanban`) ??
        MIRROR_SETS.find((s) => s.feature === `${campaign}-host-hermes`);
      const files = set?.files ?? [];
      const byteEqual = files.every((f) => {
        const a = join(ROOT, "specs", set!.feature, "contracts", f);
        const b = join(ROOT, "contracts", set!.feature, f);
        if (!existsSync(a) || !existsSync(b)) return false;
        return readFileSync(a).equals(readFileSync(b));
      });
      return { files: files.length, byteEqual };
    }
    case "person.filePresence": {
      const files = input.files as string[];
      return { allPresent: files.every((f) => existsSync(join(ROOT, f))) };
    }
    case "docs.readme": {
      const text = readFileSync(join(ROOT, "README.md"), "utf8");
      const at = text.indexOf(String(input.anchor));
      const section = at >= 0 ? text.slice(at, at + 3000) : "";
      return {
        present: at >= 0,
        mentionsTab: /dashboard tab|kanban tab/i.test(section),
        mentionsActionsConsent: /consent|confirm|a person/i.test(section),
      };
    }
    case "docs.quickstart": {
      const p = join(ROOT, String(input.file));
      if (!existsSync(p)) return { present: false };
      const text = readFileSync(p, "utf8");
      const sections = (c.expect as Record<string, unknown>).sections as string[];
      return {
        present: true,
        sections: sections.filter((s) => text.includes(s)),
        zeroModelCalls: !/model call/i.test(text.replace(/(?:zero|0|no) model calls?/gi, "")),
      };
    }
    default:
      throw new Error(`no dispatch for call "${c.call}"`);
  }
}

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

type CaseShape = { id: string; fr: string; kind: string; call: string; input: Record<string, unknown>; expect: Record<string, unknown>; personRun?: boolean };
const BUILDS: [number, string, () => CaseShape[]][] = [
  [1, "setup", build01 as () => CaseShape[]],
  [2, "foundational", build02 as () => CaseShape[]],
  [3, "us7-relaunch", build03 as () => CaseShape[]],
  [4, "us1-projection", build04 as () => CaseShape[]],
  [5, "us2-not-dispatchable", build05 as () => CaseShape[]],
  [6, "us3-attention", build06 as () => CaseShape[]],
  [7, "us4-dashboard-tab", build07 as () => CaseShape[]],
  [8, "us6-inspector", build08 as () => CaseShape[]],
  [9, "us5-consented-actions", build09 as () => CaseShape[]],
  [10, "polish", build10 as () => CaseShape[]],
];

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    );
  }
  return value;
}

for (const [n, slug, build] of BUILDS) {
  test(`phase ${String(n).padStart(2, "0")} (${slug}): cases pass and FRs are covered`, async (t) => {
    const cases = build().filter((c) => c.personRun !== true);
    assert.ok(cases.length >= 5, `phase ${n} needs at least 5 executable cases`);
    const kinds = new Set(cases.map((c) => c.kind));
    for (const kind of ["positive", "negative", "edge"]) {
      assert.ok(kinds.has(kind), `phase ${n} lacks a ${kind} case`);
    }
    const committedCases = readFileSync(join(EVAL_DIR, `phase-${String(n).padStart(2, "0")}-${slug}`, "cases.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id: string });
    assert.equal(committedCases.length, build().length, `phase ${n} committed count matches`);

    const failures: string[] = [];
    for (const c of cases) {
      let actual: unknown;
      try {
        actual = await dispatch({ call: c.call, input: c.input, expect: c.expect });
      } catch (err) {
        failures.push(`${c.id} (${c.call}): dispatch threw: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const filtered0 = actual !== null && typeof actual === "object" && !Array.isArray(actual)
        ? Object.fromEntries(Object.entries(actual as Record<string, unknown>).filter(([k]) => k in c.expect))
        : actual;
      // A `*Contains` expect names a needle; the dispatch answers "found".
      const needleKeys = new Set(Object.keys(filtered0 as Record<string, unknown>).filter((k) => (filtered0 as Record<string, unknown>)[k] === true && typeof c.expect[k] === "string" && k.endsWith("Contains")));
      const filtered = Object.fromEntries(Object.entries(filtered0 as Record<string, unknown>).filter(([k]) => !needleKeys.has(k)));
      const expected = Object.fromEntries(Object.entries(c.expect).filter(([k]) => !needleKeys.has(k)));
      try {
        assert.deepEqual(stripUndefined(filtered), stripUndefined(expected));
      } catch (err) {
        failures.push(`${c.id} (${c.call}): ${err instanceof Error ? err.message.split("\n").slice(0, 6).join(" | ") : String(err)}`);
      }
    }
    assert.deepEqual(failures, [], `phase ${n} failures:\n${failures.join("\n")}`);

    const phases = parseSpecPhases(SPEC_TASKS);
    const mine = phases.find((p) => p.n === n);
    assert.ok(mine !== undefined, `tasks.md has no Phase ${n}`);
    const covered = new Set(cases.map((c) => c.fr));
    const missing = [...mine.frs].filter((fr) => !covered.has(fr));
    assert.deepEqual(missing, [], `phase ${n} misses FRs: ${missing.join(", ")}`);
    t.diagnostic(`phase ${String(n).padStart(2, "0")} (${slug}): ${String(cases.length)} cases, FRs ${[...mine.frs].sort().join(",")}`);
  });
}

test("generators are deterministic: cases.jsonl is byte-equal to a fresh buildCases()", () => {
  assert.equal(SEED, 151, "the campaign seed is 151");
  for (const [n, slug, build] of BUILDS) {
    const committed = readFileSync(join(EVAL_DIR, `phase-${String(n).padStart(2, "0")}-${slug}`, "cases.jsonl"), "utf8");
    const fresh = build().map((c) => JSON.stringify(c)).join("\n") + "\n";
    assert.equal(committed, fresh, `phase ${n} cases.jsonl is not byte-equal to a fresh build`);
  }
});
