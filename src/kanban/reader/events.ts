/**
 * The event fold of the workspace reader (T016; PT-151-038;
 * contracts/workspace-reader.md §2, F151-FR-038; data-model.md RunFacts).
 *
 * Both event streams (the TS engine's `runs/<runId>/events.jsonl` and the
 * bash engine's `.specstride/events.jsonl`) parse line by line; a torn or
 * malformed line is skipped. The fold produces RunFacts. The activity table
 * is the one of contracts/workspace-reader.md §2 (ported from dsh
 * `workspace-view.ts:318-379` and the bash stream's `:186-225`); an event
 * type the table does not know changes NOTHING. The activity is returned as
 * a NAME — no lane is assigned here; `lanes.ts` (the only lane-assigning
 * file) reads the name.
 */

/** The RunFacts the fold produces (data-model.md). */
export interface RunFacts {
  /** The newest `phase.started` phase number, or null. */
  currentPhase: number | null;
  /** The activity NAME of the newest known activity event, or null. */
  activity: string | null;
  /** The number of `task.done` events. */
  done: number;
  /** True once a `run.ended` event has been folded. */
  ended: boolean;
  /** The recorded outcome of the end, verbatim, or null. */
  outcome: string | null;
  /** The lane the end maps to (`paused` or `blocked`), or null. */
  endLane: string | null;
  /** The recorded end reason, verbatim, or null. */
  why: string | null;
  /** The ISO time of the newest KNOWN event, or null. */
  lastAt: string | null;
  /** The number of error events folded. */
  errors: number;
}

export interface ParsedEvent {
  readonly type: string;
  readonly at: string | null;
  readonly fields: Record<string, unknown>;
}

/** The activity table of §2: an event type → the activity NAME. */
export const ACTIVITY_TABLE: Readonly<Record<string, string>> = Object.freeze({
  "phase.started": "proposing",
  "attempt.started": "proposing",
  "pass.started": "proposing",
  iter_start: "proposing",
  "run.resumed": "proposing",
  unblocked: "proposing",
  "yield.ended": "proposing",
  "verification.started": "verifying",
  "check.started": "verifying",
  "job.started": "verifying",
  "critic.started": "reviewing",
  "critic.call": "reviewing",
  "verdict.recorded": "reviewing",
  "run.paused": "paused",
  "yield.started": "paused",
  blocked: "blocked",
});

/** The event types the fold knows; anything else leaves the state unchanged. */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(ACTIVITY_TABLE),
  "run.started",
  "run.ended",
  "phase.ended",
  "task.done",
  "error",
  "run.error",
  "attempt.failed",
  "job.failed",
]);

/** The event types that count as errors. */
const ERROR_TYPES: ReadonlySet<string> = new Set(["error", "run.error", "attempt.failed", "job.failed"]);

/** The end outcomes that leave the run on `paused` (§5, E2). */
const PAUSED_OUTCOMES: ReadonlySet<string> = new Set(["stopped", "paused", "yield", "quota"]);

/** The end outcomes that put the run on `blocked` (§5, E2). */
const BLOCKED_OUTCOMES: ReadonlySet<string> = new Set(["blocked", "blocked-on-human", "halt", "human"]);

export function emptyFacts(): RunFacts {
  return {
    currentPhase: null,
    activity: null,
    done: 0,
    ended: false,
    outcome: null,
    endLane: null,
    why: null,
    lastAt: null,
    errors: 0,
  };
}

/** Parse one stream's text into its events; torn and malformed lines are skipped. */
export function parseEvents(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const lines = text.split("\n");
  // A trailing fragment without its newline is a torn line: skipped.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const fields = record as Record<string, unknown>;
    const type = fields.type;
    if (typeof type !== "string") continue;
    events.push({ type, at: typeof fields.at === "string" ? fields.at : null, fields });
  }
  return events;
}

/** Merge two streams in order: by `seq` where both carry one, else stream order. */
export function mergeStreams(first: ParsedEvent[], second: ParsedEvent[]): ParsedEvent[] {
  const seqOf = (event: ParsedEvent): number | null => {
    const seq = event.fields.seq;
    return typeof seq === "number" ? seq : null;
  };
  if (first.every((event) => seqOf(event) !== null) && second.every((event) => seqOf(event) !== null)) {
    return [...first, ...second].sort((a, b) => (seqOf(a) as number) - (seqOf(b) as number));
  }
  return [...first, ...second];
}

/** The end lane of an outcome: `paused`, `blocked`, or null (no end lane). */
export function endLaneOf(outcome: string | null): string | null {
  if (outcome === null) return null;
  if (PAUSED_OUTCOMES.has(outcome)) return "paused";
  if (BLOCKED_OUTCOMES.has(outcome)) return "blocked";
  return null;
}

/** Fold events into RunFacts; the last write wins, in the given order. */
export function foldEvents(events: ParsedEvent[]): RunFacts {
  const facts = emptyFacts();
  for (const event of events) {
    if (!KNOWN_TYPES.has(event.type)) continue; // unknown: no state change at all
    if (event.at !== null) facts.lastAt = event.at;
    switch (event.type) {
      case "phase.started": {
        const phase = event.fields.phase;
        if (typeof phase === "number") facts.currentPhase = phase;
        facts.activity = ACTIVITY_TABLE[event.type];
        break;
      }
      case "run.ended": {
        facts.ended = true;
        const outcome = event.fields.outcome;
        if (typeof outcome === "string") facts.outcome = outcome;
        else if (event.fields.state !== undefined && typeof event.fields.state === "string") facts.outcome = event.fields.state as string;
        const why = event.fields.why ?? event.fields.reason;
        if (typeof why === "string") facts.why = why;
        facts.endLane = endLaneOf(facts.outcome);
        break;
      }
      case "task.done":
        facts.done += 1;
        break;
      default:
        if (ERROR_TYPES.has(event.type)) {
          facts.errors += 1;
          const why = event.fields.why ?? event.fields.reason;
          if (typeof why === "string") facts.why = why;
        } else {
          facts.activity = ACTIVITY_TABLE[event.type] ?? facts.activity;
        }
        break;
    }
  }
  return facts;
}

/** Parse one stream's text and fold it. */
export function foldStream(text: string): RunFacts {
  return foldEvents(parseEvents(text));
}

/** Parse and merge both streams, then fold (the reader's entry). */
export function foldStreams(tsStream: string, bashStream: string): RunFacts {
  return foldEvents(mergeStreams(parseEvents(tsStream), parseEvents(bashStream)));
}
