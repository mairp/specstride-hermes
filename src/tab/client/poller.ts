/**
 * The view poller of the dashboard tab (T059; T052 is its test).
 *
 * Contracts: contracts/151-hermes-kanban/plugin-api.md (Limits; "What the
 * client reads as unavailable"), F151-FR-023, F151-FR-039.
 *
 * One outstanding request at a time. A good answer schedules the next fetch
 * at the 5 s cadence; a failure backs off 1 → 2 → 4 → 8 → 16 s, clamped at
 * 30 s. Every failure (a non-2xx status, a non-JSON body, a body that does
 * not parse, an object without a known `answer`, a thrown fetch) sets the
 * ONE unavailable line through `onLine` and holds the stale state — no
 * partial board ever reaches `onAnswer`. The next `view`, `unchanged` or
 * `no-run` answer clears the stale state without re-emitting a line.
 *
 * The scheduler is injected (the tests pump recorded ticks by hand); while a
 * request is in flight a guard tick is held so a pump always finds a tick,
 * and it is cancelled the moment the request settles. Nothing throws out of
 * the poller.
 */
import { closedSetApiAnswers } from "../../kanban/generated/closed-sets.ts";

/** The one line every unavailable answer shows (F151-FR-023). */
export const UNAVAILABLE_LINE =
  "Specstride view unavailable — run specstride-host-hermes doctor";

export type FetchLike = (
  url: string,
) => Promise<{ readonly status: number; readonly contentType?: string; readonly body: string }>;

export interface PollerDeps {
  /** The route fetch (the SDK's fetchJSON in production; a stub in tests). */
  readonly fetch: FetchLike;
  /** A parsed answer of the closed set; never called with a partial board. */
  readonly onAnswer: (answer: unknown) => void;
  /** One status line (the unavailable line, or nothing on recovery). */
  readonly onLine: (line: string) => void;
  /** Injected clock in ms (tests). */
  readonly now?: () => number;
  /** Injected scheduler (tests); returns the cancel function. */
  readonly schedule?: (ms: number, fn: () => void) => () => void;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Whether the stale line is currently held (F151-FR-039). */
  readonly stale: boolean;
  /** Whether one request is in flight right now. */
  readonly pending: boolean;
}

/** The cadence after a good answer (plugin-api.md Limits). */
const CADENCE_MS = 5_000;
/** The first backoff step, its growth, and the clamp. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** The answers that clear the stale state (F151-FR-039). */
const STALE_CLEARING = new Set(["view", "unchanged", "no-run"]);

export function createPoller(deps: PollerDeps): Poller {
  const schedule = deps.schedule ?? ((ms: number, fn: () => void) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  });
  const known = new Set<string>(closedSetApiAnswers as readonly string[]);

  // Two scheduled slots: the next-action tick (leaves a request; exists
  // whenever no request is in flight) and the in-flight guard (reschedules
  // itself while a request is pending, so a pump always finds a tick).
  let cancelTick: (() => void) | null = null;
  let cancelGuard: (() => void) | null = null;
  let failures = 0;
  let staleState = false;
  let pendingState = false;
  let stopped = true;

  const clear = (cancel: (() => void) | null): void => {
    if (cancel !== null) cancel();
  };

  function guardFn(): void {
    cancelGuard = null;
    if (stopped) return;
    if (pendingState) {
      // still in flight: hold the line, reschedule the guard
      cancelGuard = schedule(CADENCE_MS, guardFn);
      return;
    }
    leaveRequest();
  }

  function settle(ok: boolean): void {
    clear(cancelGuard);
    cancelGuard = null;
    pendingState = false;
    if (stopped) return;
    const ms = ok ? CADENCE_MS : Math.min(BACKOFF_BASE_MS * 2 ** failures, BACKOFF_MAX_MS);
    failures = ok ? 0 : failures + 1;
    cancelTick = schedule(ms, () => {
      cancelTick = null;
      leaveRequest();
    });
  }

  function fail(): void {
    if (!staleState) {
      staleState = true;
      try {
        deps.onLine(UNAVAILABLE_LINE);
      } catch {
        // a throwing sink must not break the poller
      }
    }
    settle(false);
  }

  function handle(
    response: { readonly status: number; readonly contentType?: string; readonly body: string },
  ): void {
    try {
      if (typeof response.status !== "number" || response.status < 200 || response.status >= 300) {
        fail();
        return;
      }
      const type = typeof response.contentType === "string" ? response.contentType : "";
      // An absent content type is read as JSON (the route always answers
      // JSON); an explicit non-JSON type (an HTML SPA shell) is unavailable.
      if (type !== "" && !type.includes("application/json")) {
        fail();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        fail();
        return;
      }
      if (typeof parsed !== "object" || parsed === null) {
        fail();
        return;
      }
      const answer = (parsed as { readonly answer?: unknown }).answer;
      if (typeof answer !== "string" || !known.has(answer) || !STALE_CLEARING.has(answer)) {
        fail();
        return;
      }
      staleState = false;
      try {
        deps.onAnswer(parsed);
      } catch {
        // a throwing sink must not break the poller
      }
      settle(true);
    } catch {
      fail();
    }
  }

  function leaveRequest(): void {
    if (pendingState || stopped) return;
    pendingState = true;
    cancelGuard = schedule(CADENCE_MS, guardFn);
    try {
      deps.fetch("specstride:tab/view").then(
        (response) => handle(response),
        () => fail(),
      );
    } catch {
      fail();
    }
  }

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      failures = 0;
      // The first request leaves when the first tick fires.
      cancelTick = schedule(0, () => {
        cancelTick = null;
        leaveRequest();
      });
    },
    stop(): void {
      stopped = true;
      clear(cancelTick);
      cancelTick = null;
      clear(cancelGuard);
      cancelGuard = null;
    },
    get stale(): boolean {
      return staleState;
    },
    get pending(): boolean {
      return pendingState;
    },
  };
}
