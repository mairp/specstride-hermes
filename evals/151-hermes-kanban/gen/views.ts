/**
 * Shared constant view builders of the 151 phase evals (model-free). Pure
 * data over plain arguments — no clock, no fs, no randomness. The shapes
 * mirror tests/kanban/view-source.test.ts and tests/kanban/project.test.ts.
 */

/** A minimal valid engine view (`specstride.view/1`). */
export function engineView(
  state: string,
  cards: unknown[] = [],
  runId: string | null = "run-e1",
  feature = "151-hermes-kanban",
): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    now: "2026-11-11T12:00:00.000Z",
    runId,
    workspaceId: "w",
    feature,
    cursor: { file: "x", offset: 0, lastSeq: 0 },
    state,
    stateSince: null,
    transition: null,
    display: state,
    liveness: "unknown",
    conditions: { dead: false, stale: null, launchAbandoned: false },
    launch: { launchId: null, reason: null, outcome: null, engineStartId: null },
    progress: { phase: null, phases: null, phaseAttempt: null, pass: null, rejects: null, malformed: null, units: { done: 0, declared: 0 }, elapsedSeconds: 0 },
    strategy: { strategy: null, microLevel: 0, layerOffReason: null },
    phases: [],
    cards,
    lanes: [],
    laneTable: { id: "kanban", version: "v1" },
    attention: [],
    attentionOmitted: 0,
    budget: [],
    budgetOmitted: 0,
    processes: { holders: [], omitted: 0, cut: 0 },
    supervision: null,
    activity: { latestTool: null, observabilityMode: "off", observabilityReason: null },
    telemetry: [],
    timeline: { rows: [], omitted: 0 },
    parallel: null,
    diagnostics: { skippedLines: 0, gaps: [], majorsSeen: [], majorsAccepted: { from: 1, to: 1 }, majorsOutOfRange: 0, tornLastLine: false, fieldsCut: [], fieldsDropped: [], redactorFailed: false },
    signature: { record: {}, token: "00000000" },
    stream: { first: null, last: null, runStartedAt: null, runEndedAt: null },
    settled: { heartbeatLate: false, staleEventSec: 0 },
  };
}

/** One engine card with the given lane. */
export function engineCard(id: string, lane: string, feature = "151-hermes-kanban"): Record<string, unknown> {
  return { id, feature, phase: 1, lane, ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
}

/** A reader view (the engine's view is absent or empty). */
export function readerView(cards: unknown[] = [], runId: string = "run-r1"): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: `workspace:${runId}`,
    state: cards.length > 0 ? "idle" : "none",
    cards,
    attention: [],
    budget: [],
    phases: [],
    featureDetails: cards.length > 0
      ? { f: { run: { id: runId, launch: null, state: "ended", phase: 1, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" } } }
      : {},
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: "reader-token" },
  };
}

/** One reader (stage) card. */
export function readerCard(id: string, lane: string, rule = "W2"): Record<string, unknown> {
  return { id, lane, title: id, ruleId: `W-${lane}`, rule, flags: { dead: false, stale: false, yielded: false } };
}

/** One reader attention item (`<feature>#<id>` keys the feature). */
export function attentionItem(key: string, kind: string, oneLine: string): Record<string, unknown> {
  return { key, kind, "one-line": oneLine };
}

/** A reader view with feature runs and attention items (US3 shapes). */
export function readerRunView(opts: {
  cards?: unknown[];
  attention?: unknown[];
  runs: Record<string, { id: string; state: string; phase: number | null; lastAt: string | null }>;
}): Record<string, unknown> {
  const v = readerView(opts.cards ?? []);
  v.attention = opts.attention ?? [];
  v.featureDetails = Object.fromEntries(
    Object.entries(opts.runs).map(([feature, run]) => [
      feature,
      run === null
        ? { run: null }
        : { run: { id: run.id, launch: null, state: run.state, phase: run.phase, startedAt: null, lastAt: run.lastAt } },
    ]),
  );
  const firstRun = Object.values(opts.runs).find((r) => r !== null);
  v.runId = firstRun !== undefined ? `workspace:${firstRun.id}` : v.runId;
  return v;
}

/** A `WantedCard` constant (the diff's wanted card). */
export function wantedCard(opts: {
  key: string;
  role: "root" | "stage" | "attention";
  column: string;
  title: string;
  body?: string;
  label?: string;
  attentionText?: string | null;
}): Record<string, unknown> {
  return {
    key: opts.key,
    role: opts.role,
    engineValue: opts.label ?? opts.key,
    source: "workspace-reader",
    rule: null,
    column: opts.column,
    label: opts.label ?? opts.key,
    unknown: false,
    title: opts.title,
    body: opts.body ?? "",
    attentionText: opts.attentionText ?? null,
    tenant: "specstride",
    assignee: "specstride-projection",
  };
}
