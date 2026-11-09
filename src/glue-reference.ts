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
