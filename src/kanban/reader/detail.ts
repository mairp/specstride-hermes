/*! PORT of portions of specstride-dsh packages/dsh-kanban/src/server/run-detail.ts (phase detail, usage and launch rows; workspace-view.ts:523-745).
 * Provenance: https://github.com/odanado/specstride-dsh (dsh-kanban), files
 * packages/dsh-kanban/src/server/run-detail.ts and packages/dsh-kanban/src/server/workspace-view.ts,
 * copied and adapted for Specstride (hermes) on 2026-11-11 by Specstride US6 (F151-FR-044, F151-FR-045).
 * SPDX-License-Identifier: MIT
 */

/**
 * The card detail of the workspace reader (T069; US6, cards/detail.md):
 * one PhaseDetail per phase of tasks.md and one FeatureDetail per feature,
 * every string redacted and bounded, every list bounded with its omitted
 * count. The detail is additive: a reader that cannot build one leaves the
 * card without it; nothing here throws out of the builder.
 */
import type { FilePort, ProcPort } from "./ports.ts";
import { readJsonRecord, listSafe, featureDirPath, controlFeatureDirPath, controlFeatureFilePath } from "./ports.ts";
import { JSON_RECORD_BYTES } from "./bounds.ts";
import type { ParsedScope } from "./tasks-md.ts";
import type { RunRecord, ProcEntry } from "./runs.ts";
import { isRunAlive } from "./runs.ts";
import type { LaunchRecord } from "./launches.ts";
import { capText, safePath, freeText, describeProcess, COMMIT_CAP, DETAIL_TEXT_CAP, EXIT_CAP, ID_CAP, MAX_AGENTS, MAX_ATTEMPTS, MAX_FILES, MAX_LAUNCHES, MAX_TASKS, NAME_CAP, TASK_TEXT_CAP } from "./redact.ts";
import { featureSessions, usageOf, type DetailUsage, type SessionSummary } from "./dsh-sessions.ts";

export interface DetailTask {
  id: string;
  text: string;
  done: boolean;
  parallel: boolean;
  verdict: "MET" | "UNMET" | null;
}

export interface DetailAttempt {
  attempt: number;
  run: string;
  launch: string | null;
  strategy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
  passes: number;
  errors: number;
}

export interface DetailLaunchRow {
  launch: string;
  reason: string | null;
  state: string | null;
  at: string | null;
  endedAt: string | null;
  exit: string | null;
  run: string | null;
  current: boolean;
}

export interface DetailAgent {
  role: string | null;
  what: string | null;
  since: string | null;
  pid: number | null;
  /** `true`/`false` when a registry entry or a live process decides; `null` when nothing names it (F151-FR-045). */
  alive: boolean | null;
  harness: string | null;
  profile: string | null;
  model: string | null;
}

export interface DetailApproval {
  at: string | null;
  attempt: number | null;
  critic: string | null;
  commit: string | null;
}

export interface DetailEvidence {
  name: string;
  bytes: number;
}

export interface DetailCounters {
  rejects: number;
  passErrors: number;
  noProgress: number;
  capHits: number;
}

/** One phase's detail (cards/detail.md PhaseDetail). */
export interface PhaseDetail {
  goal: string | null;
  independentTest: string | null;
  checkpoint: string | null;
  tasksDone: number;
  tasksTotal: number;
  tasks: DetailTask[];
  tasksOmitted: number;
  files: string[];
  filesOmitted: number;
  approval: DetailApproval | null;
  evidence: DetailEvidence | null;
  attempts: DetailAttempt[];
  attemptsOmitted: number;
  counters: DetailCounters | null;
  units: number | null;
  usage: DetailUsage | null;
  current: boolean;
}

/** One feature's detail (cards/detail.md FeatureDetail). */
export interface FeatureDetail {
  run: {
    id: string;
    launch: string | null;
    state: string;
    phase: number | null;
    startedAt: string | null;
    lastAt: string | null;
  } | null;
  agents: DetailAgent[];
  agentsNote: string | null;
  launches: DetailLaunchRow[];
  launchesOmitted: number;
  usage: DetailUsage | null;
  cost: string;
  limits: string;
  usageNote: string | null;
  /** The detail of the run's current phase, for the signature. */
  detail: PhaseDetail | null;
}

export interface DetailInputs {
  fs: FilePort;
  proc: ProcPort;
  workspace: string;
  /** The feature's control root. */
  root: string;
  home: string;
  feature: string;
  scope: ParsedScope;
  runs: readonly RunRecord[];
  chosen: RunRecord | null;
  launches: readonly LaunchRecord[];
  launch: LaunchRecord | null;
  /** The process registry, for agent liveness. */
  registry?: readonly ProcEntry[];
  nowMs: number;
}

export interface DetailResult {
  phases: Map<number, PhaseDetail>;
  feature: FeatureDetail;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The newest critic verdict per task id: `phase<N>.<k>.md` under the
 * control root's `feedback/`, then `set-aside/phase<N>/`, newest name wins. */
function feedbackVerdicts(fs: FilePort, root: string, feature: string, phase: number): Map<string, "MET" | "UNMET"> {
  const out = new Map<string, "MET" | "UNMET">();
  const dirs = [controlFeatureDirPath(root, feature, "feedback"), `${controlFeatureDirPath(root, feature, "set-aside")}/phase${String(phase)}`];
  for (const phaseRoot of dirs) {
    const names = listSafe(fs, phaseRoot)
      .filter((name) => new RegExp(`^phase${String(phase)}\\.\\d+\\.md$`).test(name))
      .sort();
    for (const name of names) {
      let text: string | null = null;
      try {
        const size = fs.size(`${phaseRoot}/${name}`);
        text = fs.read(`${phaseRoot}/${name}`).slice(0, Math.min(size, 256 * 1024));
      } catch {
        text = null;
      }
      if (text === null) continue;
      for (const match of text.matchAll(/^(T\d+[a-z]?):\s*(MET|UNMET)\b/gm)) {
        out.set(match[1] as string, match[2] as "MET" | "UNMET");
      }
    }
  }
  return out;
}

const ATTEMPT_OPEN = new Set(["attempt.started", "run.attempt.started"]);
const ATTEMPT_CLOSE = new Set(["attempt.ended", "run.attempt.ended", "phase.ended"]);

/** The attempts across all of the feature's runs, newest first, bounded. */
function attemptsOf(runs: readonly RunRecord[]): { attempts: DetailAttempt[]; omitted: number } {
  const open: DetailAttempt[] = [];
  const closed: DetailAttempt[] = [];
  for (const run of runs) {
    for (const event of run.events) {
      const launch = str(event.fields.launchId) ?? run.launchId;
      if (ATTEMPT_OPEN.has(event.type)) {
        open.push({
          attempt: num(event.fields.attempt) ?? closed.length + open.length + 1,
          run: capText(run.runId, ID_CAP),
          launch: launch === null ? null : capText(launch, ID_CAP),
          strategy: str(event.fields.strategy) === null ? null : capText(String(event.fields.strategy), TASK_TEXT_CAP),
          startedAt: event.at,
          endedAt: null,
          outcome: null,
          passes: 0,
          errors: 0,
        });
        continue;
      }
      if (event.type === "pass.started" || event.type === "pass.ended") {
        const current = open[open.length - 1];
        if (current !== undefined) current.passes += 1;
        continue;
      }
      if (event.type === "iter_error" || event.type === "job.failed") {
        const current = open[open.length - 1];
        if (current !== undefined) current.errors += 1;
        continue;
      }
      if (ATTEMPT_CLOSE.has(event.type)) {
        const index = (() => {
          const want = num(event.fields.attempt);
          if (want === null) return open.length - 1;
          return open.findIndex((attempt) => attempt.attempt === want);
        })();
        if (index < 0) continue;
        const [attempt] = open.splice(index, 1);
        attempt.endedAt = event.at;
        attempt.outcome = str(event.fields.outcome) === null ? null : capText(String(event.fields.outcome), 40);
        closed.push(attempt);
      }
    }
  }
  closed.push(...open);
  closed.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  const kept = closed.slice(0, MAX_ATTEMPTS);
  return { attempts: kept, omitted: closed.length - kept.length };
}

function countersOf(runs: readonly RunRecord[], ledger: Record<string, unknown> | null): DetailCounters | null {
  const derived: DetailCounters = { rejects: 0, passErrors: 0, noProgress: 0, capHits: 0 };
  for (const run of runs) {
    for (const event of run.events) {
      if (event.type === "reject" || event.type === "review.rejected") derived.rejects += 1;
      if (event.type === "iter_error" || event.type === "job.failed") derived.passErrors += 1;
      if (event.type === "no_progress") derived.noProgress += 1;
      if (event.type === "iter_cap" || event.type === "iter_cap_hit") derived.capHits += 1;
    }
  }
  const recorded = ledger !== null && typeof ledger.counters === "object" && ledger.counters !== null ? (ledger.counters as Record<string, unknown>) : null;
  if (recorded === null) return derived;
  return {
    rejects: num(recorded.rejects) ?? derived.rejects,
    passErrors: num(recorded.passErrors) ?? derived.passErrors,
    noProgress: num(recorded.noProgress) ?? derived.noProgress,
    capHits: num(recorded.capHits) ?? derived.capHits,
  };
}

function unitsOf(ledger: Record<string, unknown> | null): number | null {
  if (ledger === null) return null;
  const units = ledger.units;
  if (typeof units === "number") return units;
  if (typeof units === "object" && units !== null) return num((units as Record<string, unknown>).done);
  return null;
}

function ledgerOf(fs: FilePort, root: string, feature: string): Record<string, unknown> | null {
  try {
    const record = readJsonRecord(fs, controlFeatureFilePath(root, feature, "ledger"), JSON_RECORD_BYTES);
    return typeof record === "object" && record !== null ? (record as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function approvalOf(fs: FilePort, root: string, feature: string, phase: number): DetailApproval | null {
  const dir = controlFeatureDirPath(root, feature, "approvals");
  const record = readJsonRecord(fs, `${dir}/phase-${String(phase)}.json`, JSON_RECORD_BYTES) as Record<string, unknown> | null;
  if (record === null) return null;
  const outcome = str(record.outcome);
  if (outcome !== "approved" || record.voided === true) return null;
  const commit = str(record.commit);
  return {
    at: str(record.at) ?? str(record.recordedAt),
    attempt: num(record.attempt),
    critic: str(record.criticModel ?? record.critic) === null ? null : capText(String(record.criticModel ?? record.critic), NAME_CAP),
    commit: commit === null ? null : commit.replace(/[^0-9a-f]/gi, "").slice(0, COMMIT_CAP),
  };
}

function evidenceOf(fs: FilePort, workspace: string, feature: string): DetailEvidence | null {
  const dir = featureDirPath(workspace, feature, "evidence");
  const names = listSafe(fs, dir).filter((name) => name.toLowerCase().endsWith(".md")).sort();
  const name = names[0];
  if (name === undefined) return null;
  try {
    const bytes = fs.size(`${dir}/${name}`);
    const relative = `.specstride/features/${feature}/evidence/${name}`;
    return { name: safePath(relative, workspace, ""), bytes };
  } catch {
    return null;
  }
}

/** The agents of the chosen run: its events that name a pid or a role. */
function agentsOf(run: RunRecord | null, proc: ProcPort, registry: readonly ProcEntry[]): DetailAgent[] {
  if (run === null) return [];
  const byKey = new Map<string, DetailAgent>();
  for (const event of run.events) {
    const pid = num(event.fields.pid);
    const typeRole = event.type.startsWith("critic") ? "critic" : event.type.startsWith("proposer") ? "proposer" : event.type.startsWith("verify") ? "verifier" : null;
    const role = str(event.fields.role) ?? typeRole;
    if (pid === null && role === null) continue;
    const key = pid !== null ? `pid:${String(pid)}` : `role:${role}`;
    const alive = (() => {
      if (pid === null) return null;
      try {
        if (proc.stat(pid) !== null) return true;
      } catch {
        /* not observable */
      }
      const named = registry.filter((entry) => entry.runId === run.runId);
      if (named.length > 0) return false;
      return null;
    })();
    let described: { harness: string | null; profile: string | null; model: string | null } = { harness: null, profile: null, model: null };
    if (alive === true) {
      try {
        const raw = proc.cmdline(pid as number);
        const line = typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : null;
        described = describeProcess(line) ?? described;
      } catch {
        /* not observable */
      }
    }
    byKey.set(key, {
      role: role === null ? null : capText(role, 20),
      what: str(event.fields.what ?? event.fields.action) === null ? capText(event.type, 40) : capText(String(event.fields.what ?? event.fields.action), TASK_TEXT_CAP),
      since: event.at,
      pid,
      alive,
      harness: described.harness,
      profile: described.profile,
      model: described.model,
    });
  }
  return [...byKey.values()].slice(0, MAX_AGENTS);
}

function launchRows(launches: readonly LaunchRecord[], chosenLaunch: LaunchRecord | null, feature: string, currentLaunchId: string | null): { rows: DetailLaunchRow[]; omitted: number } {
  const own = launches
    .filter((launch) => launch.feature === null || launch.feature === feature)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const rows = own.slice(0, MAX_LAUNCHES).map((launch) => ({
    launch: capText(launch.launchId, ID_CAP),
    reason: launch.why === null ? null : capText(launch.why, TASK_TEXT_CAP),
    state: launch.state === null ? null : capText(launch.state, 40),
    at: launch.createdAt,
    endedAt: launch.endedAt,
    exit:
      launch.exitCode !== null
        ? capText(`exit ${String(launch.exitCode)}`, EXIT_CAP)
        : launch.exitSignal !== null
          ? capText(`signal ${launch.exitSignal}`, EXIT_CAP)
          : null,
    run: launch.runId === null ? null : capText(launch.runId, ID_CAP),
    current: currentLaunchId !== null && currentLaunchId === launch.launchId,
  }));
  return { rows, omitted: own.length - rows.length };
}

function usageOfFeature(fs: FilePort, home: string, workspace: string, feature: string, phases: readonly { number: number }[]): DetailUsage | null {
  try {
    const titles = new Set(phases.map((phase) => phase.number));
    const sessions: SessionSummary[] = featureSessions(fs, home, workspace, feature, titles);
    return sessions.length === 0 ? null : usageOf(sessions);
  } catch {
    return null;
  }
}

/**
 * The details of one feature. Never throws: an input that throws is read as
 * absent (F151-FR-045 — the detail stays additive).
 */
export function buildDetails(inputs: DetailInputs): DetailResult {
  const { fs, proc, workspace, root, home, feature, scope, runs, chosen, launches, launch, nowMs } = inputs;
  void nowMs;
  const registry = inputs.registry ?? [];
  const ledger = ledgerOf(fs, root, feature);
  const attempts = attemptsOf(runs);
  const counters = countersOf(runs, ledger);
  const units = unitsOf(ledger);
  const usage = usageOfFeature(fs, home, workspace, feature, scope.phases);
  const agents = agentsOf(chosen, proc, registry);
  // The phase the chosen run is on: its latest phase.started, cleared by a
  // later phase.ended.
  const currentPhase = (() => {
    if (chosen === null) return null;
    let current: number | null = null;
    for (const event of chosen.events) {
      if (event.type === "phase.started") current = num(event.fields.phase) ?? current;
      if (event.type === "phase.ended") current = null;
    }
    return current;
  })();
  const currentLaunchId = chosen?.launchId ?? (launch === null ? null : launch.launchId);
  const launchInfo = launchRows(launches, launch, feature, currentLaunchId);

  const phases = new Map<number, PhaseDetail>();
  for (const phase of scope.phases) {
    const verdicts = (() => {
      try {
        return feedbackVerdicts(fs, root, feature, phase.number);
      } catch {
        return new Map<string, "MET" | "UNMET">();
      }
    })();
    const tasks = phase.tasks.map((task) => ({
      id: capText(task.id, 40),
      text: freeText(task.text, TASK_TEXT_CAP),
      done: task.done,
      parallel: task.parallel,
      verdict: verdicts.get(task.id) ?? null,
    }));
    const keptTasks = tasks.slice(0, MAX_TASKS);
    const files = (phase.tasks.flatMap((task) => task.files) ?? []).map((file) => safePath(file, workspace, home));
    const keptFiles = files.slice(0, MAX_FILES);
    phases.set(phase.number, {
      goal: phase.goal === null || phase.goal === undefined ? null : freeText(phase.goal, DETAIL_TEXT_CAP),
      independentTest: phase.independentTest === null || phase.independentTest === undefined ? null : freeText(phase.independentTest, DETAIL_TEXT_CAP),
      checkpoint: phase.checkpoint === null || phase.checkpoint === undefined ? null : freeText(phase.checkpoint, DETAIL_TEXT_CAP),
      tasksDone: phase.tasks.filter((task) => task.done).length,
      tasksTotal: phase.tasks.length,
      tasks: keptTasks,
      tasksOmitted: tasks.length - keptTasks.length,
      files: keptFiles,
      filesOmitted: files.length - keptFiles.length,
      approval: (() => {
        try {
          return approvalOf(fs, root, feature, phase.number);
        } catch {
          return null;
        }
      })(),
      evidence: (() => {
        try {
          return evidenceOf(fs, workspace, feature);
        } catch {
          return null;
        }
      })(),
      attempts: attempts.attempts,
      attemptsOmitted: attempts.omitted,
      counters,
      units,
      usage,
      current: currentPhase === phase.number,
    });
  }
  const featureDetail: FeatureDetail = {
    run:
      chosen === null
        ? null
        : {
            id: capText(chosen.runId, ID_CAP),
            launch: launch === null ? null : capText(launch.launchId, ID_CAP),
            state: "running",
            phase: null,
            startedAt: chosen.firstAt,
            lastAt: chosen.lastAt,
          },
    agents,
    agentsNote: "critic and verifier calls leave no live record in this engine; they show as the lane only",
    launches: launchInfo.rows,
    launchesOmitted: launchInfo.omitted,
    usage,
    cost: "not reported",
    limits: "quota: not reported",
    usageNote: usage === null ? "usage: not reported (the proposer harness is not dsh, or no session of the feature is found)" : null,
    detail: null,
  };
  return { phases, feature: featureDetail };
}

/** The liveness helper the agents read; exported for the reader's wiring. */
export function aliveOfRun(proc: ProcPort, run: RunRecord, registry: readonly ProcEntry[]): boolean | null {
  if (isRunAlive(proc, run)) return true;
  if (registry.some((entry) => entry.runId === run.runId)) return false;
  return null;
}
