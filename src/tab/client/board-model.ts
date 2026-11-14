/**
 * The board model (T048, T058 — US4; contracts/tab-manifest.md; F151-FR-019,
 * F151-FR-025, F151-FR-046, F151-FR-047): the pure projection of an accepted
 * view plus the selection into the fields the board tree renders.
 *
 * The columns come from `card.lane` and nothing else (F151-FR-025): no
 * remapping, no rule, no feature moves a card. The eight canonical lanes
 * always render; a lane value the view carries beyond them gains a trailing
 * column in first-appearance order. Attention, budget and approvals pass
 * through exactly as the view holds them. The run strip is built here (it is
 * an element of the model) and is `null` while any lane is windowed
 * (F151-FR-046).
 *
 * Pure: no clock, no randomness, no I/O; the view is only read (F151-FR-020).
 * Origin: dsh `packages/dsh-kanban/src/shared/board-model.ts` at `ab8093e`.
 */
import type { AcceptedView } from "../../kanban/view-read.ts";
import { closedSetLanes, closedSetWindow } from "../../kanban/generated/closed-sets.ts";
import { el, type ElementNode } from "./tree.ts";
import { laneOf } from "./presentation.ts";
import { summaryOf, type StripCard, type StripRun } from "./window.ts";

/** The default lane threshold (closed set "kanban-window"). */
const DEFAULT_THRESHOLD = Number(closedSetWindow.constants.threshold);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/**
 * The column a card lands in: `card.lane` and nothing else (F151-FR-025) —
 * no remapping, no feature or rule influences the column.
 */
export function columnOf(card: { readonly lane: unknown }): unknown {
  return card.lane;
}

/** One chip of the run strip: one per canonical lane, glyph, label, count.
 * A single node tinted by `data-tint` (no nested badge, so the strip holds
 * exactly one tinted node per lane besides the track segments). */
function chip(lane: string, count: number, boardHasCards: boolean): ElementNode {
  const p = laneOf(lane);
  return el(
    "span",
    {
      class: "sskh-chip",
      "data-tint": lane,
      "data-empty": boardHasCards && count === 0 ? "true" : undefined,
      "aria-label": p.label,
      title: p.label,
    },
    `${p.glyph} ${String(count)}`,
  );
}

/** The run line of a feature row: `<run id> · <state> · phase <n> · last event <time>`. */
function runLine(run: Record<string, unknown> | null): string | null {
  if (run === null) return null;
  const id = typeof run.id === "string" ? run.id : typeof run.runId === "string" ? run.runId : null;
  const state = typeof run.state === "string" ? run.state : null;
  if (id === null || state === null) return null;
  const parts = [`${id} · ${state}`];
  if (typeof run.phase === "number") parts.push(`phase ${String(run.phase)}`);
  if (typeof run.lastAt === "string") parts.push(`last event ${run.lastAt}`);
  return parts.join(" · ");
}

/** The strip element over the ordered feature rows. */
function stripOf(
  rows: readonly { feature: string; cards: readonly StripCard[]; approved: number; run: StripRun | null }[],
  laneCounts: ReadonlyMap<string, number>,
  boardHasCards: boolean,
  more: number,
): ElementNode {
  const children: (ElementNode | string)[] = [
    el(
      "div",
      { class: "sskh-chips" },
      ...closedSetLanes.map((lane) => chip(lane, laneCounts.get(lane) ?? 0, boardHasCards)),
    ),
  ];
  for (const row of rows) {
    const segments = row.cards.map((card) =>
      el("span", {
        class: "sskh-seg",
        "data-tint": typeof card.lane === "string" ? card.lane : "?",
        "data-empty": "false",
      }),
    );
    const line = runLine(row.run as Record<string, unknown> | null);
    children.push(
      el(
        "div",
        { class: "sskh-feature-row", "data-feature": row.feature },
        el("span", { class: "sskh-feature-name" }, row.feature),
        el("span", { class: "sskh-approved" }, `${String(row.approved)} of ${String(row.cards.length)} approved`),
        el("span", { class: "sskh-track", "aria-hidden": "true", "data-track": "" }, ...segments),
        line === null ? el("span", { class: "sskh-runline" }) : el("span", { class: "sskh-runline" }, line),
      ),
    );
  }
  if (more > 0) children.push(el("span", { class: "sskh-more" }, `and ${String(more)} more features`));
  return el("div", { class: "sskh-strip", "data-summary": "" }, ...children);
}

/** One lane column of the board: the lane key and its cards. */
export interface BoardLane {
  lane: string;
  cards: readonly Record<string, unknown>[];
  empty: boolean;
}

/** One feature row of the strip. */
export interface BoardFeature {
  name: string;
  cards: readonly Record<string, unknown>[];
  approved: number;
  run: Record<string, unknown> | null;
}

/** The board model of one view and selection. */
export interface BoardModel {
  view: AcceptedView;
  banners: readonly ElementNode[];
  viewSource: string;
  marker: string | null;
  lanes: readonly BoardLane[];
  features: readonly BoardFeature[];
  attention: readonly unknown[];
  budget: readonly unknown[];
  approvals: readonly unknown[];
  windowed: boolean;
  strip: ElementNode | null;
  /** The selected card id, or `null`. */
  selectedCardId: string | null;
  /** The selected card, or `null`. */
  selectedCard: Record<string, unknown> | null;
  /** The selected card's detail (`cards[].detail`), or `null`. */
  detail: Record<string, unknown> | null;
  /** The selected feature's detail (`featureDetails[<feature>]`), or `null`. */
  featureDetail: Record<string, unknown> | null;
}

/**
 * The board of one accepted view and the selected card id (or `null`).
 * Pure: no clock, no randomness, no I/O.
 */
export function boardOf(view: AcceptedView, selection: string | null): BoardModel {
  const raw = asRecord(view.view);
  const cards = asList(raw.cards);

  // Lanes: the eight canonical lanes first (even when empty), then one
  // trailing column per unknown lane value, in first-appearance order.
  const byLane = new Map<string, Record<string, unknown>[]>();
  for (const lane of closedSetLanes) byLane.set(lane, []);
  const unknownOrder: string[] = [];
  for (const card of cards) {
    const lane = columnOf(card);
    const key = typeof lane === "string" ? lane : "?";
    let list = byLane.get(key);
    if (list === undefined) {
      list = [];
      byLane.set(key, list);
      unknownOrder.push(key);
    }
    list.push(card);
  }
  const lanes: BoardLane[] = [...closedSetLanes, ...unknownOrder].map((lane) => {
    const list = byLane.get(lane) ?? [];
    return { lane, cards: list, empty: list.length === 0 };
  });

  // Features: ordered as the strip orders them (live first, newest lastAt,
  // then never-run in first-appearance order of the view's cards).
  const stripRows = summaryOf(view.view, new Set<string>());
  const features: BoardFeature[] = stripRows.rows.map((row) => ({
    name: row.feature,
    cards: row.cards as readonly Record<string, unknown>[],
    approved: row.approved,
    run: row.run as Record<string, unknown> | null,
  }));

  const laneCounts = new Map<string, number>(lanes.map((l) => [String(l.lane), l.cards.length]));
  const windowed = lanes.some((l) => l.cards.length > DEFAULT_THRESHOLD);
  const boardHasCards = cards.length > 0;

  // One condition banner (role=status), a direct child of the root.
  const banners: ElementNode[] = [
    el(
      "div",
      { class: "sskh-banner", role: "status" },
      "This board is a projection of the run. Nothing here changes a run except an explicit stop or resume.",
    ),
  ];

  // The selection: the chosen card carries its own detail (F151-FR-043) and
  // the feature's detail sits beside it; client state only, no fetch.
  const selectedCard = selection === null ? null : (cards.find((card) => card.id === selection) ?? null);
  const detail = selectedCard !== null && asRecord(selectedCard.detail) !== null && Object.keys(asRecord(selectedCard.detail)).length > 0 ? asRecord(selectedCard.detail) : null;
  const featureName = selectedCard !== null && typeof selectedCard.feature === "string" ? selectedCard.feature : null;
  const featureDetails = asRecord(raw.featureDetails);
  const featureDetail =
    featureName !== null && Object.keys(asRecord(featureDetails[featureName])).length > 0 ? asRecord(featureDetails[featureName]) : null;

  return {
    view,
    banners,
    viewSource: view.source,
    marker: null,
    lanes,
    features,
    attention: Array.isArray(raw.attention) ? (raw.attention as unknown[]) : [],
    budget: Array.isArray(raw.budget) ? (raw.budget as unknown[]) : [],
    approvals: Array.isArray(raw.phases) ? (raw.phases as unknown[]) : [],
    windowed,
    strip: windowed ? null : stripOf(stripRows.rows, laneCounts, boardHasCards, stripRows.more),
    selectedCardId: selectedCard !== null && typeof selectedCard.id === "string" ? selectedCard.id : null,
    selectedCard,
    detail,
    featureDetail,
  };
}
