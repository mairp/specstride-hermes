/**
 * The presentation table lookups (T057; F151-FR-025; contracts/presentation.md).
 *
 * One pure table per set — lane, attention kind, budget level, and the detail
 * states (task, alive, outcome, launch) — gives glyph, label, grayscale and
 * theme token together, so glyph and label travel with colour everywhere and
 * colour never carries state alone (lesson L11; OD-151-7). The values are the
 * generated rows of `src/kanban/generated/closed-sets.ts`, which the contract
 * test holds equal to `contracts/151-hermes-kanban/closed-sets.json`; the
 * grayscale ladder and glyphs are dsh's
 * (`packages/dsh-kanban/src/shared/presentation.ts:61-93` at `ab8093e`).
 *
 * A value the table does not know renders as `?` with the raw value as label,
 * the set's unknown grayscale and `--color-border` (F151-FR-019, F151-FR-025).
 * No function of this file returns a lane: the table maps members to
 * presentation and nothing to a lane (F151-FR-025); the board's columns come
 * from `board-model.ts` reading `card.lane` only.
 */
import { el, txt, type ElementNode, type VNode } from "./tree.ts";
import {
  lanePresentation,
  attentionPresentation,
  budgetPresentation,
  taskPresentation,
  alivePresentation,
  outcomePresentation,
  launchPresentation,
  type ThemeToken,
} from "../../kanban/generated/closed-sets.ts";

/** One row of a presentation table: the four channels that travel together. */
export interface Presentation {
  readonly glyph: string;
  readonly label: string;
  readonly grayscale: number;
  readonly token: ThemeToken;
  readonly mix?: { readonly percent: number; readonly with: ThemeToken };
}

interface TableRow {
  glyph: string;
  grayscale: number;
  label: string;
  token: ThemeToken;
  mix?: { percent: number; with: ThemeToken };
}

interface PresentationSet {
  id: string;
  members: readonly (TableRow & Record<string, unknown>)[];
  unknown?: TableRow & Record<string, unknown>;
  rule?: string;
}

const UNKNOWN_TOKEN: ThemeToken = "--color-border";

/**
 * A lookup over one generated set. The unknown row's label in the generated
 * document is the placeholder text "the raw value, as text"; a lookup of an
 * unknown member returns the raw value itself as the label (F151-FR-025).
 */
function lookup(
  set: PresentationSet,
  key: string,
  value: string | null | undefined,
): Presentation {
  for (const row of set.members) {
    if (row[key] === value) return toPresentation(row);
  }
  const unknown = set.unknown ?? { glyph: "?", grayscale: 112, label: "", token: UNKNOWN_TOKEN };
  return { ...toPresentation(unknown), label: value === null || value === undefined || value === "" ? "?" : String(value) };
}

/** Only the four channels (and the optional mix) leave this file: the
 * generated row's own key (`lane`, `kind`, …) never does, so no lookup hands
 * back a lane (F151-FR-025). */
function toPresentation(row: TableRow): Presentation {
  const p: Presentation = {
    glyph: row.glyph,
    label: row.label,
    grayscale: row.grayscale,
    token: row.token,
  };
  if (row.mix) p.mix = row.mix;
  return p;
}

/** The lane table (`kanban-lane-presentation`). */
export const LANES_SET: PresentationSet = lanePresentation;
/** The attention-kind table (`kanban-attention-presentation`). */
export const ATTENTION_SET: PresentationSet = attentionPresentation;
/** The budget-level table (`kanban-budget-presentation`). */
export const BUDGET_SET: PresentationSet = budgetPresentation;
/** The detail task-state table (`kanban-task-presentation`). */
export const TASK_SET: PresentationSet = taskPresentation;
/** The detail agent-liveness table (`kanban-alive-presentation`). */
export const ALIVE_SET: PresentationSet = alivePresentation;
/** The detail phase-outcome table (`kanban-outcome-presentation`). */
export const OUTCOME_SET: PresentationSet = outcomePresentation;
/** The detail launch-state table (`kanban-launch-presentation`). */
export const LAUNCH_SET: PresentationSet = launchPresentation;

/** The presentation of a lane (the eight engine lanes, or `?` for one the map
 * does not know — F151-FR-005, F151-FR-019). */
export function laneOf(value: string | null | undefined): Presentation {
  return lookup(LANES_SET, "lane", value);
}

/** The presentation of an attention kind. */
export function attentionOf(value: string | null | undefined): Presentation {
  return lookup(ATTENTION_SET, "kind", value);
}

/** The presentation of a budget level. */
export function budgetOf(value: string | null | undefined): Presentation {
  return lookup(BUDGET_SET, "level", value);
}

/** The presentation of a detail task state (`done`, `met`, `open`, `unmet`). */
export function taskStateOf(value: string | null | undefined): Presentation {
  return lookup(TASK_SET, "state", value);
}

/** The presentation of a detail agent liveness (`alive`, `unknown`, `gone`). */
export function aliveOf(value: string | null | undefined): Presentation {
  return lookup(ALIVE_SET, "state", value);
}

/** The presentation of a detail phase outcome. */
export function outcomeOf(value: string | null | undefined): Presentation {
  return lookup(OUTCOME_SET, "outcome", value);
}

/** The presentation of a detail launch state. */
export function launchStateOf(value: string | null | undefined): Presentation {
  return lookup(LAUNCH_SET, "state", value);
}

/** The seven sets with their key, for the totality test (PT-151-025). */
export const PRESENTATION_SETS: readonly { readonly set: PresentationSet; readonly key: string; readonly of: (v: string) => Presentation }[] = [
  { set: LANES_SET, key: "lane", of: laneOf },
  { set: ATTENTION_SET, key: "kind", of: attentionOf },
  { set: BUDGET_SET, key: "level", of: budgetOf },
  { set: TASK_SET, key: "state", of: taskStateOf },
  { set: ALIVE_SET, key: "state", of: aliveOf },
  { set: OUTCOME_SET, key: "outcome", of: outcomeOf },
  { set: LAUNCH_SET, key: "state", of: launchStateOf },
];

/** The attribute a badge of a set carries for the stylesheet tint: lanes tint
 * by `[data-lane]` from the card's own lane; every other set by
 * `[data-tint]` with the member key (contracts/presentation.md "Styles"). */
export function tintAttr(set: PresentationSet, value: string): { name: string; value: string } {
  return set === LANES_SET ? { name: "data-lane", value } : { name: "data-tint", value };
}

/**
 * A badge: the glyph as text with the label as `aria-label` and the grayscale
 * as `data-gray`, wherever a tint is shown (F151-FR-025; PT-151-025). A pure
 * builder over the lookups — no clock, no randomness, no markup.
 */
export function badge(set: PresentationSet, value: string | null | undefined, extraClass?: string): ElementNode {
  const key = PRESENTATION_SETS.find((entry) => entry.set === set)?.key ?? "state";
  const p = lookup(set, key, value);
  const tint = tintAttr(set, value ?? "?");
  const classes = extraClass ? `sskh-badge ${extraClass}` : "sskh-badge";
  const child: VNode = txt(p.glyph);
  return el(
    "span",
    {
      class: classes,
      "aria-label": p.label,
      "data-gray": String(p.grayscale),
      [tint.name]: tint.value,
      title: p.label,
    },
    child,
  );
}
