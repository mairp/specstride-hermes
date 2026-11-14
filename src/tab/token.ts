/**
 * The run-bound view token of the tab (T053; contracts/151-hermes-kanban/plugin-api.md "Auth").
 *
 * `GET session` issues a token bound to the run (or to `workspace:<id>` for a
 * reader view); every other route checks it. A missing, unknown or expired
 * token is a 401; a token bound to another run is a 409 with the
 * `run-changed` answer. Tokens live in an in-memory Map — the process holds
 * them, nothing is written to a file.
 */

/** A token issued by `GET session`, bound to a run (or a workspace reader). */
export interface Token {
  readonly value: string;
  /** The binding: the run id, or `workspace:<workspaceId>` for a reader view. */
  readonly bound: string;
  /** Expiry in ms since the epoch. */
  readonly expiresAt: number;
}

/** The default time to live: one hour. */
const DEFAULT_TTL_MS = 3_600_000;

/** The issued tokens, by value (in-memory only; no file, no store). */
const tokens = new Map<string, Token>();

/** An opaque value: 96 bits of randomness, hex — ≥ 16 characters. */
function opaqueValue(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Issue a token bound to `bound`, expiring `now + ttlMs`. */
export function issueToken(bound: string, opts: { now?: () => number; ttlMs?: number } = {}): Token {
  const nowMs = opts.now?.() ?? Date.now();
  const token: Token = {
    value: opaqueValue(),
    bound,
    expiresAt: nowMs + (opts.ttlMs ?? DEFAULT_TTL_MS),
  };
  tokens.set(token.value, token);
  return token;
}

/** Check a token against the expected binding and the clock.
 *  - missing / unknown / expired → `{ ok: false, status: 401 }`
 *  - bound to another run → `{ ok: false, status: 409, answer: "run-changed" }`
 *  - bound and alive → `{ ok: true }` and nothing else. */
export function checkToken(
  token: string | undefined,
  expected: string,
  opts: { now?: () => number } = {},
): { ok: true } | { ok: false; status: 401 } | { ok: false; status: 409; answer: "run-changed" } {
  if (typeof token !== "string" || token.length === 0) return { ok: false, status: 401 };
  const held = tokens.get(token);
  if (held === undefined) return { ok: false, status: 401 };
  const nowMs = opts.now?.();
  if (nowMs !== undefined && held.expiresAt <= nowMs) {
    tokens.delete(token);
    return { ok: false, status: 401 };
  }
  if (held.bound !== expected) return { ok: false, status: 409, answer: "run-changed" };
  return { ok: true };
}

/** Drop every held token (tests). */
export function resetTokens(): void {
  tokens.clear();
}
