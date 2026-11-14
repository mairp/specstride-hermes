/**
 * The token gate tests (T053; contracts/151-hermes-kanban/plugin-api.md "Auth").
 *
 * `GET session` issues a run-bound view token; every other route requires it.
 * A missing, foreign or expired token is a 401 with 0 CLI calls; a token bound
 * to another run is a 409 with the `run-changed` answer. The stub is the
 * established stub CLI of `tests/stubs/specstride` (the T003 stub): the log
 * stays empty exactly when no verb ran.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { issueToken, checkToken, type Token } from "../../src/tab/token.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");

/** A fixture with a stub CLI log (the log starts and must stay EMPTY). */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tab-token-151-"));
  const log = join(root, "stub-log.jsonl");
  writeFileSync(log, "");
  return {
    root,
    log,
    stubEnv(): void {
      process.env.SPECSTRIDE_BIN = STUB_CLI;
      process.env.STUB_LOG = log;
      process.env.STUB_SCRIPT = "{}";
    },
    /** Every recorded call, probes included. */
    read(): { probe: boolean; argv: string[] }[] {
      const text = readFileSync(log, "utf8").trim();
      if (text === "") return [];
      return JSON.parse(`[${text.split("\n").join(",")}]`) as { probe: boolean; argv: string[] }[];
    },
  };
}

const NOW_MS = Date.parse("2026-11-11T12:00:00.000Z");
const HOUR = 3_600_000;

test("issueToken gives a value bound to the run with an expiresAt", () => {
  const fx = fixture();
  try {
    const token: Token = issueToken("run-abc", { now: () => NOW_MS });
    assert.ok(token.value.length >= 16, `token value is opaque, got "${token.value}"`);
    assert.equal(token.bound, "run-abc", "the token binds to the run id");
    assert.equal(token.expiresAt, NOW_MS + HOUR, "expiresAt is now + one hour");
    assert.equal(fx.read().length, 0, "issuing a token makes 0 CLI calls");
  } finally {
    delete process.env.SPECSTRIDE_BIN;
    delete process.env.STUB_LOG;
    delete process.env.STUB_SCRIPT;
  }
});

test("checkToken accepts the matching token and refuses missing or foreign ones", () => {
  const token = issueToken("run-abc", { now: () => NOW_MS });
  assert.deepEqual(checkToken(token.value, "run-abc"), { ok: true }, "the bound run passes");
  assert.equal(checkToken(undefined, "run-abc").ok, false, "a missing token fails");
  assert.equal(checkToken(undefined, "run-abc").status, 401, "a missing token is 401");
  assert.equal(checkToken("not-the-value", "run-abc").ok, false, "a foreign value fails");
  assert.equal(checkToken("not-the-value", "run-abc").status, 401, "a foreign token is 401");
});

test("an expired token is refused with 401 even though its binding matches", () => {
  const token = issueToken("run-abc", { now: () => NOW_MS, ttlMs: 1_000 });
  const later = checkToken(token.value, "run-abc", { now: () => NOW_MS + 2_000 });
  assert.equal(later.ok, false, "an expired token fails");
  assert.equal(later.status, 401, "an expired token is 401");
});

test("a token bound to another run reads as 409 run-changed", () => {
  const token = issueToken("run-abc", { now: () => NOW_MS });
  const other = checkToken(token.value, "run-xyz");
  assert.equal(other.ok, false, "a foreign run fails");
  assert.equal(other.status, 409, "a foreign run is 409");
  assert.equal(other.answer, "run-changed", "the answer of a foreign run is run-changed");
});
