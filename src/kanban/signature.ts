/**
 * The change signature (T017; PT-151-040; data-model.md "ChangeSignature",
 * F151-FR-040, F151-FR-049). The token is the sha256 over the members of the
 * closed set "Signature members", in the set's order: cards (id, lane,
 * flags.stale), attention (key, oneLine), launches (launchId, state), run
 * (id, launch, state, phase, startedAt, lastAt), agents (role, pid, what),
 * usage (calls, retries), phase (tasksDone, attempts, counters, units).
 *
 * An engine view — one without a `source` member — carries the engine's own
 * token, and the host uses it verbatim: the host never re-derives a token
 * the engine already made. A reader view has no engine token, so the host
 * computes one over the same member list. The cursor token is
 * `<offset>.<lastSeq>.<8 hex>` of the view token. Pure: bytes in, bytes out.
 */
import { createHash } from "node:crypto";

type RecordOf = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const record = (value: unknown): RecordOf => (typeof value === "object" && value !== null ? (value as RecordOf) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The digest of one serialization of the member list. */
function digest(members: unknown): string {
  return createHash("sha256").update(JSON.stringify(members), "utf8").digest("hex");
}

/** `[launchId, state]` rows of a launch list. */
function launchRows(launches: unknown): unknown[] {
  return list(launches).map((entry) => {
    const launch = record(entry);
    return [text(launch.launchId), text(launch.state ?? launch.outcome)];
  });
}

/** `[role, pid, what]` rows of an agent list. */
function agentRows(agents: unknown): unknown[] {
  return list(agents).map((entry) => {
    const agent = record(entry);
    return [text(agent.role), num(agent.pid), text(agent.what ?? agent.kind)];
  });
}

/** `[tasksDone, attempts, counters, units]` rows of a PhaseDetail. */
function phaseRows(detail: unknown): unknown[] {
  const phase = record(detail);
  return [
    num(phase.tasksDone),
    list(phase.attempts).map((attempt) => {
      const row = record(attempt);
      return [text(row.outcome), num(row.passes)];
    }),
    record(phase.counters),
    record(phase.units),
  ];
}

/** The sha256 over the "Signature members" of a view (reader views). */
export function computeSignature(view: unknown): string {
  const v = record(view);
  const features = record(v.featureDetails);
  const featureIds = Object.keys(features).sort(); // deterministic order
  const members: unknown = [
    // cards: id, lane, flags.stale
    list(v.cards).map((entry) => {
      const card = record(entry);
      return [text(card.id), text(card.lane), record(card.flags).stale === true];
    }),
    // attention: key, oneLine
    list(v.attention).map((entry) => {
      const item = record(entry);
      return [text(item.key), text(item["one-line"] ?? item.oneLine ?? item.text)];
    }),
    // launches: launchId, state (the view-level launch rows)
    launchRows(v.launches),
    // run: id, launch, state, phase, startedAt, lastAt
    featureIds.map((id) => {
      const run = record(record(features[id]).run);
      return [
        text(run.id),
        text(run.launch),
        text(run.state),
        num(run.phase),
        text(run.startedAt),
        text(run.lastAt),
      ];
    }),
    // agents: role, pid, what
    featureIds.flatMap((id) => agentRows(record(features[id]).agents)),
    // usage: calls, retries
    featureIds.map((id) => {
      const usage = record(record(features[id]).usage);
      return [num(usage.calls), num(usage.retries)];
    }),
    // phase: tasksDone, attempts, counters, units
    featureIds.flatMap((id) => {
      const detail = record(record(features[id]).detail);
      if (Object.keys(detail).length === 0) return [];
      return [phaseRows(detail)];
    }),
  ];
  return digest(members);
}

/**
 * The token of a view: the engine's own token for an engine view (no
 * `source` member), otherwise the computed one (F151-FR-040).
 */
export function changeSignature(view: unknown): string {
  const v = record(view);
  const engineToken = record(v.signature).token;
  if (v.source === undefined && typeof engineToken === "string") return engineToken;
  return computeSignature(view);
}

/** The cursor token, `<offset>.<lastSeq>.<8 hex>` (F151-FR-049). */
export function cursorToken(cursor: unknown, viewToken: string): string {
  const c = record(cursor);
  return `${String(num(c.offset) ?? 0)}.${String(num(c.lastSeq) ?? 0)}.${viewToken.slice(0, 8)}`;
}
