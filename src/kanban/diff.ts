/**
 * The diff (T037; PT-151-007, PT-151-040; contracts/card-projection.md
 * "Write sequence per transition", contracts/sync-sidecar.md; F151-FR-012,
 * F151-FR-040). Wanted (the projection) vs stored (our store) vs actual
 * (the read-back) → the minimal ordered verb list.
 *
 * Verbs of US1, in a stable order: `create`, `schedule`, `edit`,
 * `complete`, `archive` — never `link`, `claim`, `heartbeat`,
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
  readonly verb: "create" | "schedule" | "edit" | "complete" | "archive";
  /** The card key — the idempotency key of the call. */
  readonly key: string;
  /** The Hermes id, when the verb addresses an existing card. */
  readonly id: string | null;
  /** The wanted card, for `create` and `edit` (title and body). */
  readonly card: WantedCard | null;
  /** The `--result` text of `complete`. */
  readonly result: string | null;
}

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
      // new → `create`, then `schedule` into the mapped column
      verbs.push({ verb: "create", key: card.key, id: null, card, result: null });
      verbs.push({ verb: "schedule", key: card.key, id: null, card, result: null });
      continue;
    }
    const actual = inputs.actual?.get(card.key);
    if (actual !== undefined && actual.column !== card.column) {
      // a foreign column move is restored within the cycle (≤ 60 s)
      verbs.push({ verb: "schedule", key: card.key, id: actual.hermesId, card, result: null });
    }
    if (stored.column !== "done" && card.column === "done") {
      // `scheduled` → `done`: the engine verb of the transition table
      verbs.push({
        verb: "complete",
        key: card.key,
        id: stored.hermesId,
        card,
        result: `${card.label} (engine)`,
      });
      continue;
    }
    if (materialDiffers(stored, card) && !stored.humanEdited) {
      // `scheduled` → `scheduled` with a changed body member: one edit
      verbs.push({ verb: "edit", key: card.key, id: stored.hermesId, card, result: null });
    }
  }

  // Keys the store holds that the wanted set no longer holds → archive.
  for (const stored of inputs.stored) {
    if (!wantedKeys.has(stored.key)) {
      verbs.push({ verb: "archive", key: stored.key, id: stored.hermesId, card: null, result: null });
    }
  }
  return verbs;
}
