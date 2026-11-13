/**
 * The run records of the workspace reader (T023; US7, F151-FR-037).
 *
 * A run record is what a run's sources agree on: an id, a feature, a first
 * and last event time, the parsed events, and the live process entries the
 * procs.json registry holds for it. Three sources feed it — the TS engine's
 * control root (`runs/<runId>/events.jsonl`), the bash engine's stream
 * (`.specstride/events.jsonl`, grouped by launch id), and the lease
 * directories (`.specstride/features/<f>/runs/run-launch-<name>/lease.json`).
 * Title attribution decides whether a control-root run belongs to a
 * feature; `loop.json` names a run only when no run of the feature matches
 * by titles. Liveness is the three-part check of §2.6: the pid must exist,
 * must not be a zombie, and its kernel start time must match the recorded
 * one within the tolerance of the closed set.
 *
 * dsh source: packages/dsh-kanban/src/server/run-detail.ts @ ab8093e
 * (isAlive, readProcRegistry, pickRun).
 */
import { readEventTail, readJsonRecord, listSafe, controlRunsPath, controlRunEventsPath, controlProcsPath, controlFeatureFilePath, leasePath } from "./ports.ts";
import { parseEvents, foldEvents, type ParsedEvent, type RunFacts } from "./events.ts";
import { EVENT_TAIL_BYTES, JSON_RECORD_BYTES } from "./bounds.ts";
import { closedSetEndRules } from "../generated/closed-sets.ts";

/** The start-time tolerance of the liveness check (§2.6), from the set. */
export const START_TOLERANCE_MS: number = closedSetEndRules.constants.startToleranceMs;
/** The silence after which a run without a launch reads as ended. */
export const SILENT_RUN_MS: number = closedSetEndRules.constants.silentRunMs;
/** How long a live run may go without an event before its card is stale. */
export const STALE_AFTER_MS: number = closedSetEndRules.constants.staleAfterMs;

const CLK_TCK = 100; // the clock ticks per second the recorded times use

/** One live process entry the registry holds for a run. */
export interface ProcEntry {
  pid: number | null;
  runId: string;
  /** The recorded kernel start time in ms since the epoch, or null. */
  startedAtMs: number | null;
}

/** What the run's sources agree on (data-model.md RunRecord). */
export interface RunRecord {
  runId: string;
  feature: string | null;
  /** The launch the run's own records name (a lease, a launch id field). */
  launchId: string | null;
  /** The ISO time of the oldest parsed event (a lease's acquire), or null. */
  firstAt: string | null;
  /** The ISO time of the newest parsed event, or null. */
  lastAt: string | null;
  events: ParsedEvent[];
  /** The registry entries whose recorded start time still matches. */
  live: ProcEntry[];
}

/** An ISO time in ms since the epoch, or null. */
export function isoMs(at: string | null | undefined): number | null {
  if (typeof at !== "string") return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/** Recorded clock ticks → ms since boot (the recorded registry form). */
export function ticksToMs(ticks: number, _bootTimeMs: number | null): number {
  return (ticks * 1000) / CLK_TCK;
}

/**
 * The kernel start time of a pid, in ms since the epoch, read from
 * `/proc/<pid>/stat` (field 22). Null when the pid is gone or the proc
 * port cannot see the boot time.
 */
export function procStartedAtMs(proc: { stat(pid: number): string | null; bootTimeMs(): number | null }, pid: number): number | null {
  const line = proc.stat(pid);
  if (line === null) return null;
  // The comm field may hold spaces and parentheses: everything after its
  // closing parenthesis is the numbered field list.
  const close = line.lastIndexOf(")");
  if (close < 0) return null;
  const fields = line.slice(close + 2).split(" ");
  const ticks = Number(fields[19]); // field 22 overall = index 19 after comm
  if (!Number.isFinite(ticks)) return null;
  return ticksToMs(ticks, proc.bootTimeMs());
}

/**
 * The liveness of one process (§2.6): it must exist, must not be a zombie
 * (or otherwise dead), and when a start time was recorded its kernel start
 * time must match within the tolerance of the closed set. A recorded time
 * that cannot be re-read (no boot time) falls back to existence.
 */
export function isAlive(proc: { stat(pid: number): string | null; bootTimeMs(): number | null }, pid: number, startedAtMs: number | null): boolean {
  if (pid === null) return false;
  const line = proc.stat(pid);
  if (line === null) return false;
  const close = line.lastIndexOf(")");
  if (close < 0) return true; // existence is the answer
  const fields = line.slice(close + 2).split(" ");
  const state = fields[0] ?? "";
  if (state === "Z" || state === "X") return false;
  if (startedAtMs === null) return true; // no recorded start: existence is the answer
  const actual = procStartedAtMs(proc, pid);
  if (actual === null) return true;
  return Math.abs(actual - startedAtMs) <= START_TOLERANCE_MS;
}

/** Whether any registry entry of the run still holds a live process. */
export function isRunAlive(proc: { stat(pid: number): string | null; bootTimeMs(): number | null }, run: RunRecord): boolean {
  return run.live.some((entry) => isAlive(proc, entry.pid, entry.startedAtMs));
}

/** Parse a procs.json record — the fixture list form and the dsh map form. */
export function parseProcRegistry(record: unknown): ProcEntry[] {
  const entries: ProcEntry[] = [];
  if (record === null || typeof record !== "object") return entries;
  const body = record as Record<string, unknown>;
  const list = body.processes;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item === null || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const runId = typeof row.runId === "string" ? row.runId : typeof row.launchId === "string" ? `run-${row.launchId}` : null;
      if (runId === null) continue;
      const ticks = typeof row.recordedStarttime === "number" ? row.recordedStarttime : typeof row.starttime === "number" ? row.starttime : null;
      const pid = typeof row.pid === "number" ? row.pid : null;
      entries.push({ pid, runId, startedAtMs: ticks === null ? null : (ticks * 1000) / CLK_TCK });
    }
  }
  for (const [key, value] of Object.entries(body)) {
    if (key === "schema" || key === "recordedAt" || key === "processes") continue;
    if (value === null || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const runId = typeof row.runId === "string" ? row.runId : key.startsWith("run:") ? key.split(":")[1] ?? null : null;
    if (runId === null) continue;
    const startedAtMs = typeof row.startedAtMs === "number" ? row.startedAtMs : typeof row.starttime === "number" ? (row.starttime * 1000) / CLK_TCK : null;
    entries.push({ pid: typeof row.pid === "number" ? row.pid : null, runId, startedAtMs });
  }
  return entries;
}

/** The procs.json of the control root: entries, or none. */
export function readProcRegistry(file: { size(path: string): number; read(path: string): string }, root: string): ProcEntry[] {
  return parseProcRegistry(readJsonRecord(file, controlProcsPath(root), JSON_RECORD_BYTES));
}

function newRun(runId: string, feature: string | null): RunRecord {
  return { runId, feature, launchId: null, firstAt: null, lastAt: null, events: [], live: [] };
}

function absorb(run: RunRecord, events: ParsedEvent[]): void {
  for (const event of events) {
    run.events.push(event);
    if (run.firstAt === null || (event.at !== null && event.at < run.firstAt)) run.firstAt = event.at;
    if (run.lastAt === null || (event.at !== null && event.at > run.lastAt)) run.lastAt = event.at;
  }
}

/** Fold a run's events once (the facts every lane decision reads). */
export function factsOf(run: RunRecord | null): RunFacts {
  return run === null ? foldEvents([]) : foldEvents(run.events);
}

/**
 * The control-root runs whose phase titles match the feature's tasks.md
 * titles; `loop.json` names a run only when no run matched by titles.
 * dsh: run-detail.ts pickRun's title attribution.
 */
export function runsFromControlRoot(
  file: { size(path: string): number; read(path: string): string; exists(path: string): boolean },
  root: string,
  feature: string,
  titles: ReadonlySet<string>,
  registry: readonly ProcEntry[],
): RunRecord[] {
  const runs: RunRecord[] = [];
  const matched: string[] = [];
  for (const runId of listSafe(file, controlRunsPath(root))) {
    if (!/^[\w.-]+$/.test(runId)) continue;
    const tail = readEventTail(file, controlRunEventsPath(root, runId), EVENT_TAIL_BYTES);
    const events = parseEvents(tail.lines.join("\n"));
    const phaseTitles = events
      .filter((event) => event.type === "phase.started" && typeof event.fields.title === "string")
      .map((event) => event.fields.title as string);
    const byTitle = titles.size > 0 && phaseTitles.some((title) => titles.has(title));
    const run = newRun(runId, byTitle ? feature : null);
    absorb(run, events);
    run.live = registry.filter((entry) => entry.runId === runId);
    if (byTitle) matched.push(runId);
    runs.push(run);
  }
  if (matched.length === 0) {
    // Fallback: loop.json names the run of the feature when titles cannot.
    const loop = readJsonRecord(file, controlFeatureFilePath(root, feature, "loop"), JSON_RECORD_BYTES) as Record<string, unknown> | null;
    const named = loop !== null && typeof loop.runId === "string" ? loop.runId : null;
    if (named !== null) {
      const run = runs.find((candidate) => candidate.runId === named);
      if (run !== undefined) run.feature = feature;
    }
  }
  return runs.filter((run) => run.feature === feature);
}

/**
 * The bash engine's runs: one per launch id in the stream, the feature
 * taken from the events themselves (run.started, phase.started, …).
 */
export function runsFromBash(lines: readonly string[], registry: readonly ProcEntry[]): RunRecord[] {
  const runs = new Map<string, RunRecord>();
  for (const line of lines) {
    const events = parseEvents(line);
    if (events.length === 0) continue;
    for (const event of events) {
      const launchId = event.fields.launchId;
      if (typeof launchId !== "string" || launchId === "") continue;
      const runId = `run-${launchId}`;
      let run = runs.get(runId);
      if (run === undefined) {
        run = newRun(runId, null);
        run.launchId = launchId;
        runs.set(runId, run);
      }
      const feature = event.fields.feature;
      if (run.feature === null && typeof feature === "string" && feature !== "") run.feature = feature;
      absorb(run, [event]);
    }
  }
  for (const run of runs.values()) run.live = registry.filter((entry) => entry.runId === run.runId);
  return [...runs.values()];
}

/** The lease directories of a feature: one run per run-launch-* directory. */
export function runsFromLeases(
  file: { size(path: string): number; read(path: string): string; list(path: string): string[] },
  workspace: string,
  feature: string,
  registry: readonly ProcEntry[],
): RunRecord[] {
  const runs: RunRecord[] = [];
  const runsDir = leasePath(workspace, feature, "run-launch-x").replace("/run-launch-x/lease.json", "");
  for (const name of listSafe(file, runsDir)) {
    if (!/^run-launch-.+$/.test(name)) continue;
    const lease = readJsonRecord(file, leasePath(workspace, feature, name), JSON_RECORD_BYTES) as Record<string, unknown> | null;
    if (lease === null) continue;
    const run = newRun(name, feature);
    if (typeof lease.launchId === "string") run.launchId = lease.launchId;
    const acquiredAt = lease.acquiredAt;
    // A lease gives the run its first time only; a release is not an event.
    if (typeof acquiredAt === "string") run.firstAt = acquiredAt;
    run.live = registry.filter((entry) => entry.runId === name);
    runs.push(run);
  }
  return runs;
}

/**
 * All runs a feature's three sources hold, deduplicated by run id (the
 * control root wins over the bash stream, the stream over a lease).
 */
export function featureRuns(
  sources: readonly RunRecord[][],
): RunRecord[] {
  const byId = new Map<string, RunRecord>();
  for (const batch of sources) {
    for (const run of batch) {
      const existing = byId.get(run.runId);
      if (existing === undefined) {
        byId.set(run.runId, run);
        continue;
      }
      // Merge: absorb the events, keep the feature name, keep liveness.
      absorb(existing, run.events);
      if (existing.feature === null) existing.feature = run.feature;
      if (existing.launchId === null) existing.launchId = run.launchId;
      existing.firstAt = existing.firstAt === null ? run.firstAt : run.firstAt === null ? existing.firstAt : (run.firstAt < existing.firstAt ? run.firstAt : existing.firstAt);
      existing.lastAt = existing.lastAt === null ? run.lastAt : run.lastAt === null ? existing.lastAt : (run.lastAt > existing.lastAt ? run.lastAt : existing.lastAt);
    }
  }
  return [...byId.values()];
}

/**
 * The run that speaks for a feature: the newest by first event that still
 * has a live process; when none is alive, the newest by first event.
 * A run without a first time sorts last, by id, deterministically.
 */
export function pickRun(runs: readonly RunRecord[], proc: { stat(pid: number): string | null; bootTimeMs(): number | null }): RunRecord | null {
  if (runs.length === 0) return null;
  const order = (run: RunRecord): number => isoMs(run.firstAt) ?? Number.NEGATIVE_INFINITY;
  const alive = runs.filter((run) => isRunAlive(proc, run));
  const pool = alive.length > 0 ? alive : runs;
  let best = pool[0];
  for (const run of pool.slice(1)) {
    const a = order(best);
    const b = order(run);
    if (b > a || (b === a && run.runId > best.runId)) best = run;
  }
  return best;
}
