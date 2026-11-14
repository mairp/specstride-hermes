/**
 * The diff (T037; PT-151-007, PT-151-040; contracts/card-projection.md
 * "Write sequence per transition", contracts/sync-sidecar.md; F151-FR-012,
 * F151-FR-040). Wanted (the projection) vs stored (our store) vs actual
 * (the read-back) → the minimal ordered verb list.
 *
 * Verbs of US1 and US3, in a stable order: `create`, `schedule`, `edit`,
 * `complete`, `archive`, and — attention cards only (F151-FR-014) —
 * `promote` then `block --kind needs_input <text verbatim>`: a new attention
 * card is `create` → `promote` → `block`, exactly once; an attention card
 * that the store holds as blocked is never blocked again (a re-block of the
 * same kind routes to `triage`, P00 P2-2) and never unblocked; when the item
 * leaves the view the card is archived, and a recurring item is a new card
 * (new key → new create). Never `link`, `claim`, `heartbeat`,
 * `request-review`, `delete`, `decompose`, `specify`, `swarm` (there is no
 * code path here that could emit one). The signature is a pure sha256 over
 * the wanted set's material fields; the caller short-circuits on it before
 * any `hermes` call is made.
 *
 * Pure: no file, no spawn, no clock.
 */
import { createHash } from "node:crypto";
import type { WantedCard } from "./project.ts";

/** One planned verb: the verb, the card key and, when known, the Hermes id. */
export interface PlannedVerb {
  readonly verb: "create" | "schedule" | "edit" | "complete" | "archive" | "promote" | "block" | "comment";
  /** The card key — the idempotency key of the call. */
  readonly key: string;
  /** The Hermes id, when the verb addresses an existing card. */
  readonly id: string | null;
  /** The wanted card, for `create` and `edit` (title and body). */
  readonly card: WantedCard | null;
  /** The `--result` text of `complete`. */
  readonly result: string | null;
  /** The verbatim block text of `block` (attention cards only). */
  readonly blockText: string | null;
  /** The text of `comment` (the one stale comment of a human-edited card). */
  readonly commentText?: string;
}

/** The one stale comment a human-edited card ever gets (sync-sidecar.md). */
export const STALE_COMMENT = "stale — edited outside Specstride; column kept in sync";

/** The stored card of the projection store (structural subset). */
export interface StoredCard {
  key: string;
  hermesId: string | null;
  column: string;
  title: string;
  body: string;
  assignee: string;
  tenant: string;
  humanEdited: boolean;
}

/** One read-back card (from `hermes kanban show <id> --json`). */
export interface ActualCard {
  key: string;
  hermesId: string;
  column: string;
  /** The assignee the board reports; absent when `show` did not carry one. */
  assignee?: string;
  /** The tenant the board reports; absent when `show` did not carry one. */
  tenant?: string;
  /** The title the board reports; absent when `show` did not carry one. */
  title?: string;
  /** The body the board reports; absent when `show` did not carry one. */
  body?: string;
}

/** The stable change signature over the wanted set (F151-FR-040). */
export function signatureOfWanted(wanted: readonly WantedCard[]): string {
  const members = wanted.map((card) => [
    card.key,
    card.column,
    card.title,
    card.body,
    card.assignee,
    card.tenant,
  ]);
  return createHash("sha256").update(JSON.stringify(members)).digest("hex");
}

/** Whether a stored card must be re-written: any material field differs. */
function materialDiffers(stored: StoredCard, wanted: WantedCard): boolean {
  return (
    stored.column !== wanted.column ||
    stored.title !== wanted.title ||
    stored.body !== wanted.body ||
    stored.assignee !== wanted.assignee ||
    stored.tenant !== wanted.tenant
  );
}

export interface PlanInputs {
  /** The wanted card set of this cycle, in projection order. */
  readonly wanted: readonly WantedCard[];
  /** The stored cards of our store (keys no longer wanted are archived). */
  readonly stored: readonly StoredCard[];
  /** The read-back of the board; absent when no read-back ran this cycle. */
  readonly actual?: ReadonlyMap<string, ActualCard>;
}

/**
 * The minimal ordered verb list of one cycle: per wanted card, in wanted
 * order, `create` + `schedule` when it is new; `complete` when it moves to
 * `done`; `edit` when a material field changed (never on a `humanEdited`
 * card's text); a column restore from the read-back; then one `archive`
 * per stored key that is no longer wanted — never a delete.
 */
export function planVerbs(inputs: PlanInputs): PlannedVerb[] {
  const verbs: PlannedVerb[] = [];
  const wantedKeys = new Set(inputs.wanted.map((card) => card.key));
  const storedByKey = new Map(inputs.stored.map((card) => [card.key, card]));

  for (const card of inputs.wanted) {
    const stored = storedByKey.get(card.key);
    if (stored === undefined) {
      if (card.role === "attention") {
        // New attention card (F151-FR-014): `create` → `promote` →
        // `block --kind needs_input <text verbatim>`; never `schedule`
        // (the card belongs in `blocked`, where the map never puts a stage
        // or root card) and the block happens once, at creation.
        verbs.push({ verb: "create", key: card.key, id: null, card, result: null, blockText: null });
        verbs.push({ verb: "promote", key: card.key, id: null, card: null, result: null, blockText: null });
        verbs.push({
          verb: "block",
          key: card.key,
          id: null,
          card: null,
          result: null,
          blockText: card.attentionText ?? card.engineValue,
        });
        continue;
      }
      // new → `create`, then `schedule` into the mapped column
      verbs.push({ verb: "create", key: card.key, id: null, card, result: null, blockText: null });
      verbs.push({ verb: "schedule", key: card.key, id: null, card, result: null, blockText: null });
      continue;
    }
    const actual = inputs.actual?.get(card.key);
    // A foreign column move OR a foreign assignee/tenant (guard A) is
    // restored within the cycle (≤ 60 s): one `schedule` of the known id,
    // whose argv carries the guard surface again (F151-FR-010, F151-FR-027).
    const foreignColumn = actual !== undefined && actual.column !== card.column;
    const foreignGuards =
      actual !== undefined &&
      ((actual.assignee !== undefined && actual.assignee !== card.assignee) ||
        (actual.tenant !== undefined && actual.tenant !== card.tenant));
    if (foreignColumn || foreignGuards) {
      verbs.push({ verb: "schedule", key: card.key, id: actual.hermesId, card, result: null, blockText: null });
    }
    // A foreign title or body (a human edit): one stale comment, the text is
    // never written again (the `edit` below is suppressed once the store
    // marks the card `humanEdited`), the column is still kept in sync
    // (sync-sidecar.md "Foreign writes").
    const foreignText =
      actual !== undefined &&
      ((actual.title !== undefined && actual.title !== stored.title) ||
        (actual.body !== undefined && actual.body !== stored.body));
    if (foreignText && !stored.humanEdited) {
      verbs.push({
        verb: "comment",
        key: card.key,
        id: actual.hermesId,
        card: null,
        result: null,
        blockText: null,
        commentText: STALE_COMMENT,
      });
    }
    if (stored.column !== "done" && card.column === "done") {
      // `scheduled` → `done`: the engine verb of the transition table
      verbs.push({
        verb: "complete",
        key: card.key,
        id: stored.hermesId,
        card,
        result: `${card.label} (engine)`,
        blockText: null,
      });
      continue;
    }
    if (materialDiffers(stored, card) && !stored.humanEdited) {
      // `scheduled` → `scheduled` with a changed body member: one edit
      verbs.push({ verb: "edit", key: card.key, id: stored.hermesId, card, result: null, blockText: null });
    }
  }

  // Keys the store holds that the wanted set no longer holds → archive.
  for (const stored of inputs.stored) {
    if (!wantedKeys.has(stored.key)) {
      verbs.push({ verb: "archive", key: stored.key, id: stored.hermesId, card: null, result: null, blockText: null });
    }
  }
  return verbs;
}
