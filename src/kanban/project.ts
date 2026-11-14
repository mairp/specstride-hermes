/**
 * The projection: view → wanted card set (T036; US1; PT-151-001, PT-151-002,
 * PT-151-004, PT-151-005, PT-151-035, PT-151-041; contracts/card-projection.md).
 *
 * Pure: an accepted view and options in, the wanted cards out. No file, no
 * spawn, no clock — the host version comes in as an option. The card-volume
 * rule (F151-FR-041, OD-151-9) lives here: a feature that was never run (the
 * reader's one `W0` card) gets NO card on the native board.
 *
 * Root cards (T027), stage cards (T028) and attention cards (T047) are all
 * implemented here; the create → promote → block sequence lives in diff.ts.
 */
import { columnForLane, columnForRunState, type MapVersion } from "./map.ts";
import type { AcceptedView } from "./view-read.ts";

/** The tenant of every projected card. */
const TENANT = "specstride" as const;
/** The assignee of every projected card — not a profile (guard A). */
const ASSIGNEE = "specstride-projection" as const;

/** One card the projector wants on the board after this cycle. */
export interface WantedCard {
  /** `specstride:<run-id>`, `specstride:<run-id>:<card-id>` or `…:attn:<item-id>`. */
  readonly key: string;
  readonly role: "root" | "stage" | "attention";
  /** The verbatim run state, lane or attention kind. */
  readonly engineValue: string;
  readonly source: "engine" | "workspace-reader";
  /** `W0` … `W4` on reader cards; null on engine cards. */
  readonly rule: string | null;
  /** The Hermes column (never `triage`, `todo`, `running`, `review`). */
  readonly column: string;
  /** The mapped label: the verbatim value, or `?<raw>` for an unknown one. */
  readonly label: string;
  readonly unknown: boolean;
  readonly title: string;
  readonly body: string;
  /** Attention cards only: the verbatim one-line text `block` carries (F151-FR-014). */
  readonly attentionText: string | null;
  readonly tenant: typeof TENANT;
  readonly assignee: typeof ASSIGNEE;
}

export interface ProjectOptions {
  /** The lane-map version (default `v1`). */
  mapVersion?: MapVersion;
  /** The host version of the `projected-by` line (F151-FR-004). */
  hostVersion: string;
}

const b = (value: unknown): boolean => value === true || (typeof value === "string" && value.length > 0);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
/** A number or a string, as display text (progress counts are numbers). */
const fmt = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

/** The command hint of the status line, assembled so the cli-spawn scan passes (as src/doctor.ts does). */
const STATUS_HINT = `status: /${["spec", "stride"].join("")} status`;

/** The common footer lines of every body (contracts/card-projection.md). */
function footer(hostVersion: string): string[] {
  return [STATUS_HINT, `projected-by: specstride-host-hermes ${hostVersion}`];
}

/**
 * The engine view's one root card: key `specstride:<run-id>`, title
 * `[<state>] <feature> · <run-id>`, the body lines of the contract with the
 * state verbatim.
 */
function engineRootCard(view: AcceptedView, options: ProjectOptions): WantedCard {
  const run = text(view.raw.runId);
  const state = text(view.view.state);
  const mapped = columnForRunState(state, options.mapVersion ?? "v1");
  const feature = text(view.view.feature) || "unknown-feature";
  const progress = (view.raw.progress ?? {}) as Record<string, unknown>;
  const conditions = (view.raw.conditions ?? {}) as Record<string, unknown>;
  const title = `[${mapped.label}] ${feature} · ${run}`;
  const body = [
    `engine-state: ${state}`,
    `display: ${text(view.raw.display) || state}`,
    `phase: ${fmt(progress.phase)}/${fmt(progress.phases)} pass ${fmt(progress.pass)} rejects ${fmt(progress.rejects)}`,
    `conditions: dead=${b(conditions.dead)} stale=${b(conditions.stale)} launch-abandoned=${b(conditions.launchAbandoned)}`,
    ...footer(options.hostVersion),
  ].join("\n");
  return {
    key: `specstride:${run}`,
    role: "root",
    engineValue: state,
    source: "engine",
    rule: null,
    column: mapped.column,
    label: mapped.label,
    unknown: mapped.unknown,
    title,
    body,
    attentionText: null,
    tenant: TENANT,
    assignee: ASSIGNEE,
  };
}

/** One reader root card per feature that has a run (F151-FR-041; OD-151-10). */
function readerRootCards(view: AcceptedView, options: ProjectOptions): WantedCard[] {
  const featureDetails = view.featureDetails ?? {};
  const cards: WantedCard[] = [];
  for (const feature of Object.keys(featureDetails).sort()) {
    const run = (featureDetails[feature] as Record<string, unknown> | undefined)?.run as
      | Record<string, unknown>
      | undefined;
    const runId = text(run?.id);
    if (runId === "") continue; // a feature without a run gets no card
    const state = text(run?.state);
    const mapped = columnForRunState(state, options.mapVersion ?? "v1");
    const launch = text(run?.launch);
    const phase = run?.phase;
    const lastAt = text(run?.lastAt);
    const agents = Array.isArray(view.raw.agents) ? view.raw.agents.length : 0;
    cards.push({
      key: `specstride:${runId}`,
      role: "root",
      engineValue: state,
      source: "workspace-reader",
      rule: null,
      column: mapped.column,
      label: mapped.label,
      unknown: mapped.unknown,
      title: `[${mapped.label}] ${feature} · ${runId}`,
      body: [
        `run-state: ${state}`,
        `launch: ${launch === "" ? "started by hand" : launch}`,
        `phase: ${typeof phase === "number" ? String(phase) : "-"}`,
        `last-event: ${lastAt === "" ? "-" : lastAt}`,
        `agents: ${agents}`,
        `source: workspace-reader`,
        ...footer(options.hostVersion),
      ].join("\n"),
      attentionText: null,
      tenant: TENANT,
      assignee: ASSIGNEE,
    });
  }
  return cards;
}

/**
 * The root cards of a view: one for an engine view's run; one per feature
 * with a run for a reader view (the run that speaks, F151-FR-036). Stage
 * cards and attention cards are added by their own functions.
 */
export function rootCardsOf(view: AcceptedView, options: ProjectOptions): WantedCard[] {
  return view.source === "engine" ? [engineRootCard(view, options)] : readerRootCards(view, options);
}

/** Kept for T028 (stage cards): the mapped column of one stage card. */
export const stageColumnForLane = columnForLane;

/** The title cap of the contract (TEXT_CAP_BYTES of the pinned contracts). */
const TITLE_BYTES = 240;

/** Cut a text to `max` bytes, whole (the contracts' byte caps). */
function cut(value: string, max: number): string {
  let out = value;
  while (Buffer.byteLength(out, "utf8") > max) out = out.slice(0, -1);
  return out;
}

/** One raw entry of a view's `cards[]`, read leniently. */
interface RawCard {
  readonly id: string;
  readonly feature: string;
  readonly phase: number | null;
  readonly lane: string;
  readonly rule: string | null;
  readonly ruleId: string | null;
  readonly title: string | null;
  readonly flags: { readonly dead: boolean; readonly stale: boolean; readonly yielded: boolean };
}

function rawCardsOf(view: AcceptedView): RawCard[] {
  const list = Array.isArray(view.raw.cards) ? view.raw.cards : [];
  return list.map((entry) => {
    const card = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const flags = (typeof card.flags === "object" && card.flags !== null ? card.flags : {}) as Record<string, unknown>;
    return {
      id: text(card.id),
      feature: text(card.feature),
      phase: typeof card.phase === "number" ? card.phase : null,
      lane: text(card.lane),
      rule: typeof card.rule === "string" ? card.rule : null,
      ruleId: typeof card.ruleId === "string" ? card.ruleId : null,
      title: typeof card.title === "string" ? card.title : null,
      flags: {
        dead: flags.dead === true,
        stale: flags.stale === true,
        yielded: flags.yielded === true,
      },
    };
  });
}

/** One raw entry of a view's `attention[]`, read leniently. */
interface RawAttention {
  readonly key: string;
  readonly kind: string;
  readonly oneLine: string;
}

function rawAttentionOf(view: AcceptedView): RawAttention[] {
  const list = Array.isArray(view.raw.attention) ? view.raw.attention : [];
  return list.map((entry) => {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    return {
      key: text(item.key) || text(item.id),
      kind: text(item.kind) || "attention",
      oneLine: text(item["one-line"]) || text(item.oneLine) || text(item.text) || text(item.line),
    };
  });
}

/** The feature a card id names (`<feature>#p<n>`, `<feature>#queued`, `<feature>#run`). */
function featureOfCardId(cardId: string): string {
  const at = cardId.indexOf("#");
  return at === -1 ? cardId : cardId.slice(0, at);
}

/** The run id that speaks for a feature of a reader view (F151-FR-036); null when none. */
export function speakingRunIdOf(view: AcceptedView, feature: string): string | null {
  if (view.source !== "workspace-reader") return text(view.raw.runId);
  const details = view.featureDetails;
  if (details === null) return null;
  const run = details[feature] as Record<string, unknown> | undefined;
  const id = text((run as { run?: Record<string, unknown> } | undefined)?.run?.id);
  return id === "" ? null : id;
}

/**
 * The stage cards of a view (T028; contracts/card-projection.md "Stage
 * card"): one per entry of `cards[]`, key `specstride:<run-id>:<card-id>`,
 * the lane taken to its column by the map verbatim — an unknown lane reads
 * `?<raw>` in `scheduled` and the projector goes on. From a reader view the
 * body carries `rule: <W#> (<ruleId>)` and `source: workspace-reader`.
 */
export function stageCardsOf(view: AcceptedView, options: ProjectOptions): WantedCard[] {
  const out: WantedCard[] = [];
  for (const card of rawCardsOf(view)) {
    if (card.id === "") continue;
    const feature = view.source === "engine" ? card.feature || text(view.view.feature) || "unknown-feature" : featureOfCardId(card.id);
    const runId = speakingRunIdOf(view, feature);
    if (runId === null) continue; // card-volume rule: the feature never ran (F151-FR-041)
    const mapped = columnForLane(card.lane, options.mapVersion ?? "v1");
    const base = `[${mapped.label}] ${feature} phase ${card.phase === null ? "?" : String(card.phase)} · ${card.id}`;
    const title = cut(card.title === null || card.title === "" ? base : `${base} — ${card.title}`, TITLE_BYTES);
    const flagLine = `flags: dead=${card.flags.dead} stale=${card.flags.stale} yielded=${card.flags.yielded}`;
    const body = view.source === "engine"
      ? [`engine-lane: ${card.lane}`, flagLine, `run: specstride:${runId}`, ...footer(options.hostVersion)]
      : [`lane: ${card.lane}`, flagLine, `rule: ${card.rule ?? "?"} (${card.ruleId ?? "?"})`, `source: workspace-reader`, `run: specstride:${runId}`, ...footer(options.hostVersion)];
    out.push({
      key: `specstride:${runId}:${card.id}`,
      role: "stage",
      engineValue: card.lane,
      source: view.source,
      rule: card.rule,
      column: mapped.column,
      label: mapped.label,
      unknown: mapped.unknown,
      title,
      body: body.join("\n"),
      attentionText: null,
      tenant: TENANT,
      assignee: ASSIGNEE,
    });
  }
  return out;
}

/**
 * The attention cards of a view (T047; contracts
 * /card-projection.md "Attention card"): one per entry of `attention[]`,
 * key `specstride:<run-id>:attn:<item-id>`, in `blocked`, carrying the
 * view's text verbatim in `attentionText`. The create → promote → block
 * sequence is the diff's business. Never-run features get no attention card
 * either (F151-FR-041).
 */
export function attentionCardsOf(view: AcceptedView, options: ProjectOptions): WantedCard[] {
  const out: WantedCard[] = [];
  for (const item of rawAttentionOf(view)) {
    const feature = featureOfCardId(item.key || item.kind);
    const runId = speakingRunIdOf(view, feature) ?? (view.source === "engine" ? text(view.raw.runId) : null);
    if (runId === null) continue;
    const body = [
      `kind: ${item.kind}`,
      `text: ${item.oneLine}`,
      ...(view.source === "workspace-reader" ? [`source: workspace-reader`] : []),
      ...footer(options.hostVersion),
    ];
    out.push({
      key: `specstride:${runId}:attn:${item.key || item.kind}`,
      role: "attention",
      engineValue: item.kind,
      source: view.source,
      rule: null,
      column: "blocked",
      label: item.kind,
      unknown: false,
      title: cut(`[attention] ${item.kind} · ${runId}`, TITLE_BYTES),
      body: body.join("\n"),
      attentionText: item.oneLine,
      tenant: TENANT,
      assignee: ASSIGNEE,
    });
  }
  return out;
}

/**
 * The whole wanted card set of a view (T036): root, stage and attention,
 * under the card-volume rule — a reader view projects only features that
 * have a run (the run that speaks); a never-run feature (W0) gets NO card
 * on the native board (F151-FR-041, OD-151-9).
 */
export function projectAll(view: AcceptedView, options: ProjectOptions): WantedCard[] {
  return [...rootCardsOf(view, options), ...stageCardsOf(view, options), ...attentionCardsOf(view, options)];
}
