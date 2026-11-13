/**
 * The workspace reader's view builder (T026; US7, F151-FR-035..041).
 *
 * `readWorkspaceView(cwd, {fs, proc, now, home})` walks the closed input
 * list and returns one `specstride.view/1` ReaderView: one card per phase
 * of every feature's tasks.md (one `#queued` card for a never-started
 * feature), at most one attention item per feature, the recorded run state
 * per feature, and a signature over the lot. The reader is read-only, it
 * spawns nothing, writes nothing, and never opens a path outside the
 * closed list (F151-FR-034) — a feature without a run, a workspace with no
 * launches, and a run between passes are all ordinary states, never errors.
 *
 * dsh source: packages/dsh-kanban/src/server/workspace-view.ts @ ab8093e.
 */
import {
  type FilePort,
  type ProcPort,
  readEventTail,
  readJsonRecord,
  listSafe,
  tasksMdPath,
  workspaceJsonPath,
  bashEventsPath,
  featureDirPath,
  controlRoot,
} from "./ports.ts";
import { parseEvents } from "./events.ts";
import { parseScopes } from "./tasks-md.ts";
import { EVENT_TAIL_BYTES, JSON_RECORD_BYTES, TASKS_MD_BYTES } from "./bounds.ts";
import { computeSignature } from "../signature.ts";
import {
  type ProcEntry,
  type RunRecord,
  isoMs,
  factsOf,
  featureRuns,
  pickRun,
  readProcRegistry,
  runsFromBash,
  runsFromControlRoot,
  runsFromLeases,
  isRunAlive,
} from "./runs.ts";
import { type EndInfo, type LaunchRecord, endOf, launchOfRun, pipelineEnd, readLaunches } from "./launches.ts";
import { type AttentionItem, type LanePhase, type ReaderCard, attentionOf, featureCards } from "./lanes.ts";

export { type FilePort, type ProcPort } from "./ports.ts";

/** The ReaderView of `specstride.view/1` (data-model.md). */
export interface ReaderView {
  schema: "specstride.view/1";
  source: "workspace-reader";
  laneTable: { id: "workspace-reader"; version: "1" };
  runId: string;
  state: "none" | "running" | "idle";
  cards: ReaderCard[];
  attention: AttentionItem[];
  budget: [];
  phases: [];
  featureDetails: Record<string, { run: { id: string; launch: string | null; state: string | null; phase: number | null; startedAt: string | null; lastAt: string | null } }>;
  cursor: { offset: number; lastSeq: number };
  signature: { token: string };
}

function shortHash(text: string): string {
  let hash = 5381;
  for (const byte of Buffer.from(text, "utf8")) hash = ((hash * 33) ^ byte) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function names(file: FilePort, path: string, pattern: RegExp): string[] {
  return listSafe(file, path).filter((name) => pattern.test(name));
}

function approvalPhases(file: FilePort, root: string, feature: string): Set<number> {
  const approved = new Set<number>();
  const dir = `${root}/features/${feature}/approvals`;
  for (const name of names(file, dir, /^phase-(\d+)\.json$/)) {
    const phase = Number(/^phase-(\d+)\.json$/.exec(name)?.[1]);
    const record = readJsonRecord(file, `${dir}/${name}`, JSON_RECORD_BYTES) as Record<string, unknown> | null;
    if (record === null || record.voided === true) continue; // a voided approval is no approval
    if (record.outcome === "approved") approved.add(phase);
  }
  return approved;
}

function gatePhases(file: FilePort, workspace: string, feature: string): Set<number> {
  const gates = new Set<number>();
  for (const name of names(file, featureDirPath(workspace, feature, "gates"), /^GATE(\d+)-APPROVED$/)) {
    const phase = Number(/^GATE(\d+)-APPROVED$/.exec(name)?.[1]);
    if (Number.isFinite(phase)) gates.add(phase);
  }
  return gates;
}

/** The workspace id: the recorded one, else a stable short hash of the path. */
function workspaceIdOf(file: FilePort, workspace: string): string {
  const record = readJsonRecord(file, workspaceJsonPath(workspace), JSON_RECORD_BYTES) as Record<string, unknown> | null;
  const id = record !== null && typeof record.workspaceId === "string" && record.workspaceId !== "" ? record.workspaceId : null;
  return id ?? `ws-${shortHash(workspace)}`;
}

export interface WorkspaceReaderOptions {
  fs: FilePort;
  proc: ProcPort;
  /** Now, for staleness and silence: defaults to the real clock. */
  now?: Date;
  /** The state home the control roots live under (`~`). */
  home: string;
}

/**
 * Build the workspace's ReaderView. Never throws on ordinary states: an
 * unreadable record is skipped, a feature without a run is a card, a
 * workspace without launches is a view.
 */
export function readWorkspaceView(workspace: string, options: WorkspaceReaderOptions): ReaderView {
  const { fs, proc } = options;
  const nowMs = (options.now ?? new Date()).getTime();
  const workspaceId = workspaceIdOf(fs, workspace);
  const root = controlRoot(options.home, workspaceId);

  const registry: ProcEntry[] = readProcRegistry(fs, root);
  const registryPresent = fs.exists(`${root}/procs.json`);
  const launches: LaunchRecord[] = readLaunches(fs, workspace);
  const bashTail = readEventTail(fs, bashEventsPath(workspace), EVENT_TAIL_BYTES);
  const bashRuns = runsFromBash(bashTail.lines.map((line) => line), registry);

  const cards: ReaderCard[] = [];
  const attention: AttentionItem[] = [];
  const featureDetails: ReaderView["featureDetails"] = {};
  let anyLive = false;

  const features = names(fs, `${workspace}/specs`, /^[\w.-]+$/).filter((feature) => fs.exists(tasksMdPath(workspace, feature)));
  for (const feature of features) {
    const text = (() => {
      try {
        const size = fs.size(tasksMdPath(workspace, feature));
        return fs.read(tasksMdPath(workspace, feature)).slice(0, Math.min(size, TASKS_MD_BYTES));
      } catch {
        return null;
      }
    })();
    if (text === null) continue;
    const scope = parseScopes(text);
    if (scope.phases.length === 0) continue;
    const phases: LanePhase[] = scope.phases.map((phase) => ({ number: phase.number, title: phase.title, tasks: phase.tasks }));

    const titles = new Set(phases.map((phase) => phase.title).filter((title) => title !== ""));
    const runs: RunRecord[] = featureRuns([
      runsFromControlRoot(fs, root, feature, titles, registry),
      bashRuns.filter((run) => run.feature === feature),
      runsFromLeases(fs, workspace, feature, registry),
    ]);
    const chosen = pickRun(runs, proc);
    const facts = factsOf(chosen);
    const pipeline = pipelineEnd(fs, workspace, feature);
    // The launch join is by time only (§4): the engine writes no id join.
    const launch = chosen !== null ? launchOfRun(chosen, launches) : null;
    const end: EndInfo = chosen === null
      ? { ended: false, outcome: null, endLane: null, why: null, betweenPasses: false }
      : endOf(chosen, facts, launch, pipeline, proc, registry, registryPresent, nowMs);

    const ctx = { chosenRun: chosen, facts, end, approvals: approvalPhases(fs, root, feature), gates: gatePhases(fs, workspace, feature), nowMs };
    const featureCardsOut = featureCards(feature, phases, ctx);
    cards.push(...featureCardsOut);
    const item = attentionOf(feature, featureCardsOut, ctx);
    if (item !== null) attention.push(item);

    if (chosen !== null) {
      const state = end.ended
        ? (end.outcome ?? facts.outcome ?? "ended")
        : facts.activity !== null
          ? "running"
          : "between passes";
      featureDetails[feature] = {
        run: {
          id: chosen.runId.length > 40 ? chosen.runId.slice(0, 40) : chosen.runId,
          launch: launch?.launchId ?? null,
          state,
          phase: facts.currentPhase,
          startedAt: chosen.firstAt,
          lastAt: chosen.lastAt,
        },
      };
      if (!end.ended && (facts.activity !== null || isRunAlive(proc, chosen))) anyLive = true;
    }
  }

  const state: ReaderView["state"] = cards.length === 0 ? "none" : anyLive ? "running" : "idle";
  const view: ReaderView = {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: `workspace:${workspaceId}`,
    state,
    cards,
    attention,
    budget: [],
    phases: [],
    featureDetails,
    cursor: { offset: bashTail.offset, lastSeq: bashTail.lastSeq },
    signature: { token: computeSignature({ cards, attention, launches: launches.map((l) => ({ launchId: l.launchId, state: l.state })), featureDetails }) },
  };
  return view;
}

/** Parse one event line (exposed for the tests' fixtures). */
export const parseEventLines = parseEvents;
export { isoMs };
