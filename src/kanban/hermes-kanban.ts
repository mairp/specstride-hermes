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

/** The common flag surface of every projected write, in contract order. */
const COMMON_SURFACE: readonly string[] = [
  "--tenant",
  TENANT,
  "--assignee",
  ASSIGNEE,
  "--idempotency-key", // the key itself is spliced per call
  "__KEY__",
  "--workspace",
  WORKSPACE,
  "--body-file",
  "-",
  "--json",
];

/** What one verb call builds: the argv and the stdin body (`--body-file -`). */
export interface KanbanCall {
  /** The full argv, head first, then the verb. */
  readonly argv: readonly string[];
  /** The body piped to stdin; empty when the verb carries no body. */
  readonly stdin: string;
}

/** The inputs every verb call takes: the idempotency key and, where the verb writes, the title/body. */
export interface VerbInputs {
  /** The card key — the value of `--idempotency-key`. */
  readonly key: string;
  /** The Hermes card id, for the verbs that address an existing card. */
  readonly id?: string;
  /** The new title, for `create` and `edit`. */
  readonly title?: string;
  /** The card body, piped on stdin. */
  readonly body?: string;
}

interface BuildInputs extends VerbInputs {
  readonly verb: string;
  readonly extra: readonly string[];
  readonly bodyOf: "body" | "text" | "none";
  readonly text?: string;
  readonly withTitle: boolean;
}

/**
 * The single private builder. It is NOT exported and its `verb` comes only
 * from the ten function bodies below — a forbidden verb cannot reach it.
 */
function build(input: BuildInputs): KanbanCall {
  if (input.verb.includes(" ") || input.verb.startsWith("-")) {
    throw new Error(`not a kanban verb: ${JSON.stringify(input.verb)}`);
  }
  if (!input.key) throw new Error("a projected write always carries an idempotency key");
  const surface = COMMON_SURFACE.map((part) => (part === "__KEY__" ? input.key : part));
  const argv: string[] = [...ARGV_HEAD, input.verb];
  if (input.id !== undefined) argv.push(input.id);
  if (input.withTitle) {
    if (input.title === undefined) throw new Error("this verb needs a title");
    argv.push("--title", input.title);
  }
  argv.push(...input.extra);
  argv.push(...surface);
  const stdin =
    input.bodyOf === "none"
      ? ""
      : (input.bodyOf === "text" ? input.text : input.body) ?? "";
  return { argv, stdin };
}

/** `kanban create`: the root, stage or attention card is created (new → `todo`). */
export function kanbanCreate(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "create", extra: [], bodyOf: "body", withTitle: true });
}

/** `kanban show`: one projected card is read back (never claimed). */
export function kanbanShow(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "show", extra: [], bodyOf: "none", withTitle: false });
}

/** `kanban list`: the cards of the scratch workspace are listed. */
export function kanbanList(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "list", extra: [], bodyOf: "none", withTitle: false });
}

/** `kanban schedule <id>`: the created card moves to its mapped column. */
export function kanbanSchedule(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "schedule", extra: [], bodyOf: "none", withTitle: false });
}

/** `kanban edit <id> --title <title>`: the body travels on stdin (skipped when `humanEdited`). */
export function kanbanEdit(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "edit", extra: [], bodyOf: "body", withTitle: true });
}

/** `kanban complete <id> --result "<value> (engine)"`: `scheduled` → `done`. */
export function kanbanComplete(
  inputs: VerbInputs & { readonly result: string },
): KanbanCall {
  return build({
    ...inputs,
    verb: "complete",
    extra: ["--result", inputs.result],
    bodyOf: "none",
    withTitle: false,
  });
}

/** `kanban archive <id>`: any card leaves the board (a stale comment when `humanEdited`). */
export function kanbanArchive(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "archive", extra: [], bodyOf: "none", withTitle: false });
}

/** `kanban promote <id>`: the created attention card is promoted (before `block`). */
export function kanbanPromote(inputs: VerbInputs): KanbanCall {
  return build({ ...inputs, verb: "promote", extra: [], bodyOf: "none", withTitle: false });
}

/** `kanban block <id> --kind needs_input <text>`: the attention card is blocked once, verbatim text. */
export function kanbanBlock(
  inputs: VerbInputs & { readonly text: string },
): KanbanCall {
  return build({
    ...inputs,
    verb: "block",
    extra: ["--kind", "needs_input", inputs.text],
    bodyOf: "none",
    withTitle: false,
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
    bodyOf: "text",
    withTitle: false,
  });
}
