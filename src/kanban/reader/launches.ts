/**
 * Launches and the end judgement of the workspace reader (T024; US7,
 * F151-FR-037). A run that its own events have not ended is judged ended
 * by the outside world, in this order:
 *
 * - E1 — the pipeline's end record (`state/pipeline/<f>/runs/<launch>/
 *   state.json`) when it is not running, not a dry run, and not older than
 *   the run's last event; its recorded state is the outcome, verbatim
 *   (`stopped` → paused, `completed` → no end lane, anything else → failed).
 * - E2 — no alive process and a launch that is not running: the launch's
 *   state decides (signalled / stopped / stop requested → paused, exited 0
 *   or completed → no end lane, anything else → failed).
 * - E3 — no launch at all, a procs.json that is present, no alive process,
 *   and 120 s without an event → failed.
 *
 * A launch that still says running while no process is alive is NOT an
 * end: the run reads as between passes — the pid may have been reused or
 * lost by the supervisor; the end is never inferred from that.
 *
 * dsh source: packages/dsh-kanban/src/server/run-detail.ts @ ab8093e
 * (readLaunches, pipelineEnd, launchOfRun, endOf).
 */
import { readJsonRecord, listSafe, launchesDirPath, launchFilePath, pipelineStatePath } from "./ports.ts";
import { endLaneOf } from "./events.ts";
import { isoMs, SILENT_RUN_MS, type ProcEntry, type RunRecord, isRunAlive } from "./runs.ts";
import { JSON_RECORD_BYTES } from "./bounds.ts";

/** What the launch records hold, joined (data-model.md LaunchRecord). */
export interface LaunchRecord {
  launchId: string;
  feature: string | null;
  createdAt: string | null;
  endedAt: string | null;
  /** The recorded state, verbatim: runtime.status, then supervision, then the launch outcome. */
  state: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  stopRequested: boolean;
  /** The recorded reason of the end, verbatim, or null. */
  why: string | null;
  /** The run id the launch record names (US6 detail), or null. */
  runId: string | null;
}

/** The end judgement (data-model.md EndInfo). */
export interface EndInfo {
  ended: boolean;
  outcome: string | null;
  endLane: string | null;
  why: string | null;
  /** True when the launch says running but no process is alive (§2.6). */
  betweenPasses: boolean;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read one launch's records; absent files contribute nothing. */
function readLaunchRecord(file: { size(path: string): number; read(path: string): string }, workspace: string, launchId: string): LaunchRecord {
  const launch = readJsonRecord(file, launchFilePath(workspace, launchId, "launch"), JSON_RECORD_BYTES) as Record<string, unknown> | null;
  const supervision = readJsonRecord(file, launchFilePath(workspace, launchId, "supervision"), JSON_RECORD_BYTES) as Record<string, unknown> | null;
  const status = readJsonRecord(file, launchFilePath(workspace, launchId, "runtime.status"), JSON_RECORD_BYTES) as Record<string, unknown> | null;
  const state = str(status?.state) ?? str(supervision?.state) ?? str(launch?.outcome);
  const exitCode = num(status?.exitCode) ?? num(supervision?.exitCode) ?? num(launch?.exitCode);
  const stopRequested = supervision?.stopRequested === true || status?.stopRequested === true || launch?.stopRequested === true;
  return {
    launchId,
    feature: str(launch?.feature),
    createdAt: str(launch?.createdAt),
    endedAt: str(status?.endedAt) ?? str(supervision?.endedAt),
    state,
    exitCode,
    exitSignal: str(status?.exitSignal) ?? str(supervision?.exitSignal),
    stopRequested,
    why: str(launch?.why) ?? str(status?.reason) ?? str(supervision?.why),
    runId: str(launch?.runId),
  };
}

/** Every launch the workspace's `.specstride/launches/` holds. */
export function readLaunches(file: { size(path: string): number; read(path: string): string; list(path: string): string[] }, workspace: string): LaunchRecord[] {
  const launches: LaunchRecord[] = [];
  for (const name of listSafe(file, launchesDirPath(workspace))) {
    if (!/^launch-[\w-]+$/.test(name)) continue;
    launches.push(readLaunchRecord(file, workspace, name));
  }
  return launches;
}

/** The pipeline's newest end record of a feature, or null. */
export function pipelineEnd(file: { size(path: string): number; read(path: string): string; list(path: string): string[] }, workspace: string, feature: string): { state: string; reason: string | null; atMs: number | null } | null {
  const runsDir = pipelineStatePath(workspace, feature, "x").replace("/x/state.json", "");
  let best: { state: string; reason: string | null; atMs: number | null; name: string } | null = null;
  for (const name of listSafe(file, runsDir)) {
    if (!/^launch-[\w-]+$/.test(name)) continue;
    const record = readJsonRecord(file, pipelineStatePath(workspace, feature, name), JSON_RECORD_BYTES) as Record<string, unknown> | null;
    if (record === null) continue;
    const state = str(record.state);
    if (state === null || state === "running" || state === "dry-run") continue;
    const updatedAt = record.updatedAt;
    const atMs = typeof updatedAt === "number" ? updatedAt : isoMs(str(updatedAt));
    const order = atMs ?? Number.NEGATIVE_INFINITY;
    const bestOrder = best !== null ? (best.atMs ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    if (best === null || order > bestOrder || (order === bestOrder && name > best.name)) {
      best = { state, reason: str(record.exitReason) ?? str(record.why), atMs, name };
    }
  }
  return best;
}

/**
 * The launch of a run: the newest launch created no later than the run's
 * first event (within the closed tolerance); null when that launch had
 * already ended before the run began, or when a later launch existed
 * before the run began — the run is not pinned across launches.
 */
export function launchOfRun(run: RunRecord, launches: readonly LaunchRecord[]): LaunchRecord | null {
  const firstAtMs = isoMs(run.firstAt);
  if (firstAtMs === null) return null;
  const tolerance = 1000;
  const candidates = launches
    .filter((launch) => isoMs(launch.createdAt) !== null && (isoMs(launch.createdAt) as number) <= firstAtMs + tolerance)
    .sort((a, b) => (isoMs(a.createdAt) as number) - (isoMs(b.createdAt) as number));
  const best = candidates[candidates.length - 1];
  if (best === undefined) return null;
  const endedAtMs = isoMs(best.endedAt);
  if (endedAtMs !== null && endedAtMs + tolerance < firstAtMs) return null;
  const later = launches.find((launch) => isoMs(launch.createdAt) !== null && (isoMs(launch.createdAt) as number) > (isoMs(best.createdAt) as number));
  if (later !== undefined && (isoMs(later.createdAt) as number) < firstAtMs) return null;
  return best;
}

/** The end lane of a recorded outcome (§5's table; unknown → failed). */
export function launchEndLane(launch: LaunchRecord): string | null {
  const state = launch.state ?? "";
  if (state === "signalled" || state === "stopped" || launch.stopRequested) return "paused";
  if (state === "completed") return null;
  if (state === "exited" && launch.exitCode === 0) return null;
  return "failed";
}

/**
 * The end judgement of one run (§2.6, E0–E3): the run's own events first
 * (E0), then the pipeline record (E1), the launch (E2), then the silence
 * rule (E3). `registryPresent` — whether a procs.json exists at all; when
 * it does not, a missing process is no evidence of anything.
 */
export function endOf(
  run: RunRecord,
  facts: { ended: boolean; outcome: string | null; why: string | null },
  launch: LaunchRecord | null,
  pipeline: { state: string; reason: string | null; atMs: number | null } | null,
  proc: { stat(pid: number): string | null; bootTimeMs(): number | null },
  registry: readonly ProcEntry[],
  registryPresent: boolean,
  nowMs: number,
): EndInfo {
  // E0: the run's own events have already ended it.
  if (facts.ended) {
    return { ended: true, outcome: facts.outcome, endLane: endLaneOf(facts.outcome), why: facts.why, betweenPasses: false };
  }
  const anyAlive = isRunAlive(proc, run);
  // E1: the pipeline's end record, when not older than the run's last event.
  if (pipeline !== null) {
    const lastAtMs = isoMs(run.lastAt);
    if (lastAtMs === null || pipeline.atMs === null || pipeline.atMs >= lastAtMs) {
      const endLane = pipeline.state === "stopped" ? "paused" : pipeline.state === "completed" ? null : "failed";
      return { ended: true, outcome: pipeline.state, endLane, why: pipeline.reason, betweenPasses: false };
    }
  }
  // E3 first for the launch-less case: 120 s without an event, registry present.
  if (launch === null && registryPresent && !anyAlive) {
    const lastAtMs = isoMs(run.lastAt);
    if (lastAtMs !== null && nowMs - lastAtMs > SILENT_RUN_MS) {
      return { ended: true, outcome: "lost", endLane: "failed", why: `silent for ${Math.round(SILENT_RUN_MS / 1000)} s`, betweenPasses: false };
    }
    return { ended: false, outcome: null, endLane: null, why: null, betweenPasses: false };
  }
  // E2: no alive process and a launch that is not running.
  if (!anyAlive && launch !== null && launch.state !== "running") {
    return { ended: true, outcome: launch.state, endLane: launchEndLane(launch), why: launch.why, betweenPasses: false };
  }
  // Still going — or between passes: the launch says running, no process is alive.
  const betweenPasses = launch !== null && launch.state === "running" && !anyAlive;
  return { ended: false, outcome: null, endLane: null, why: null, betweenPasses };
}
