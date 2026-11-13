/**
 * View acceptance (T013; PT-151-035; data-model.md "ReaderView",
 * contracts/workspace-reader.md §9, F151-FR-035). `acceptView` first
 * validates with `isRunView` of the pinned contracts, then reads the
 * ADDITIVE members of a reader view leniently: `source` (an absent source
 * reads as `engine`), `cards[].rule`, `cards[].ruleId`, `cards[].title`,
 * `cards[].detail` and `featureDetails`. A `source` outside the closed set
 * "View sources" refuses the view. Unknown members of the engine's closed
 * sets are accepted and passed through as the strings they are — a newer
 * engine member never breaks the host.
 */
import { isRunView, type RunView } from "@specstride/contracts/records/run-view";
import { closedSetViewSources } from "./generated/closed-sets.ts";

/** The closed set "View sources". */
export type ViewSource = (typeof closedSetViewSources)[number];

/** One card's additive members, read leniently (strings, or absent). */
export interface CardExtras {
  readonly rule: string | null;
  readonly ruleId: string | null;
  readonly title: string | null;
  readonly detail: unknown | null;
}

/** What acceptance yields: the validated view, its source and the additive reads. */
export interface AcceptedView {
  readonly ok: true;
  readonly view: RunView;
  readonly raw: Record<string, unknown>;
  readonly source: ViewSource;
  readonly cards: readonly CardExtras[];
  /** `featureDetails` when the view carries it as a record; otherwise absent. */
  readonly featureDetails: Record<string, unknown> | null;
}

export type RefusedView = { readonly ok: false; readonly reason: string };

/**
 * Accept a view: validate first, then read the additive members leniently.
 * Refusal is a `{ok: false}` value, never a throw.
 */
export function acceptView(raw: unknown): AcceptedView | RefusedView {
  // 1. The schema validation of the pinned contracts, unchanged.
  if (!isRunView(raw)) {
    return { ok: false, reason: "the view failed isRunView of the pinned @specstride/contracts" };
  }
  const record = raw as unknown as Record<string, unknown>;
  // 2. `source`: an absent source reads as `engine` (data-model.md).
  const rawSource = record.source;
  let source: ViewSource;
  if (rawSource === undefined) {
    source = "engine";
  } else if (typeof rawSource === "string" && (closedSetViewSources as readonly string[]).includes(rawSource)) {
    source = rawSource as ViewSource;
  } else {
    return {
      ok: false,
      reason: `the view source ${JSON.stringify(rawSource)} is outside the closed set "View sources" (${closedSetViewSources.join(", ")})`,
    };
  }
  // 3. The additive card members, read leniently: absent or wrong-typed
  // members read as null, never throw; unknown lane/ruleId values pass
  // through as the strings they are.
  const rawCards = Array.isArray(record.cards) ? record.cards : [];
  const cards: CardExtras[] = rawCards.map((entry) => {
    const card = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
    return {
      rule: text(card.rule),
      ruleId: text(card.ruleId),
      title: text(card.title),
      detail:
        typeof card.detail === "object" && card.detail !== null ? card.detail : null,
    };
  });
  const featureDetails =
    typeof record.featureDetails === "object" && record.featureDetails !== null
      ? (record.featureDetails as Record<string, unknown>)
      : null;
  return { ok: true, view: raw, raw: record, source, cards, featureDetails };
}
