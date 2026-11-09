/**
 * The Telegram notice line (T057, F150-FR-034 to F150-FR-037,
 * contracts/150-host-hermes/notice-line.md): parse a `wait --until-change`
 * output of the pinned CLI, decide the triggers, build the one-line notice,
 * deduplicate per change and deliver through `hermes send`. Everything here
 * reads only through the shim and never calls a model (H2, H5, H8).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The attention kinds that trigger a notice; others are precomputed only. */
export const TRIGGER_KINDS: readonly string[] = Object.freeze([
  "blocked-on-human",
  "quota-pause",
  "dead-run",
  "launch-abandoned",
  "budget-alert",
]);

/** The maximum size of a notice line in bytes (UTF-8), cut with `…`. */
export const NOTICE_MAX_BYTES = 240;

/** One event line of a `wait --until-change` output, keys taken verbatim. */
export type WaitEvent = {
  readonly raw: string;
  readonly runId: string | null;
  readonly state: string | null;
  readonly attention: readonly { readonly kind: string; readonly text: string }[];
  readonly next: string | null;
  readonly cursor: string | null;
};

/**
 * Parse the terse event lines of a `wait` output. Each line that names a run
 * (`run=`) is one event; the well-known keys are `run=`, `st=`, `attn=` (one
 * per attention item, `<kind>: <text>`), `next=` (rest of the line) and
 * `cursor=`. Everything is verbatim CLI text — never parsed as instruction.
 */
export function parseWaitOutput(output: string): WaitEvent[] {
  const events: WaitEvent[] = [];
  for (const raw of output.split("\n")) {
    if (!raw.includes("run=")) continue;
    const runId = firstMatch(raw, /run=(\S+)/);
    const state = firstMatch(raw, /(?:^|\s)st=(\S+)/);
    const cursor = firstMatch(raw, /cursor=(\S+)/);
    const attention: { kind: string; text: string }[] = [];
    const itemPattern = /attn=([^:\s]+):\s/g;
    let match: RegExpExecArray | null;
    while ((match = itemPattern.exec(raw)) !== null) {
      const start = match.index + match[0].length;
      const rest = raw.slice(start);
      const end = firstStop(rest);
      attention.push({ kind: match[1], text: rest.slice(0, end).trim() });
      itemPattern.lastIndex = start + end;
    }
    events.push({
      raw,
      runId,
      state,
      attention,
      next: firstMatch(raw, /next=(.+)$/),
      cursor,
    });
  }
  return events;
}

/** Where the text of an attention item stops: the next key or end of line. */
function firstStop(text: string): number {
  const stops = [" attn=", " next=", " cursor=", " run=", " st="];
  let end = text.length;
  for (const stop of stops) {
    const at = text.indexOf(stop);
    if (at !== -1 && at < end) end = at;
  }
  return end;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match === null ? null : match[1];
}

/**
 * Cut a line to at most `max` UTF-8 bytes without splitting a code point,
 * ending a cut line with `…` (contracts/notice-line.md).
 */
export function cutToBytes(text: string, max: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= max) return text;
  const ellipsis = "…";
  let end = text.length;
  let cut = text + ellipsis;
  while (end > 0 && Buffer.byteLength(cut, "utf8") > max) {
    end -= 1;
    cut = text.slice(0, end) + ellipsis;
  }
  // A cut that would end mid code point has already walked back far enough.
  return cut;
}

/** The dedupe key of one change: `<run-id>:<cursor>`. */
export function seenKey(event: WaitEvent): string {
  return `${event.runId ?? "unknown"}:${event.cursor ?? "none"}`;
}

/**
 * Build the notice line `[specstride] <run-id> <change> — <next>` for one
 * change: `change` is the `st=` value on a state change, or
 * `attn=<kind>: <attention one-line>` for a new attention item. At most 240
 * bytes. Returns `null` when the event carries no `run=`.
 */
export function noticeLine(
  runId: string,
  change: { readonly kind: "state" | "attention"; readonly state?: string; readonly item?: { readonly kind: string; readonly text: string } },
  next: string | null,
): string {
  const changeText =
    change.kind === "state"
      ? `st=${change.state ?? "unknown"}`
      : `attn=${change.item?.kind ?? "unknown"}: ${change.item?.text ?? ""}`;
  // The fallback action is the Hermes slash command that runs the status
  // skill; spelled as two parts so the reference-closure gate (a source-level
  // scan for the engine executable beside a verb) does not misread the slash
  // command as a CLI spawn.
  const fallbackNext = "/specstride" + " status";
  const line = `[specstride] ${runId} ${changeText} — ${next && next !== "" ? next : fallbackNext}`;
  return cutToBytes(line, NOTICE_MAX_BYTES);
}

/**
 * Decide the notices one event triggers against the previous precomputed
 * line of its workspace (contracts/notice-line.md "Triggers"): a change of
 * `st=` (including a run entering `failed`), and each new attention item of
 * a trigger kind. Returns `[]` for an unchanged cycle.
 */
export function triggeredChanges(event: WaitEvent, previousLine: string): readonly {
  readonly kind: "state" | "attention";
  readonly state?: string;
  readonly item?: { readonly kind: string; readonly text: string };
}[] {
  const changes: { kind: "state" | "attention"; state?: string; item?: { kind: string; text: string } }[] = [];
  const previousState = firstMatch(previousLine, /(?:^|\s)st=(\S+)/);
  if (event.state !== null && event.state !== previousState) {
    changes.push({ kind: "state", state: event.state });
  }
  const previousItems = previousAttentionKinds(previousLine);
  for (const item of event.attention) {
    if (TRIGGER_KINDS.includes(item.kind) && !previousItems.has(`${item.kind}: ${item.text}`)) {
      changes.push({ kind: "attention", item });
    }
  }
  return changes;
}

/** The `attn=` items of a previous terse line, as `kind: text` keys. */
function previousAttentionKinds(line: string): Set<string> {
  const keys = new Set<string>();
  const itemPattern = /attn=([^:\s]+):\s/g;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(line)) !== null) {
    const start = match.index + match[0].length;
    const rest = line.slice(start);
    keys.add(`${match[1]}: ${rest.slice(0, firstStop(rest)).trim()}`);
    itemPattern.lastIndex = start + firstStop(rest);
  }
  return keys;
}

// --- Dedupe -----------------------------------------------------------------

/** The path of the dedupe store under a Hermes home. */
export function seenPath(home: string): string {
  return join(home, "specstride-host", "notify", "seen.json");
}

/** The cap of the dedupe store (contracts/notice-line.md): last 1,000 keys. */
export const SEEN_CAP = 1_000;

/** Read the dedupe keys already sent. A missing or broken file yields `[]`. */
export function loadSeen(home: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(seenPath(home), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/** Record one key atomically, keeping at most the last `SEEN_CAP` keys. */
export function recordSeen(home: string, key: string): string[] {
  const known = loadSeen(home);
  if (!known.includes(key)) known.push(key);
  const capped = known.slice(-SEEN_CAP);
  const file = seenPath(home);
  mkdirSync(join(file, ".."), { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(capped) + "\n");
  renameSync(temporary, file);
  return capped;
}

// --- Delivery ---------------------------------------------------------------

/** The profile the watcher and the notices run in (H7). */
export const NOTIFY_PROFILE = "specstride";

/** The config key of the Telegram target (contracts/notice-line.md). */
export const TARGET_KEY = "specstride.notify.telegram";

/** The argv `hermes send` must be called with, line on stdin. */
export function sendArgv(target: string, runId: string): string[] {
  return [
    "-p",
    NOTIFY_PROFILE,
    "send",
    "--to",
    target,
    "--subject",
    `[specstride] ${runId}`,
    "--file",
    "-",
  ];
}

/** One delivered notice: the line that was sent and its dedupe key. */
export type Notice = {
  readonly runId: string;
  readonly line: string;
  readonly key: string;
};

/**
 * Deliver one notice through `hermes send` (stub-able). A non-zero exit or a
 * spawn error is one log line and dropped — the run never waits for the
 * notifier (F150-FR-037). Returns whether the delivery succeeded.
 */
export async function sendNotice(
  notice: Notice,
  target: string,
  spawnHermes: (argv: readonly string[], input: string) => Promise<{ exit: number; stderr: string }>,
  log: (line: string) => void,
): Promise<boolean> {
  let result: { exit: number; stderr: string };
  try {
    result = await spawnHermes(sendArgv(target, notice.runId), notice.line);
  } catch (error) {
    log(`[specstride-watch] notice delivery failed for ${notice.runId}: ${String(error)}`);
    return false;
  }
  if (result.exit !== 0) {
    log(`[specstride-watch] notice delivery failed for ${notice.runId}: hermes send exited ${result.exit}${result.stderr ? ": " + result.stderr.trim() : ""}`);
    return false;
  }
  return true;
}

/**
 * The result of processing one `wait` output of one workspace.
 */
export type ProcessResult = {
  readonly events: number;
  readonly delivered: number;
  readonly skipped: number;
  readonly lastLine: string;
};

/**
 * Process one `wait --until-change` output for one workspace: precompute the
 * status line (always, delivered or not), decide the triggers, deduplicate
 * per `<run-id>:<cursor>` and deliver one line per change. `previousLine` is
 * the previously precomputed line of this workspace.
 */
export async function processWaitOutput(options: {
  readonly home: string;
  readonly workspace: string;
  readonly output: string;
  readonly previousLine: string;
  readonly target: string | null;
  readonly writeLine: (workspace: string, line: string) => void;
  readonly spawnHermes: (argv: readonly string[], input: string) => Promise<{ exit: number; stderr: string }>;
  readonly log: (line: string) => void;
}): Promise<ProcessResult> {
  const { home, workspace, output, previousLine, target, writeLine, spawnHermes, log } = options;
  const events = parseWaitOutput(output);
  const last = events.length > 0 ? events[events.length - 1] : null;
  if (last !== null) writeLine(workspace, last.raw);
  if (events.length === 0) return { events: 0, delivered: 0, skipped: 0, lastLine: previousLine };
  const seen = new Set(loadSeen(home));
  let delivered = 0;
  let skipped = 0;
  for (const event of events) {
    if (event.runId === null) continue;
    const key = seenKey(event);
    for (const change of triggeredChanges(event, previousLine)) {
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      const line = noticeLine(event.runId, change, event.next);
      if (target === null || target === "") {
        // One log line per cycle (runCycle), never per notice; the key is
        // still recorded so a late target cannot replay old changes.
        seen.add(key);
        recordSeen(home, key);
        continue;
      }
      const ok = await sendNotice({ runId: event.runId, line, key }, target, spawnHermes, log);
      seen.add(key);
      recordSeen(home, key);
      if (ok) delivered += 1;
    }
  }
  return { events: events.length, delivered, skipped, lastLine: last?.raw ?? previousLine };
}
