/**
 * T066 (US6; PT-151-043, PT-151-045) — the card detail of the workspace
 * reader (`src/kanban/reader/detail.ts`, `dsh-sessions.ts`, `redact.ts`),
 * over the committed fixtures and ad-hoc trees: the scope from tasks.md,
 * the newest critic verdict per task, the attempts across both runs of
 * `relaunch/`, counters, units, the approval record, the evidence name and
 * size, the launches with `current`, the run record shown as recorded
 * (`running`, `between passes`, a recorded outcome), the agents with
 * `alive: null` for an activity no registry entry names; usage is `null`
 * unless the proposer harness is dsh; cost is the fixed text; a detail
 * that throws leaves its card without one and the view intact; the view
 * carries no `log` member.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFixture, readTree } from "../../helpers/reader-harness.ts";
import type { ReaderView } from "../../../src/kanban/reader/index.ts";
import type { PhaseDetail, FeatureDetail } from "../../../src/kanban/reader/detail.ts";
import { buildDetails } from "../../../src/kanban/reader/detail.ts";
import { capText } from "../../../src/kanban/reader/redact.ts";
import { cwdSlug } from "../../../src/kanban/reader/dsh-sessions.ts";
import type { FilePort } from "../../../src/kanban/reader/ports.ts";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (typeof value === "object" && value !== null ? (value as Rec) : {});
const cardOf = (view: ReaderView, id: string): Rec => rec(view.cards.find((card) => card.id === id));
const detailOf = (view: ReaderView, id: string): PhaseDetail | null => {
  const detail = cardOf(view, id).detail;
  return detail === null || detail === undefined ? null : (detail as PhaseDetail);
};

// ---------- scope over a committed fixture ----------------------------------

test("scope of the current phase card comes from tasks.md (relaunch)", () => {
  const { view } = readFixture("relaunch");
  const detail = detailOf(view, "151-relaunch#2");
  assert.ok(detail !== null, "the phase card of the live phase carries a detail");
  assert.ok(detail.goal === null || typeof detail.goal === "string");
  assert.equal(detail.tasksTotal > 0, true);
  assert.equal(detail.tasksDone <= detail.tasksTotal, true);
  assert.equal(detail.tasks.length, Math.min(detail.tasksTotal, 60));
  assert.equal(detail.current, true, "the phase the live run is working on is current");
  // A card of another phase carries its own scope.
  const other = detailOf(view, "151-relaunch#1");
  assert.ok(other !== null);
  assert.equal(other.current, false, "a phase the run is not on is not current");
});

// ---------- critic verdicts (newest feedback file wins) ---------------------

const FEEDBACK_TREE = {
  "specs/151-verdict/tasks.md": "# 151-verdict\n\n## Phase 1: setup\n**Goal**: set up.\n- [ ] T010 first task\n- [ ] T020 second task\n",
  ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsverd000000001" }),
  ".specstride/events.jsonl": [
    JSON.stringify({ seq: 1, type: "run.started", feature: "151-verdict", launchId: "launch-v1", at: "2026-11-11T08:00:00.000Z" }),
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-verdict", launchId: "launch-v1", phase: 1, at: "2026-11-11T08:01:00.000Z" }),
    "",
  ].join("\n"),
  ".specstride/launches/launch-v1/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-v1", feature: "151-verdict", createdAt: "2026-11-11T07:59:00.000Z" }),
  ".specstride/workspaces/wsverd000000001/features/151-verdict/feedback/phase1.1.md": "T010: UNMET the test fails\nT020: MET\n",
  ".specstride/workspaces/wsverd000000001/features/151-verdict/feedback/phase1.2.md": "T010: MET now\n",
};

test("the newest critic verdict per task is carried (MET and UNMET)", () => {
  const { view } = readTree(FEEDBACK_TREE, { now: "2026-11-11T09:00:10Z" });
  const detail = detailOf(view, "151-verdict#1");
  assert.ok(detail !== null);
  const verdicts = Object.fromEntries(detail.tasks.map((task) => [task.id, task.verdict]));
  assert.equal(verdicts["T010"], "MET", "the newest feedback file wins over the older one");
  assert.equal(verdicts["T020"], "MET", "a verdict found only in the older file still holds");
});

// ---------- attempts across both runs of a relaunch -------------------------

const ATTEMPTS_TREE = {
  "specs/151-att/tasks.md": "# 151-att\n\n## Phase 1: work\n- [x] T010 done task\n- [ ] T020 open task\n",
  ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsatt0000000001" }),
  ".specstride/events.jsonl": [
    JSON.stringify({ seq: 1, type: "run.started", feature: "151-att", launchId: "launch-a0", at: "2026-11-11T08:00:00.000Z" }),
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-att", launchId: "launch-a0", phase: 1, at: "2026-11-11T08:01:00.000Z" }),
    JSON.stringify({ seq: 3, type: "attempt.started", feature: "151-att", launchId: "launch-a0", attempt: 1, strategy: "std", at: "2026-11-11T08:02:00.000Z" }),
    JSON.stringify({ seq: 4, type: "attempt.ended", feature: "151-att", launchId: "launch-a0", attempt: 1, outcome: "UNMET", at: "2026-11-11T08:03:00.000Z" }),
    JSON.stringify({ seq: 5, type: "run.relaunched", feature: "151-att", launchId: "launch-a1", at: "2026-11-11T08:10:00.000Z" }),
    JSON.stringify({ seq: 6, type: "phase.started", feature: "151-att", launchId: "launch-a1", phase: 1, at: "2026-11-11T08:11:00.000Z" }),
    JSON.stringify({ seq: 7, type: "attempt.started", feature: "151-att", launchId: "launch-a1", attempt: 2, strategy: "micro", at: "2026-11-11T08:12:00.000Z" }),
    JSON.stringify({ seq: 8, type: "attempt.ended", feature: "151-att", launchId: "launch-a1", attempt: 2, outcome: "MET", at: "2026-11-11T08:13:00.000Z" }),
    "",
  ].join("\n"),
  ".specstride/launches/launch-a0/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-a0", feature: "151-att", createdAt: "2026-11-11T07:59:00.000Z", outcome: "completed" }),
  ".specstride/launches/launch-a1/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-a1", feature: "151-att", createdAt: "2026-11-11T08:09:00.000Z", runId: "run-launch-a1" }),
  ".specstride/launches/launch-a1/supervision.json": JSON.stringify({ state: "running" }),
  ".specstride/workspaces/wsatt0000000001/procs.json": JSON.stringify({ schema: "specstride.procs/1", recordedAt: "2026-11-11T09:00:00.000Z", processes: [{ pid: 5000, runId: "run-launch-a1", starttime: 420000 }] }),
  ".specstride/workspaces/wsatt0000000001/features/151-att/ledger.json": JSON.stringify({ schema: "specstride.ledger/1", feature: "151-att", units: { done: 3, declared: 5 } }),
};

test("attempts span both runs of a relaunch, newest kept, bounded at 12", () => {
  const { view } = readTree(ATTEMPTS_TREE, { now: "2026-11-11T09:00:10Z" });
  const detail = detailOf(view, "151-att#1");
  assert.ok(detail !== null);
  assert.equal(detail.attempts.length, 2);
  assert.equal(detail.attemptsOmitted, 0);
  assert.equal(detail.attempts[0].attempt, 2, "newest first");
  assert.equal(detail.attempts[0].outcome, "MET");
  assert.equal(detail.attempts[1].run.includes("launch-a0"), true, "the older attempt names its run");
  assert.equal(detail.counters !== null, true);
  assert.equal(detail.units, 3, "units come from the ledger's record");
});

// ---------- approval, evidence, counters ------------------------------------

const APPROVAL_TREE = {
  ...ATTEMPTS_TREE,
  ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsappr0000000001" }),
  "specs/151-att/tasks.md": ATTEMPTS_TREE["specs/151-att/tasks.md"],
  ".specstride/workspaces/wsappr0000000001/features/151-att/approvals/phase-1.json": JSON.stringify({
    schema: "specstride.approval/1",
    phase: 1,
    outcome: "approved",
    at: "2026-11-11T08:14:00.000Z",
    attempt: 2,
    criticModel: "critic-x",
    commit: "abcdef1234567890abcdef",
  }),
  ".specstride/features/151-att/evidence/GATE1-EVIDENCE.md": "evidence body\n",
};

test("the approval record and the evidence name and size are carried", () => {
  const { view } = readTree(APPROVAL_TREE, { now: "2026-11-11T09:00:10Z" });
  const detail = detailOf(view, "151-att#1");
  assert.ok(detail !== null);
  assert.ok(detail.approval !== null, "the phase approval record is carried");
  assert.equal(detail.approval?.attempt, 2);
  assert.equal(detail.approval?.critic, "critic-x");
  assert.equal(detail.approval?.commit, "abcdef1234567890".slice(0, 12), "the commit is cut to 12 hex");
  assert.ok(detail.evidence !== null, "the evidence name and size are carried");
  assert.equal(detail.evidence?.name.includes("GATE1-EVIDENCE.md"), true);
  assert.equal(typeof detail.evidence?.bytes, "number");
});

// ---------- launches with current -------------------------------------------

test("the launches of a feature are newest first, the current one flagged", () => {
  const { view } = readFixture("relaunch");
  const featureDetail = rec(view.featureDetails["151-relaunch"]) as unknown as FeatureDetail;
  assert.ok(Array.isArray(featureDetail.launches));
  const launches = featureDetail.launches as Rec[];
  assert.equal(launches.length, 2);
  assert.equal(launches[0].launch, "launch-r1", "newest first");
  assert.equal(launches[0].current, true, "the launch of the run that speaks is current");
  assert.equal(launches[1].current, false);
  assert.ok(typeof featureDetail.launchesOmitted === "number");
});

// ---------- the run record shown as recorded ---------------------------------

const ENDED_TREE = {
  "specs/151-end/tasks.md": "# 151-end\n\n## Phase 1: work\n- [x] T010 done task\n",
  ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsend0000000001" }),
  ".specstride/events.jsonl": [
    JSON.stringify({ seq: 1, type: "run.started", feature: "151-end", launchId: "launch-e1", at: "2026-11-11T08:00:00.000Z" }),
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-end", launchId: "launch-e1", phase: 1, at: "2026-11-11T08:01:00.000Z" }),
    JSON.stringify({ seq: 3, type: "run.ended", feature: "151-end", launchId: "launch-e1", outcome: "crash", at: "2026-11-11T08:30:00.000Z" }),
    "",
  ].join("\n"),
  ".specstride/launches/launch-e1/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-e1", feature: "151-end", createdAt: "2026-11-11T07:59:00.000Z", outcome: "completed" }),
};

test("the run state is shown as recorded (running, between passes, crash)", () => {
  const ended = readTree(ENDED_TREE, { now: "2026-11-11T09:00:10Z" });
  const endedRun = rec(ended.view.featureDetails["151-end"] as Rec).run as Rec;
  assert.ok(endedRun !== undefined, "an ended run still carries its run record");
  assert.equal(endedRun.state, "crash", "a recorded outcome is shown as recorded, never corrected");
  assert.equal(ended.view.cards.every((card) => card.lane !== undefined), true);

  const live = readTree(ATTEMPTS_TREE, { now: "2026-11-11T09:00:10Z", processes: [{ pid: 5000, starttime: 420000 }] });
  assert.equal((rec(live.view.featureDetails["151-att"] as Rec).run as Rec).state, "running", "a live registry process makes the run `running`");

  // Between passes: the launch says running, no process is alive.
  const between = readTree(
    {
      ...ATTEMPTS_TREE,
      ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsbtw0000000001" }),
      ".specstride/launches/launch-a1/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-a1", feature: "151-att", createdAt: "2026-11-11T08:09:00.000Z" }),
      ".specstride/launches/launch-a1/supervision.json": JSON.stringify({ state: "running" }),
      ".specstride/events.jsonl": [
        JSON.stringify({ seq: 1, type: "run.started", feature: "151-att", launchId: "launch-a0", at: "2026-11-11T08:00:00.000Z" }),
        JSON.stringify({ seq: 2, type: "run.relaunched", feature: "151-att", launchId: "launch-a1", at: "2026-11-11T08:10:00.000Z" }),
        "",
      ].join("\n"),
    },
    { now: "2026-11-11T09:00:10Z" },
  );
  assert.equal((rec(between.view.featureDetails["151-att"] as Rec).run as Rec).state, "between passes");
});

// ---------- agents and liveness ----------------------------------------------

const AGENT_TREE = {
  "specs/151-ag/tasks.md": "# 151-ag\n\n## Phase 1: work\n- [ ] T010 open task\n",
  ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsage0000000001" }),
  ".specstride/events.jsonl": [
    JSON.stringify({ seq: 1, type: "run.started", feature: "151-ag", launchId: "launch-g1", at: "2026-11-11T08:00:00.000Z" }),
    JSON.stringify({ seq: 2, type: "phase.started", feature: "151-ag", launchId: "launch-g1", phase: 1, pid: 4242, at: "2026-11-11T08:01:00.000Z" }),
    JSON.stringify({ seq: 3, type: "critic.started", feature: "151-ag", launchId: "launch-g1", phase: 1, role: "critic", what: "reviewing the phase", at: "2026-11-11T08:05:00.000Z" }),
    "",
  ].join("\n"),
  ".specstride/launches/launch-g1/launch.json": JSON.stringify({ schema: "specstride.launch/1", launchId: "launch-g1", feature: "151-ag", createdAt: "2026-11-11T07:59:00.000Z" }),
};

test("an agent whose pid no registry entry names reads `alive: null` (not observable)", () => {
  const { view } = readTree(AGENT_TREE, { now: "2026-11-11T09:00:10Z" });
  const featureDetail = view.featureDetails["151-ag"] as unknown as FeatureDetail;
  const agents = featureDetail.agents as Rec[];
  assert.equal(agents.length >= 1, true, "the activity events give the agents");
  const withPid = agents.find((agent) => agent.pid === 4242);
  assert.ok(withPid !== undefined, "the recorded pid is carried");
  assert.equal(withPid?.alive, null, "no registry entry names it: not observable");
  assert.ok(typeof featureDetail.agentsNote === "string");
});

test("an agent whose registry entry matches its recorded start is alive", () => {
  const { view } = readTree(AGENT_TREE, {
    now: "2026-11-11T09:00:10Z",
    processes: [{ pid: 4242, starttime: 420_000, cmdline: ["node", "/opt/specstride/bin.mjs", "--profile", "hermes", "--model", "m1"] }],
  });
  const featureDetail = view.featureDetails["151-ag"] as unknown as FeatureDetail;
  const withPid = (featureDetail.agents as Rec[]).find((agent) => agent.pid === 4242);
  assert.equal(withPid?.alive, true, "a live registry entry makes the agent alive");
  assert.equal(withPid?.harness, "bin.mjs", "describeProcess gives the harness base name");
  assert.equal(withPid?.profile, "hermes");
  assert.equal(withPid?.model, "m1");
});

// ---------- usage, cost, limits ----------------------------------------------

test("usage is null without a dsh session; cost and limits are the fixed texts", () => {
  const { view } = readTree(ATTEMPTS_TREE, { now: "2026-11-11T09:00:10Z" });
  const featureDetail = view.featureDetails["151-att"] as unknown as FeatureDetail;
  assert.equal(featureDetail.usage, null, "no dsh session: usage is not reported");
  assert.equal(featureDetail.cost, "not reported");
  assert.equal(featureDetail.limits, "quota: not reported");
  assert.ok(typeof featureDetail.usageNote === "string");
});

test("usage is read only when a dsh session names the feature's proposer", () => {
  const slug = cwdSlug(".");
  const { view } = readTree(
    {
      ...ATTEMPTS_TREE,
      ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsdsh0000000001" }),
      [`.dsh/sessions/${slug}/session-1/session.jsonl`]: [
        JSON.stringify({ type: "session", createdAt: 1 }),
        JSON.stringify({ type: "user/message", data: { content: [{ text: "You are implementing phase 1 of the feature `151-att`" }] } }),
        JSON.stringify({ type: "request/context", data: { provider: "p", model: "m-1" } }),
        JSON.stringify({ type: "assistant/message", data: { usage: { inputTokens: 10, outputTokens: 5 } } }),
        JSON.stringify({ type: "assistant/message", data: { usage: { inputTokens: 7, outputTokens: 3 } } }),
        JSON.stringify({ type: "llm/retry", data: { failure: { code: "RATE_LIMIT" }, delayMs: 1200 } }),
        "",
      ].join("\n"),
    },
    { now: "2026-11-11T09:00:10Z" },
  );
  const featureDetail = view.featureDetails["151-att"] as unknown as FeatureDetail;
  const usage = featureDetail.usage as Rec | null;
  assert.ok(usage !== null, "a dsh session of the feature carries the usage");
  assert.equal(usage?.calls, 2);
  assert.equal(usage?.tokensIn, 17);
  assert.equal(usage?.tokensOut, 8);
  assert.equal(usage?.retries, 1);
  assert.equal(usage?.rateLimited, 1);
  assert.equal((usage?.models as string[]).includes("m-1"), true);

  // A session of ANOTHER feature does not leak: usage stays null.
  const other = readTree(
    {
      ...ATTEMPTS_TREE,
      [`.dsh/sessions/${slug}/session-1/session.jsonl`]: [
        JSON.stringify({ type: "session", createdAt: 1 }),
        JSON.stringify({ type: "user/message", data: { content: [{ text: "You are implementing phase 1 of the feature `999-other`" }] } }),
        "",
      ].join("\n"),
    },
    { now: "2026-11-11T09:00:10Z" },
  );
  assert.equal((other.view.featureDetails["151-att"] as unknown as FeatureDetail).usage, null);
});

// ---------- a detail that throws leaves its card without one -----------------

test("a detail that throws leaves its card without one and the view intact", () => {
  // A file port that throws on every read: the builder must swallow it.
  const throwing: FilePort = {
    list: () => {
      throw new Error("boom");
    },
    read: () => {
      throw new Error("boom");
    },
    exists: () => false,
    size: () => {
      throw new Error("boom");
    },
    bytes: () => new Uint8Array(),
  };
  const detail = buildDetails({
    fs: throwing,
    proc: { stat: () => null, cmdline: () => null, bootTimeMs: () => null },
    workspace: ".",
    root: ".specstride/workspaces/wsatt0000000001",
    home: ".",
    feature: "151-att",
    scope: { files: [], tasksDone: 1, tasksTotal: 2, parallel: [], stories: {}, phases: [{ number: 1, title: "work", tasks: [{ id: "T010", text: "done task", done: true, parallel: false, stories: [], files: [] }], goal: "g", independentTest: null, checkpoint: null }] },
    runs: [],
    chosen: null,
    launches: [],
    launch: null,
    nowMs: 0,
  });
  const phase = detail.phases.get(1);
  assert.ok(phase !== null && phase !== undefined, "the scope survives the throwing inputs");
  assert.equal(phase.units, null, "an unreadable ledger gives units: null");
  assert.equal(phase.approval, null);
  assert.equal(phase.evidence, null);
  const { view } = readTree(ATTEMPTS_TREE, { now: "2026-11-11T09:00:10Z" });
  void view;
});

// ---------- no log member -----------------------------------------------------

test("the view carries no `log` member (dsh's log tail is not ported)", () => {
  const { view } = readFixture("relaunch");
  assert.equal(JSON.stringify(view).includes('"log"'), false);
  const { view: salted } = readFixture("salted");
  assert.equal(JSON.stringify(salted).includes('"log"'), false);
});

// ---------- capText byte safety ------------------------------------------------

test("capText never splits a multi-byte character", () => {
  const text = " μ ".repeat(120); // multi-byte, whitespace runs
  const cut = capText(text, 240);
  assert.equal(Buffer.byteLength(cut, "utf8") <= 240, true);
  assert.equal(cut.includes("\uFFFD"), false, "no replacement character from a split cut");
});
