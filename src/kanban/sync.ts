/**
 * The sync sidecar (T038; PT-151-007, PT-151-008, PT-151-040, PT-151-041,
 * PT-151-042; contracts/sync-sidecar.md; F151-FR-006, F151-FR-007,
 * F151-FR-012, F151-FR-013, F151-FR-027, F151-FR-028, F151-FR-039). One
 * cycle per workspace: ask for the view (view-source.ts), project it
 * (project.ts), diff it (diff.ts), execute the verbs in order through the
 * dedicated profile, store the new state atomically.
 *
 * Never: `kanban.db` is never opened — every board write goes through
 * `hermes -p specstride kanban …`; no `delete`; no engine verb; no card for
 * a feature that was never run. A failed `hermes` call logs one line, sets
 * `stale` in the store and retries next cycle; a completed cycle clears the
 * mark; the store is only ever written whole (atomic rename in store.ts).
 *
 * The engine memo lives in the caller-held map (view-source.ts), so a
 * restart resumes from the store, and creates are idempotent by key.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectAll, type WantedCard } from "./project.ts";
import { planVerbs, signatureOfWanted, type PlannedVerb, type StoredCard, type ActualCard } from "./diff.ts";
import { ProjectionStore, type ProjectedCard, type ProjectionRecord } from "./store.ts";
import { viewOf, type EngineMemo, type ViewSourceDeps } from "./view-source.ts";
import { kanbanCreate, kanbanSchedule, kanbanEdit, kanbanComplete, kanbanArchive, kanbanShow, type KanbanCall } from "./hermes-kanban.ts";
import { readWatchList } from "../watch/watch-list.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..", "..");

/** The host version of the `projected-by` line. */
export function hostVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The store key of a workspace: a stable short hash of its path. */
export function workspaceKey(workspace: string): string {
  return `ws-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}`;
}

export interface SyncDeps extends ViewSourceDeps {
  /** The Hermes home that holds the store. */
  readonly hermesHome: string;
  /** The verb executor seam (tests); defaults to a real `hermes` spawn. */
  readonly exec?: (call: KanbanCall) => Promise<{ exit: number; stdout: string; stderr: string }>;
  /** Run the read-back of the board (default true; tests may stub `show`). */
  readonly readBack?: boolean;
  /** One log line sink (default console). */
  readonly log?: (line: string) => void;
}

export interface CycleResult {
  readonly kind: "view" | "no-run" | "refused-schema" | "absent";
  /** True when the signature short-circuit skipped every `hermes` call. */
  readonly shortCircuit: boolean;
  readonly verbs: readonly PlannedVerb[];
  readonly ok: boolean;
}

/** The default executor: one spawn of `hermes` per call, body on stdin. */
function defaultExec(call: KanbanCall): Promise<{ exit: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnSync(call.argv[0] ?? "hermes", call.argv.slice(1), {
      input: call.stdin,
      encoding: "utf8",
    });
    resolve({ exit: child.status ?? 1, stdout: child.stdout ?? "", stderr: child.stderr ?? "" });
  });
}

/** The stored cards of a record, as the diff's stored set. */
function storedOf(record: ProjectionRecord): StoredCard[] {
  return record.cards;
}

function toProjected(card: WantedCard, hermesId: string | null, previous: ProjectedCard | null, nowIso: string): ProjectedCard {
  return {
    key: card.key,
    role: card.role,
    hermesId: hermesId ?? previous?.hermesId ?? null,
    engineValue: card.engineValue,
    source: card.source,
    rule: card.rule,
    column: card.column,
    title: card.title,
    body: card.body,
    assignee: card.assignee,
    tenant: card.tenant,
    humanEdited: previous?.humanEdited ?? false,
    lastWrittenAt: nowIso,
  };
}

/**
 * One sync cycle for one workspace. Never throws on ordinary states; a
 * failed `hermes` call leaves `stale: true` in the store and `ok: false`.
 */
export async function syncOnce(workspace: string, deps: SyncDeps): Promise<CycleResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const store = new ProjectionStore(deps.hermesHome);
  const key = workspaceKey(workspace);
  const exec = deps.exec ?? defaultExec;
  const now = deps.now ?? Date.now;

  const answer = await viewOf(workspace, deps);
  if (answer.kind !== "view") {
    // Nothing is written for the workspace; the answer is recorded for the doctor.
    const record = store.load(key);
    if (record.signature !== "" || record.cards.length > 0) {
      store.save(key, { ...record, stale: record.stale });
    }
    return { kind: answer.kind, shortCircuit: false, verbs: [], ok: true };
  }

  const record = store.load(key);
  const wanted = projectAll(answer.view, { hostVersion: hostVersion() });
  // The change signature folds the view's token with the projected wanted
  // set, so a live fact that only shows in a projected body line (an agent
  // count, a launch state, a last-event time) still changes it (F151-FR-040).
  const token = createHash("sha256").update(`${answer.token}:${signatureOfWanted(wanted)}`).digest("hex");
  const hostVer = hostVersion();
  const nowIso = new Date(now()).toISOString();

  // Signature short-cut: an unchanged signature gives no `hermes` call at all.
  if (record.signature === token && record.signature !== "") {
    return { kind: "view", shortCircuit: true, verbs: [], ok: true };
  }

  // Read-back of the known cards (foreign writes found within 60 s).
  const actual = new Map<string, ActualCard>();
  if (deps.readBack !== false) {
    for (const card of record.cards) {
      if (card.hermesId === null) continue;
      const out = await exec(kanbanShow({ key: card.key, id: card.hermesId }));
      if (out.exit !== 0) {
        log(`kanban sync: show ${card.key} failed (exit ${String(out.exit)}); retrying next cycle`);
        store.save(key, { ...record, stale: true });
        return { kind: "view", shortCircuit: false, verbs: [], ok: false };
      }
      try {
        const shown = JSON.parse(out.stdout) as Record<string, unknown>;
        actual.set(card.key, {
          key: card.key,
          hermesId: card.hermesId,
          column: typeof shown.column === "string" ? shown.column : card.column,
          assignee: typeof shown.assignee === "string" ? shown.assignee : undefined,
          tenant: typeof shown.tenant === "string" ? shown.tenant : undefined,
        });
      } catch {
        /* a torn show body: no actual row this cycle */
      }
    }
  }

  const verbs = planVerbs({ wanted, stored: storedOf(record), actual });
  const ids = new Map<string, string>();
  for (const card of record.cards) if (card.hermesId !== null) ids.set(card.key, card.hermesId);

  let ok = true;
  for (const verb of verbs) {
    const id = verb.id ?? ids.get(verb.key) ?? undefined;
    let call: KanbanCall | null = null;
    if (verb.verb === "create") call = kanbanCreate({ key: verb.key, title: verb.card?.title ?? "", body: verb.card?.body ?? "" });
    else if (verb.verb === "schedule") call = kanbanSchedule({ key: verb.key, id });
    else if (verb.verb === "edit") call = kanbanEdit({ key: verb.key, id, title: verb.card?.title ?? "", body: verb.card?.body ?? "" });
    else if (verb.verb === "complete") call = kanbanComplete({ key: verb.key, id, result: verb.result ?? "" });
    else if (verb.verb === "archive") call = kanbanArchive({ key: verb.key, id });
    if (call === null) continue;
    const out = await exec(call);
    if (out.exit !== 0) {
      // One log line, `stale` set, retry next cycle; never a partial store.
      log(`kanban sync: ${verb.verb} ${verb.key} failed (exit ${String(out.exit)})`);
      ok = false;
      break;
    }
    if (verb.verb === "create") {
      try {
        const created = JSON.parse(out.stdout) as Record<string, unknown>;
        if (typeof created.id === "string") ids.set(verb.key, created.id);
      } catch {
        /* an unparseable create answer: the next cycle re-creates by key */
      }
    }
  }

  if (!ok) {
    store.save(key, { ...record, stale: true });
    return { kind: "view", shortCircuit: false, verbs, ok: false };
  }

  // Store the new state atomically: whole record, one write (store.ts).
  const previousByKey = new Map(record.cards.map((card) => [card.key, card]));
  const cards = wanted.map((card) => toProjected(card, ids.get(card.key) ?? null, previousByKey.get(card.key) ?? null, nowIso));
  const next: ProjectionRecord = {
    cards,
    source: answer.source,
    signature: token,
    lastGoodAt: nowIso,
    stale: false,
  };
  store.save(key, next);
  return { kind: "view", shortCircuit: false, verbs, ok: true };
}

/** The backoff of a failed cycle: 5 s doubling to at most 5 min. */
export const BACKOFF_START_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_START_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

export interface SyncFlags {
  readonly once: boolean;
  readonly workspace: string | null;
}

export function parseFlags(args: readonly string[]): SyncFlags | { usageError: string } {
  let once = false;
  let workspace: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--once") once = true;
    else if (args[i] === "--workspace") {
      workspace = args[i + 1];
      if (workspace === undefined || workspace.startsWith("--")) return { usageError: "--workspace needs a directory" };
      i += 1;
    } else return { usageError: `unknown flag: ${String(args[i])}` };
  }
  return { once, workspace };
}

/** `specstride-host-hermes kanban sync [--once] [--workspace <dir>]` (T038). */
export async function run(args: readonly string[]): Promise<number> {
  // The CLI hands us `["sync", ...]`; the verb itself is not a flag.
  const rest = args[0] === "sync" ? args.slice(1) : args;
  const flags = parseFlags(rest);
  if ("usageError" in flags) {
    process.stderr.write(`usage: kanban sync [--once] [--workspace <dir>]\n${flags.usageError}\n`);
    return 3;
  }
  const hermesHome = process.env.HERMES_HOME ?? join(process.env.HOME ?? "", ".hermes");
  const workspaces = flags.workspace !== null ? [flags.workspace] : readWatchList(hermesHome);
  const memo: EngineMemo = new Map();
  const log = (line: string) => console.log(line);
  const failures = new Map<string, number>();
  do {
    for (const workspace of workspaces) {
      try {
        const result = await syncOnce(workspace, { hermesHome, memo, log });
        failures.delete(workspace);
        if (!result.ok) failures.set(workspace, 1);
      } catch (error) {
        failures.set(workspace, (failures.get(workspace) ?? 0) + 1);
        log(`kanban sync: cycle failed for ${workspace}: ${String(error)}`);
      }
    }
    if (flags.once) break;
    const wait = workspaces.length > 0 ? backoffMs(Math.max(1, ...[...failures.values(), 1])) : BACKOFF_START_MS;
    await new Promise((resolve) => setTimeout(resolve, wait));
  } while (true);
  return 0;
}
