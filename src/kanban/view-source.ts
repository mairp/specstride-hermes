/**
 * The view source (T035; PT-151-033, PT-151-039, PT-151-006, PT-151-042;
 * contracts/workspace-reader.md §1, §8, §9; F151-FR-033, F151-FR-039,
 * F151-FR-042). Answers one question per workspace: which view does the
 * projector project this cycle?
 *
 * The four steps of §1, in order:
 *   1. unless the engine memo holds, the engine is asked through the shim;
 *   2. an engine view with ≥ 1 card wins — the reader is not called;
 *   3. an unavailable / refused-schema / empty engine answer falls to the
 *      reader; a reader view with ≥ 1 card is the view;
 *   4. no card from either → `no-run` (a valid engine view with state
 *      `none`), `refused-schema` (an unsupported schema major, after the
 *      reader was tried), or `absent` (every other unavailable answer).
 *
 * The engine memo (§8) is held HERE, not by the reader: after an engine
 * answer that is unavailable, of an unsupported schema major, or empty while
 * the reader gave cards, the engine is not asked for 60 000 ms; at most 64
 * workspaces (the oldest entry is evicted); an engine view that carries a
 * card deletes the entry. The clock is injectable, so the tests freeze time.
 *
 * The reader switch (`specstride.kanban.reader: off`, default on) skips step
 * 3 entirely: the answer is then `absent` unless an engine view with a card
 * wins (F151-FR-042). The engine probe and the reader are injectable seams;
 * this module itself spawns nothing and opens no file.
 */
import { acceptKnownView, acceptView, type AcceptedView } from "./view-read.ts";
import { changeSignature } from "./signature.ts";
import { status as shimStatus, type ShimAnswer } from "./shim-call.ts";
import { nodeFilePort, nodeProcPort } from "./reader/ports.ts";
import { readWorkspaceView, type ReaderView } from "./reader/index.ts";

/** How long an engine answer is not re-asked (§8; F151-FR-039). */
export const MEMO_MS = 60_000;
/** At most this many workspaces hold a memo entry; the oldest is evicted. */
export const MEMO_MAX = 64;

/** The answer of one cycle: a view with its source, or the closed absent set. */
export type ViewAnswer =
  | {
      readonly kind: "view";
      readonly source: "engine" | "workspace-reader";
      readonly view: AcceptedView;
      /** The change signature token of the view (F151-FR-040). */
      readonly token: string;
    }
  | { readonly kind: "no-run" }
  | { readonly kind: "refused-schema" }
  | { readonly kind: "absent" };

/** The engine memo: workspace → the time (ms) until which the engine is not asked. */
export type EngineMemo = Map<string, number>;

export interface ViewSourceDeps {
  /** Injected clock in ms (tests); defaults to `Date.now()`. */
  readonly now?: () => number;
  /** The engine probe seam (tests); defaults to the shim's `status --json`. */
  readonly engine?: (workspace: string, args: readonly string[]) => Promise<ShimAnswer>;
  /** The reader seam (tests); defaults to the in-process workspace reader. */
  readonly reader?: (workspace: string) => ReaderView | null;
  /** `specstride.kanban.reader: off` puts `false` here (default on). */
  readonly readerOn?: boolean;
  /** The memo store, held by the caller across cycles (tests); created when absent. */
  readonly memo?: EngineMemo;
  /** The state home the reader's control roots live under (default `$HOME`). */
  readonly home?: string;
}

/** The memo of the deps, created when absent. */
function memoOf(deps: ViewSourceDeps): EngineMemo {
  return deps.memo ?? (deps.memo = new Map());
}

/** Whether the memo holds for the workspace right now (§8). */
export function memoHolds(workspace: string, deps: ViewSourceDeps): boolean {
  const until = memoOf(deps).get(workspace);
  return until !== undefined && until > (deps.now?.() ?? Date.now());
}

function setMemo(workspace: string, deps: ViewSourceDeps): void {
  const memo = memoOf(deps);
  const nowMs = deps.now?.() ?? Date.now();
  memo.set(workspace, nowMs + MEMO_MS);
  while (memo.size > MEMO_MAX) {
    // Evict the oldest entry (the one that expires first).
    let oldest: string | null = null;
    let oldestUntil = Infinity;
    for (const [key, until] of memo) {
      if (until < oldestUntil) {
        oldest = key;
        oldestUntil = until;
      }
    }
    if (oldest === null) break;
    memo.delete(oldest);
  }
}

/** A reader view with at least one card, as the accepted view of the answer. */
function readerAnswer(readerView: ReaderView): ViewAnswer {
  return {
    kind: "view",
    source: "workspace-reader",
    view: acceptKnownView(readerView as unknown as Record<string, unknown>),
    token: changeSignature(readerView),
  };
}

/** An engine raw view, accepted, with its token. */
function engineAnswer(raw: Record<string, unknown>): ViewAnswer {
  return { kind: "view", source: "engine", view: acceptKnownView(raw), token: changeSignature(raw) };
}

/** How many cards a reader view found. */
const cardCount = (readerView: ReaderView | null): number => (readerView === null ? 0 : readerView.cards.length);

/**
 * One answer for one workspace: the four steps of workspace-reader.md §1.
 * Never throws; every failure collapses into the closed absent set.
 */
export async function viewOf(workspace: string, deps: ViewSourceDeps = {}): Promise<ViewAnswer> {
  const readerOn = deps.readerOn !== false;
  const readReader = (): ReaderView | null => {
    if (!readerOn) return null;
    try {
      return (
        deps.reader?.(workspace) ??
        readWorkspaceView(workspace, { fs: nodeFilePort(), proc: nodeProcPort(), home: deps.home ?? process.env.HOME ?? "" })
      );
    } catch {
      return null; // a torn or unreadable input is skipped, the view is still built (F151-FR-034)
    }
  };

  // Step 1: unless the engine memo holds, ask the engine (§8).
  if (!memoHolds(workspace, deps)) {
    const ask = deps.engine ?? ((ws) => shimStatus(ws));
    const answer = await ask(workspace, ["status", "--json"]);

    // Step 2: an engine view with a card wins; the reader is not called.
    if (answer.kind === "view") {
      memoOf(deps).delete(workspace); // an engine view with a card deletes the entry (§8)
      return engineAnswer(answer.view);
    }

    // A valid engine view with 0 cards: `none` is the `no-run` candidate,
    // a view naming a run is used as it is — but the reader is tried first.
    if (answer.kind === "empty" || answer.kind === "none") {
      const readerView = readReader();
      if (cardCount(readerView) > 0) {
        setMemo(workspace, deps); // empty answer, the reader gave cards → memo (§8)
        return readerAnswer(readerView);
      }
      if (answer.kind === "none") return { kind: "no-run" };
      return engineAnswer(answer.view); // a run with no card yet keeps its root card
    }

    // Steps 3–4: unavailable or refused-schema → the reader is called.
    const readerView = readReader();
    if (cardCount(readerView) > 0) {
      setMemo(workspace, deps);
      return readerAnswer(readerView);
    }
    setMemo(workspace, deps);
    return answer.kind === "refused-schema" ? { kind: "refused-schema" } : { kind: "absent" };
  }

  // The memo holds: the engine is not asked (§8). Steps 3–4 still run.
  const readerView = readReader();
  if (readerOn && cardCount(readerView) > 0) return readerAnswer(readerView);
  return { kind: "absent" };
}
