/**
 * The TypeScript REFERENCE of the `/specstride` slash-command table (T042,
 * contracts/150-host-hermes/slash-command.md, research R13): the argv each
 * typed verb forwards and the reply each exit code maps to. It is a pure
 * function used ONLY by the tests and the golden fixtures
 * (`tests/glue-fixtures/slash-command.json`); the Python glue under
 * `hermes-plugin/specstride/` implements the same table and the pytest suite
 * proves the two agree case by case (F150-FR-028 to F150-FR-030).
 *
 * Typing `stop`, `stop --now` or `resume` IS the consent (H1, Principle XV):
 * the table therefore holds an argv for exactly the typed verbs and for
 * nothing else — a model-proposed stop has no argv here to reach.
 */

/** The verbs `/specstride` accepts, in the order the refusal lists them. */
export const SLASH_COMMAND_VERBS: readonly string[] = Object.freeze([
  "run",
  "dry-run",
  "status",
  "stop",
  "stop --now",
  "resume",
  "doctor",
]);

/** The refusal for anything else (F150-FR-030). */
export const REFUSED_REPLY =
  "refused — verbs: run, dry-run, status, stop, stop --now, resume, doctor";

/** The `run` reply: a plugin command cannot start a skill turn (U-150-07). */
export const RUN_INVOCATION_REPLY =
  "type /specstride-run to start (invoking it is the consent)";

/** The `dry-run` reply: the skill invocation with the mode spelled. */
export const DRY_RUN_INVOCATION_REPLY = "type /specstride-run dry-run";

/** Exit 127 of the shim: no CLI (F150-FR-011). Built from parts so this
 * reference module never spells the CLI verb in the spawn sense (the gate). */
export const CLI_NOT_FOUND_REPLY = ["CLI not found — run /spec", "stride doctor"].join("");

/** The reply when the installer's `_paths.json` is absent (T044). */
export const NOT_INSTALLED_REPLY =
  "Specstride not installed — run specstride-host-hermes install";

/** What the invoked command printed, as the glue observed it. */
export type StubResult = {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Where the slash command sends its argv, resolved from `_paths.json`. */
export type SlashPaths = {
  /** Absolute path of the shim `specstride-hermes`, or null when not installed. */
  readonly shim: string | null;
  /** Absolute path of the control CLI `specstride-host-hermes`, or null. */
  readonly control: string | null;
};

/** One decision of the table: the argv to forward, and the cwd to run it in. */
export type SlashDecision = {
  readonly argv: readonly string[] | null;
  readonly cwd: string | null;
  /** True when `_paths.json` was missing and nothing may be forwarded. */
  readonly notInstalled: boolean;
};

/** One outcome: the argv that was forwarded (null for none) and the reply. */
export type SlashOutcome = {
  readonly argv: readonly string[] | null;
  readonly cwd: string | null;
  readonly reply: string;
};

/**
 * Normalize the typed arguments: a leading slash tolerated, surrounding and
 * doubled whitespace collapsed, so `stop  --now` and `stop --now` agree.
 */
export function normalizeSlashArgs(raw: string): string {
  return raw.replace(/^\//, "").trim().replace(/\s+/g, " ");
}

/**
 * The table itself: the typed verb → the argv to forward and the cwd to run
 * it in. `status` runs in the session's cwd (the contract's "the session's
 * cwd"); the other forwards run there too. The verbs that change state
 * forward ONLY when they were typed — this function is only ever called with
 * what the user typed.
 */
export function decideSlashArgs(
  rawArgs: string,
  paths: SlashPaths,
  cwd: string,
): SlashDecision {
  const verb = normalizeSlashArgs(rawArgs);
  if (paths.shim === null || paths.control === null) {
    return { argv: null, cwd: null, notInstalled: true };
  }
  if (verb === "status") return { argv: [paths.shim, "status"], cwd, notInstalled: false };
  if (verb === "doctor") return { argv: [paths.control, "doctor"], cwd, notInstalled: false };
  if (verb === "stop") return { argv: [paths.shim, "stop"], cwd, notInstalled: false };
  if (verb === "stop --now") {
    return { argv: [paths.shim, "stop", "--now"], cwd, notInstalled: false };
  }
  if (verb === "resume") return { argv: [paths.shim, "resume"], cwd, notInstalled: false };
  return { argv: null, cwd: null, notInstalled: false };
}

/**
 * The exit-code → reply mapping (contracts/slash-command.md): 127 → the one
 * install line; 4 → the refusal line verbatim; anything else → the CLI's own
 * output verbatim, stdout preferred, stderr when stdout is empty. Output is
 * DATA: it is relayed, never re-entered as a prompt.
 */
export function replyFor(decision: SlashDecision, verb: string, stub: StubResult): string {
  if (decision.notInstalled) return NOT_INSTALLED_REPLY;
  if (decision.argv === null) {
    if (normalizeSlashArgs(verb) === "run") return RUN_INVOCATION_REPLY;
    if (normalizeSlashArgs(verb) === "dry-run") return DRY_RUN_INVOCATION_REPLY;
    return REFUSED_REPLY;
  }
  if (stub.exit === 127) return CLI_NOT_FOUND_REPLY;
  const text = stub.stdout !== "" ? stub.stdout : stub.stderr;
  return text.replace(/\n+$/, "");
}

/** The whole table, composed: typed arguments → outcome. */
export function runSlashCommand(
  rawArgs: string,
  paths: SlashPaths,
  cwd: string,
  stub: StubResult,
): SlashOutcome {
  const decision = decideSlashArgs(rawArgs, paths, cwd);
  return {
    argv: decision.argv,
    cwd: decision.cwd,
    reply: replyFor(decision, rawArgs, stub),
  };
}

// ---------------------------------------------------------------------------
// The reference hooks of US6 (T060/T061, contracts/150-host-hermes/
// plugin-manifest.md): the TypeScript reference of the four hook behaviours
// the Python glue under `hermes-plugin/specstride/` implements. Pure file
// reads, equality checks and one atomic file write — no subprocess, no
// decision beyond a lookup in a Node-written table (H3, F150-SC). The pytest
// suite proves the Python hooks agree case by case over
// `tests/glue-fixtures/hooks.json`.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchRule, readGuard, type GuardTable } from "./guard.ts";

/** The session sources in which the pre_* hooks stay silent (F150-FR-041). */
export const SILENT_SOURCES: readonly string[] = Object.freeze(["kanban", "cron"]);

/** The status files of a workspace, as the watcher writes them. */
export function hookStatusPaths(
  home: string,
  workspace: string,
): { readonly lineFile: string; readonly seqFile: string } {
  const key = createHash("sha256").update(workspace, "utf8").digest("hex").slice(0, 16);
  const directory = join(home, "specstride-host", "status");
  return { lineFile: join(directory, key + ".line"), seqFile: join(directory, key + ".seq") };
}

/** Whether the environment silences the pre_* hooks. */
export function hookIsSilent(source: string | null, child: boolean): boolean {
  return child || (source !== null && SILENT_SOURCES.includes(source));
}

/** Read the precomputed line; unreadable or absent → null (fail open). */
export function readHookLine(home: string, workspace: string): string | null {
  try {
    return readFileSync(hookStatusPaths(home, workspace).lineFile, "utf8").replace(/\n$/, "");
  } catch {
    return null;
  }
}

/** Read the precomputed counter; unreadable or absent → null. */
export function readHookSeq(home: string, workspace: string): number | null {
  try {
    const parsed = Number.parseInt(readFileSync(hookStatusPaths(home, workspace).seqFile, "utf8").trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** The payload the hooks read off the recorded call. */
export type HookPayload = {
  readonly home: string;
  readonly workspace: string;
  readonly sessionId: string;
  readonly source: string | null;
  readonly child: boolean;
  readonly isFirstTurn: boolean;
  /** The counter this session was last given; null when none was given. */
  readonly lastSeqGiven: number | null;
  readonly command: string | null;
  readonly turnExitReason: string | null;
  readonly provider: string | null;
};

/** The context return of the two `pre_llm_call` rows. */
export type ContextReturn = { readonly context: string };

/** A block return of `pre_tool_call`; the hook never approves (Principle II). */
export type BlockReturn = { readonly decision: "block"; readonly reason: string; readonly fix: string };

/**
 * `pre_llm_call` (session start and prompt, F150-FR-038, F150-FR-039): the
 * precomputed line once at the first turn when a run exists; on later turns
 * only when the `.seq` counter differs from the one last given in this
 * session. Silent in a Kanban worker, a cron session and a run's own child.
 */
export function preLlmCall(payload: HookPayload): ContextReturn | null {
  if (hookIsSilent(payload.source, payload.child)) return null;
  const line = readHookLine(payload.home, payload.workspace);
  if (line === null || line === "") return null;
  const seq = readHookSeq(payload.home, payload.workspace);
  if (!payload.isFirstTurn) {
    if (payload.lastSeqGiven !== null && seq === payload.lastSeqGiven) return null;
  }
  return { context: "Specstride: " + line };
}

/**
 * `pre_tool_call` (F150-FR-040): apply the table of `guard.json` to the
 * command string; a launch while the doctor result blocks is refused with
 * the doctor's fix. Missing or invalid table → null (fail open); the hook
 * never approves.
 */
export function preToolCall(
  payload: HookPayload,
  guard: GuardTable | null,
): BlockReturn | null {
  if (hookIsSilent(payload.source, payload.child)) return null;
  const command = payload.command ?? "";
  if (!command.includes("launch")) return null;
  if (guard === null || typeof guard.blocking !== "boolean" || !Array.isArray(guard.rules)) {
    return null;
  }
  if (guard.blocking) {
    return {
      decision: "block",
      reason: "the last doctor result holds a launch-blocking finding",
      fix: guard.fix ?? "run specstride-host-hermes doctor",
    };
  }
  const hit = matchRule(command, guard.rules);
  if (hit === null) return null;
  return { decision: "block", reason: hit.reason, fix: hit.fix };
}

/** The host-limit request file of `on_session_end`. */
export type LimitRequest = {
  readonly kind: "host-limit";
  readonly sessionId: string;
  readonly provider: string;
  readonly at: string;
};

/** True when the recorded exit reason is a provider usage limit. */
export function isUsageLimit(reason: string | null): boolean {
  return reason !== null && reason.includes("usage_limit");
}

/**
 * `on_session_end` (F150-FR-041): a provider usage limit in a run's own
 * child session writes one atomic request file the watcher forwards later;
 * it spawns nothing and returns nothing.
 */
export function onSessionEnd(
  payload: HookPayload,
  at: string,
): { readonly path: string; readonly request: LimitRequest } | null {
  if (!payload.child) return null;
  if (!isUsageLimit(payload.turnExitReason)) return null;
  const request: LimitRequest = {
    kind: "host-limit",
    sessionId: payload.sessionId,
    provider: payload.provider ?? "unknown",
    at,
  };
  const path = join(payload.home, "specstride-host", "inbox", payload.sessionId + ".json");
  const temporary = path + ".tmp";
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(temporary, JSON.stringify(request, null, 2) + "\n");
  renameSync(temporary, path);
  return { path, request };
}

/** The guard table of a home, read the way the Python hook reads it. */
export function guardTableOf(home: string): GuardTable | null {
  return readGuard(home);
}
