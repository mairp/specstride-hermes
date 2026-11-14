/**
 * The Hermes kanban write wrapper (T010; PT-151-008, PT-151-010, PT-151-013;
 * contracts/card-projection.md, F151-FR-014 to F151-FR-017).
 *
 * One exported function per ALLOWED verb — `create`, `show`, `list`,
 * `schedule`, `edit`, `complete`, `archive`, `promote`, `block`, `comment` —
 * and nothing else. There is no generic builder that accepts an arbitrary
 * verb: the verb is part of each function's body, so a forbidden verb
 * (`claim`, `heartbeat`, `request-review`, `link`, `delete`, `decompose`,
 * `specify`, `swarm`) has no code path here at all.
 *
 * Every function returns the exact argv the projection contract requires:
 *
 *   hermes -p specstride kanban <verb> --tenant specstride
 *   --assignee specstride-projection --idempotency-key <key>
 *   --workspace scratch --body-file - --json
 *
 * with the verb's positional id directly after the verb. The card body
 * travels on stdin because of `--body-file -`; the call object carries it as
 * `stdin`. The module is pure: it opens NO file — the caller owns the spawn
 * and the store (T011 owns the only disk writes of the projection).
 */

/** The profile every projected write goes through (never another one). */
const PROFILE = "specstride";
/** The tenant of every projected write. */
const TENANT = "specstride";
/** The assignee of every projected write — not a profile (guard A). */
const ASSIGNEE = "specstride-projection";
/** The Hermes workspace the projected cards live in. */
const WORKSPACE = "scratch";

/** The head of every projected argv, before the verb. */
const ARGV_HEAD: readonly string[] = ["hermes", "-p", PROFILE, "kanban"];

/**
 * Host facts (read 2026-11-13/14, `hermes kanban <verb> --help`, Hermes
 * 0.22.2 @ d923a5eb48): `create` takes its title POSITIONALLY and is the only
 * verb that accepts `--tenant`, `--assignee`, `--idempotency-key`,
 * `--workspace` and `--body-file`; `list` takes `--tenant` and `--json`;
 * `show` and `promote` take `--json`; `schedule`, `archive`, `complete`,
 * `block` and `comment` take none of the create-only flags; `edit` takes
 * `<id> --title TITLE --body BODY` and no `--body-file`. The argv of every
 * verb is therefore built per verb, never from a common surface: a flag the
 * real CLI rejects would fail the write (`unrecognized arguments`).
 */

/** What one verb call builds: the argv and the stdin body (`--body-file -`). */
export interface KanbanCall {
  /** The full argv, head first, then the verb. */
  readonly argv: readonly string[];
  /** The body piped to stdin; empty when the verb carries no body. */
  readonly stdin: string;
  /**
   * The projection key of the write (bookkeeping for the caller's store and
   * the tests). On `create` it is also the argv's `--idempotency-key`; on
   * every other verb Hermes's CLI has no flag for it, so it travels only
   * here.
   */
  readonly key: string;
}

/** The inputs every verb call takes: the idempotency key and, where the verb writes, the title/body. */
export interface VerbInputs {
  /** The card key — the value of `--idempotency-key`. */
  readonly key: string;
  /** The Hermes card id, for the verbs that address an existing card. */
  readonly id?: string;
  /** The new title, for `create` and `edit`. */
  readonly title?: string;
  /** The card body, carried by `create` on stdin and by `edit` as `--body`. */
  readonly body?: string;
}

interface BuildInputs extends VerbInputs {
  readonly verb: string;
  readonly extra: readonly string[];
}

/** The verbs build() may emit — exactly the functions below, nothing else. */
const ALLOWED_VERBS: readonly string[] = [
  "create",
  "show",
  "list",
  "schedule",
  "edit",
  "complete",
  "archive",
  "promote",
  "block",
  "comment",
];

/** The value of `--flag` in an argv, or null when the flag is absent. */
function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at === -1 || at + 1 >= argv.length ? null : (argv[at + 1] ?? null);
}

export interface WriteGuards {
  /** Guard A: every projected write carries this non-profile assignee. */
  readonly assignee: string;
  /** Every projected write carries this tenant. */
  readonly tenant: string;
}

/** The guards every projected write must carry (F151-FR-010, F151-FR-011). */
export const WRITE_GUARDS: WriteGuards = { assignee: ASSIGNEE, tenant: TENANT };

/**
 * The pre-spawn guard assertion (T043; PT-151-010, PT-151-011): a call that
 * names a verb outside the closed set throws HERE; a `create` that would
 * leave a guard off (tenant, non-profile assignee, idempotency key) throws
 * HERE — before the caller can spawn it. The create-time flags ARE the
 * guards: Hermes's CLI accepts `--assignee` and `--tenant` only on `create`
 * (host facts above), and the assignee and tenant they set persist on the
 * card, so a create that skips them is the one write that could leave a card
 * spawnable. Drift later on the board is restored by the read-back compare
 * of the sync (`src/kanban/diff.ts`), not by re-sending flags the CLI
 * refuses. `build()` runs this on every call it returns.
 */
export function assertWriteGuards(call: KanbanCall): void {
  const argv = call.argv;
  const verb = argv[4];
  if (typeof verb !== "string" || !ALLOWED_VERBS.includes(verb)) {
    throw new Error(`guard: ${JSON.stringify(verb)} is not a verb of the projection's closed set`);
  }
  if (verb !== "create") return;
  if (flagValue(argv, "--tenant") !== WRITE_GUARDS.tenant) {
    throw new Error(`guard: the write to ${verb} does not carry --tenant ${WRITE_GUARDS.tenant}`);
  }
  if (flagValue(argv, "--assignee") !== WRITE_GUARDS.assignee) {
    throw new Error(
      `guard: the write to ${verb} does not carry the non-profile assignee ` +
        `--assignee ${WRITE_GUARDS.assignee} (guard A, F151-FR-010)`,
    );
  }
  const key = flagValue(argv, "--idempotency-key");
  if (key === null || key === "") {
    throw new Error(`guard: the write to ${verb} carries no idempotency key`);
  }
}

/** The Hermes card id a verb that addresses an existing card needs. */
function requireId(input: BuildInputs, verb: string): string {
  if (input.id === undefined || input.id === "") {
    throw new Error(`${verb} needs the Hermes card id`);
  }
  return input.id;
}

/**
 * The single private builder. It is NOT exported and its `verb` comes only
 * from the ten function bodies below — a forbidden verb cannot reach it.
 * Each verb's argv matches the recorded Hermes 0.22.2 surface (host facts
 * above); a flag the CLI would reject is never emitted.
 */
function build(input: BuildInputs): KanbanCall {
  if (input.verb.includes(" ") || input.verb.startsWith("-")) {
    throw new Error(`not a kanban verb: ${JSON.stringify(input.verb)}`);
  }
  if (!input.key) throw new Error("a projected write always carries an idempotency key");
  const argv: string[] = [...ARGV_HEAD, input.verb];
  let stdin = "";
  switch (input.verb) {
    case "create":
      // `kanban create <title> --tenant … --assignee … --idempotency-key …
      // --workspace scratch --body-file - --json`; the title is positional
      // and the body travels on stdin (host facts above).
      if (input.title === undefined) throw new Error("create needs a title");
      argv.push(
        input.title,
        "--tenant", TENANT,
        "--assignee", ASSIGNEE,
        "--idempotency-key", input.key,
        "--workspace", WORKSPACE,
        "--body-file", "-",
        "--json",
      );
      stdin = input.body ?? "";
      break;
    case "list":
      argv.push("--tenant", TENANT, "--json");
      break;
    case "show":
    case "promote":
      argv.push(requireId(input, input.verb), "--json");
      break;
    case "schedule":
    case "archive":
      argv.push(requireId(input, input.verb));
      break;
    case "edit":
      // `edit <id> --title TITLE --body BODY` — no `--body-file` on edit.
      if (input.title === undefined) throw new Error("edit needs a title");
      argv.push(requireId(input, input.verb), "--title", input.title, "--body", input.body ?? "");
      break;
    default:
      // complete, block, comment: `extra` carries the verb's own flags and
      // positionals (`--result`, `--kind needs_input <text>`, `<text>`).
      argv.push(requireId(input, input.verb), ...input.extra);
      break;
  }
  const call: KanbanCall = { argv, stdin, key: input.key };
  assertWriteGuards(call);
  return call;
}

/** `kanban create`: the root, stage or attention card is created (new → `todo`). */
export function kanbanCreate(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "create", extra: [] });
}

/** `kanban show`: one projected card is read back (never claimed). */
export function kanbanShow(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "show", extra: [] });
}

/** `kanban list`: the cards of the scratch workspace are listed. */
export function kanbanList(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "list", extra: [] });
}

/** `kanban schedule <id>`: the created card moves to its mapped column. */
export function kanbanSchedule(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "schedule", extra: [] });
}

/** `kanban edit <id> --title <title> --body <body>` (skipped when `humanEdited`). */
export function kanbanEdit(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "edit", extra: [] });
}

/** `kanban complete <id> --result "<value> (engine)"`: `scheduled` → `done`. */
export function kanbanComplete(
  inputs: VerbInputs & { readonly result: string },
): KanbanCall {
  return build({
    ...inputs,
    verb: "complete",
    extra: ["--result", inputs.result],
  });
}

/** `kanban archive <id>`: any card leaves the board (a stale comment when `humanEdited`). */
export function kanbanArchive(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "archive", extra: [] });
}

/** `kanban promote <id>`: the created attention card is promoted (before `block`). */
export function kanbanPromote(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "promote", extra: [] });
}

/** `kanban block <id> --kind needs_input <text>`: the attention card is blocked once, verbatim text. */
export function kanbanBlock(
  inputs: VerbInputs & { readonly text: string },
): KanbanCall {
  return build({
    ...inputs,
    verb: "block",
    extra: ["--kind", "needs_input", inputs.text],
  });
}

/** `kanban comment <id> <text>`: the one stale comment of a `humanEdited` card. */
export function kanbanComment(
  inputs: VerbInputs & { readonly text: string },
): KanbanCall {
  return build({
    ...inputs,
    verb: "comment",
    extra: [inputs.text],
  });
}
