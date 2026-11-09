/**
 * The session-log grader of the Hermes host (T068, PT-150-046,
 * F150-FR-046): it grades a recorded `hermes chat --format stream-json`
 * session log (HF-STREAM-JSON) by the skill the session loaded, and reports
 * an interrupted run (exit 130) and a run ended by a provider usage limit
 * as NOT SCORED, never as a failure.
 *
 * The one load event the grader trusts is a `tool_use` of `skill_view`
 * naming the skill — the event HF-STREAM-JSON verifies at the pin. The
 * session-log event that would mark a skill load directly is NOT settled
 * (U-150-09): where a caller marks a log as holding only such an unverified
 * typed-load event, the grader refuses to score it and names the U-item.
 *
 * Nothing here calls a model: the grader reads recorded behaviour only.
 */
import { readFileSync } from "node:fs";

/** One parsed event of a `stream-json` session log (HF-STREAM-JSON). */
export type SessionEvent = {
  readonly type: string;
  readonly [field: string]: unknown;
};

/** A `tool_use` event of `skill_view`, with the skill it named. */
export type SkillViewEvent = {
  readonly event: SessionEvent;
  readonly skill: string;
};

/** The parsed events of one session log, with the load it recorded. */
export type SessionLog = {
  readonly events: readonly SessionEvent[];
  /** The first `skill_view` tool_use, or null when none fired. */
  readonly skillView: SkillViewEvent | null;
  /** The terminal `result` event, or null when the log holds none. */
  readonly result: SessionEvent | null;
};

/** The grade of one recorded session against one expected skill. */
export type Grade =
  | { readonly outcome: "matched"; readonly expected: string | null; readonly loaded: string | null }
  | {
      readonly outcome: "not-matched";
      readonly expected: string | null;
      readonly loaded: string | null;
    }
  | { readonly outcome: "not-scored"; readonly reason: string };

/** A `result.error` that names a provider usage limit (not a score failure). */
const USAGE_LIMIT_PATTERN = /(usage|rate|quota)[ -]?limit|provider limit|insufficient quota/i;

/** The interrupted exit code a POSIX runner reports for SIGINT. */
const INTERRUPTED_EXIT_CODE = 130;

/** Parse a `stream-json` log (one JSON event a line) into a SessionLog. */
export function parseSessionLog(text: string): SessionLog {
  const events: SessionEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      events.push(JSON.parse(trimmed) as SessionEvent);
    } catch {
      // A malformed line is data the grader does not guess about: it is
      // skipped, and the grade below judges only well-formed events.
    }
  }
  let skillView: SkillViewEvent | null = null;
  let result: SessionEvent | null = null;
  for (const event of events) {
    if (
      skillView === null &&
      event.type === "tool_use" &&
      event.name === "skill_view" &&
      typeof (event.input as { name?: unknown } | undefined)?.name === "string"
    ) {
      skillView = { event, skill: (event.input as { name: string }).name };
    }
    if (event.type === "result") result = event;
  }
  return { events, skillView, result };
}

/**
 * Options of the grade. `typedLoadUnverified` marks a log that recorded a
 * direct skill-load event whose shape is NOT settled (U-150-09): the grader
 * then scores nothing and names the U-item, because grading an event whose
 * meaning is unverified would make the suite a guess.
 */
export type GradeOptions = {
  readonly typedLoadUnverified?: boolean;
};

/** The skill a `tool_use` of `skill_view` named, or null. */
export function loadedSkillOf(log: SessionLog): string | null {
  return log.skillView === null ? null : log.skillView.skill;
}

/** Grade one parsed session log against the expected skill (null: none). */
export function gradeParsedSessionLog(
  log: SessionLog,
  expected: string | null,
  options: GradeOptions = {},
): Grade {
  const loaded = loadedSkillOf(log);
  // A typed skill-load event whose meaning is unverified is never graded
  // (U-150-09): not scored, with the reason a person can settle.
  if (options.typedLoadUnverified === true && log.events.some((e) => e.type === "skill_load")) {
    return {
      outcome: "not-scored",
      reason:
        "unverified typed skill-load event (U-150-09): the session-log event that marks a skill load is not settled",
    };
  }
  // An interrupted run is not a score failure (F150-FR-046).
  const exitCode = log.result?.exit_code;
  if (exitCode === INTERRUPTED_EXIT_CODE) {
    return { outcome: "not-scored", reason: `interrupted (exit ${INTERRUPTED_EXIT_CODE})` };
  }
  // A run ended by a provider usage limit is not a score failure.
  const error = log.result?.error;
  if (typeof error === "string" && USAGE_LIMIT_PATTERN.test(error)) {
    return { outcome: "not-scored", reason: "usage limit" };
  }
  if (loaded === expected) {
    return { outcome: "matched", expected, loaded };
  }
  return { outcome: "not-matched", expected, loaded };
}

/** Grade one recorded session log (the text of a `.jsonl` file). */
export function gradeSessionLog(
  text: string,
  expected: string | null,
  options: GradeOptions = {},
): Grade {
  return gradeParsedSessionLog(parseSessionLog(text), expected, options);
}

/** Read one fixture file under `evals/fixtures/` and grade it. */
export function gradeFixtureFile(path: string, expected: string | null, options: GradeOptions = {}) {
  return gradeSessionLog(readFileSync(path, "utf8"), expected, options);
}
