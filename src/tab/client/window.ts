/**
 * The lane window and the threshold read (T050; F151-FR-048;
 * contracts/tab-manifest.md §Window and §Run strip).
 *
 * A lane above the threshold renders a bounded window of at most
 * threshold + 2 × overscan card nodes, moved on scroll; at or below it every
 * card is a node. An invalid `specstride.kanban.laneThreshold` falls back to
 * 100 with one log line through an injected sink (never the console). The
 * run strip is left out while any lane is windowed; when present it leads
 * with the feature at work, then the newest `lastAt`, then never-run
 * features in first-appearance order of `view.cards`, at most
 * `featureRows` rows and "and N more features" for the rest.
 *
 * Pure and non-mutating (F151-FR-020): no clock, no randomness; the view is
 * only read. Origin: dsh `packages/dsh-kanban/src/shared/window.ts`
 * (`window.ts:27-28, 76-91`) and `board-tree.ts:215-251` at `ab8093e`.
 */
import {
  closedSetStrip,
  closedSetWindow,
} from "../../kanban/generated/closed-sets.ts";

const WIN = closedSetWindow.constants;
const STRIP = closedSetStrip.constants;

const DEFAULT_WINDOW_THRESHOLD = Number(WIN.threshold);
const OVERSCAN = Number(WIN.overscan);
const THRESHOLD_MIN = Number(WIN.thresholdMin);
const THRESHOLD_MAX = Number(WIN.thresholdMax);
const FEATURE_ROWS = Number(STRIP.featureRows);

/** One card as the view carries it (the fields the window and strip read). */
export interface StripCard {
  readonly id?: unknown;
  readonly feature?: unknown;
  readonly phase?: unknown;
  readonly lane?: unknown;
}

/** A run as `featureDetails[<feature>].run` carries it. */
export interface StripRun {
  readonly id?: unknown;
  readonly runId?: unknown;
  readonly state?: unknown;
  readonly phase?: unknown;
  readonly lastAt?: unknown;
}

export interface WindowOfCards {
  /** The cards to render in this window, in lane order. */
  readonly slice: readonly StripCard[];
  /** Whether the lane was windowed (over the threshold). */
  readonly windowed: boolean;
  /** The index of the first card of the slice. */
  readonly start: number;
  /** The full lane size. */
  readonly total: number;
}

export interface StripRow {
  /** The feature name. */
  readonly feature: string;
  /** The feature's cards, in phase order. */
  readonly cards: readonly StripCard[];
  /** How many of them sit on `approved`. */
  readonly approved: number;
  /** The feature's run, when the view carries one. */
  readonly run: StripRun | null;
}

export interface StripSummary {
  /** The `data-summary` marker of the strip element. */
  readonly "data-summary": string;
  /** `and N more features`, when rows were cut. */
  readonly trailingText?: string;
}

export interface StripOfView {
  /** Null while any lane is windowed: the strip is left out (F151-FR-046). */
  readonly summary: StripSummary | null;
  readonly rows: readonly StripRow[];
  /** The features beyond the row cap. */
  readonly more: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The window of one lane at a scroll position (the index the viewport
 * centres on): at most threshold + 2 × overscan contiguous nodes, clamped to
 * the lane bounds. Reads the array; never writes to it.
 */
export function windowOf(
  cards: readonly StripCard[],
  scroll: number,
  threshold: number,
): WindowOfCards {
  const total = cards.length;
  if (total <= threshold) {
    return { slice: cards, windowed: false, start: 0, total };
  }
  const size = threshold + 2 * OVERSCAN;
  const start = clamp(Math.floor(scroll) - Math.floor(size / 2), 0, total - size);
  return { slice: cards.slice(start, start + size), windowed: true, start, total };
}

/**
 * The lane threshold of the `session` meta: `meta.laneThreshold` is valid
 * when it is an integer in thresholdMin..thresholdMax; anything else falls
 * back to 100 with exactly one log line through `log`, when given.
 */
export function thresholdOfMeta(
  meta: { readonly laneThreshold?: unknown } | null | undefined,
  log?: (line: string) => void,
): { readonly threshold: number; readonly logged: boolean } {
  const value = meta?.laneThreshold;
  const valid =
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= THRESHOLD_MIN &&
    value <= THRESHOLD_MAX;
  if (valid) return { threshold: value, logged: false };
  log?.(
    `specstride.kanban.laneThreshold must be an integer ${String(THRESHOLD_MIN)}..${String(THRESHOLD_MAX)}; using ${String(DEFAULT_WINDOW_THRESHOLD)}`,
  );
  return { threshold: DEFAULT_WINDOW_THRESHOLD, logged: true };
}

/** Whether a run is live (the strip leads with it). */
function isLive(run: StripRun | null): boolean {
  return run !== null && run.state === "running";
}

function runOfFeature(details: unknown, feature: string): StripRun | null {
  if (typeof details !== "object" || details === null) return null;
  const entry = (details as Record<string, unknown>)[feature];
  if (typeof entry !== "object" || entry === null) return null;
  const run = (entry as Record<string, unknown>).run;
  return (typeof run === "object" && run !== null ? run : null) as StripRun | null;
}

function lastAtOf(run: StripRun | null): number {
  const value = run?.lastAt;
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * The run strip over a view: `null` while any lane is windowed, otherwise
 * the ordered rows (live first, then the newest `lastAt`, then never-run
 * features in first-appearance order of `view.cards`), the row cap, and
 * `and N more features`. Reads the view; never writes to it.
 */
export function summaryOf(
  view: unknown,
  windowedLanes: ReadonlySet<string>,
): StripOfView {
  if (windowedLanes.size > 0) return { summary: null, rows: [], more: 0 };
  const record = (typeof view === "object" && view !== null ? view : {}) as {
    readonly cards?: readonly StripCard[];
    readonly featureDetails?: unknown;
  };
  const cards = Array.isArray(record.cards) ? record.cards : [];
  const order: string[] = [];
  const byFeature = new Map<string, StripCard[]>();
  for (const card of cards) {
    const feature = typeof card?.feature === "string" ? card.feature : "?";
    let list = byFeature.get(feature);
    if (list === undefined) {
      list = [];
      byFeature.set(feature, list);
      order.push(feature);
    }
    list.push(card);
  }
  const rowsAll: StripRow[] = order.map((feature) => {
    const featureCards = [...(byFeature.get(feature) ?? [])].sort(
      (a, b) => Number(a?.phase ?? 0) - Number(b?.phase ?? 0),
    );
    return {
      feature,
      cards: featureCards,
      approved: featureCards.filter((c) => c?.lane === "approved").length,
      run: runOfFeature(record.featureDetails, feature),
    };
  });
  const live = rowsAll.filter((row) => isLive(row.run));
  const ended = rowsAll
    .filter((row) => row.run !== null && !isLive(row.run))
    .sort((a, b) => lastAtOf(b.run) - lastAtOf(a.run));
  const never = rowsAll.filter((row) => row.run === null);
  const ordered = [...live, ...ended, ...never];
  const rows = ordered.slice(0, FEATURE_ROWS);
  const more = Math.max(0, ordered.length - rows.length);
  const summary: StripSummary =
    more > 0
      ? { "data-summary": "", trailingText: `and ${String(more)} more features` }
      : { "data-summary": "" };
  return { summary, rows, more };
}

export const WINDOW_CONSTANTS = {
  threshold: DEFAULT_WINDOW_THRESHOLD,
  overscan: OVERSCAN,
  featureRows: FEATURE_ROWS,
};
