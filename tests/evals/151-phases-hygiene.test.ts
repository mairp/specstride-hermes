/**
 * The hygiene gate over the campaign-151 phase eval fixtures (PT-151-041):
 * every committed `cases.jsonl` is scanned for absolute paths outside a
 * fixture root, credential-shaped strings, and real-user-name path shapes.
 * The pinned dependency version (`hermes-agent@0.22.2+d923a5eb48`) is the
 * one exemption: the pin names a version, not a path or a credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve2(HERE, "..", "..");
const EVAL_DIR = join(ROOT, "evals", "151-hermes-kanban");

function resolve2(...parts: string[]): string {
  return join(...parts);
}

const CASE_FILES = [
  "phase-01-setup",
  "phase-02-foundational",
  "phase-03-us7-relaunch",
  "phase-04-us1-projection",
  "phase-05-us2-not-dispatchable",
  "phase-06-us3-attention",
  "phase-07-us4-dashboard-tab",
  "phase-08-us6-inspector",
  "phase-09-us5-consented-actions",
  "phase-10-polish",
].map((slug) => join(EVAL_DIR, slug, "cases.jsonl"));

/** Absolute-looking paths outside a fixture root (none may appear). */
const ABSOLUTE_PATH = /(?:^|[\s"'`=:,(])(?:\/(?:home|root|tmp|var|usr|etc|opt|mnt|media|srv|Users)\/[^\s"'`,)]*)/g;
/** Credential-shaped strings. */
const CREDENTIAL = /(?:api[_-]?key|secret|password|bearer\s|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|xox[bp]-|AKIA[A-Z0-9]{12,})/i;
/** URLs that name a session, a token or an auth path. */
const SESSION_URL = /https?:\/\/[^\s]*(?:session|token|auth)[^\s]*/i;
/** Real-user-name path shapes. */
const USER_HOME = /\/(?:home|Users)\/[A-Za-z][A-Za-z0-9._-]{1,}\//;
/** The pinned dependency version, the one allowed mention. */
const PIN = "hermes-agent@0.22.2+d923a5eb48";

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      stringsOf(v, out);
    }
  }
  return out;
}

test("hygiene: no absolute paths, credentials, session URLs or user-home shapes in cases.jsonl", () => {
  const violations: string[] = [];
  for (const file of CASE_FILES) {
    const text = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    for (const [idx, line] of text.entries()) {
      const caseObj = JSON.parse(line) as { id?: string };
      const where = `${file}:${idx + 1} (${caseObj.id ?? "?"})`;
      for (const s of stringsOf(JSON.parse(line))) {
        if (s.includes(PIN)) continue; // the pin exemption
        for (const m of s.match(ABSOLUTE_PATH) ?? []) violations.push(`${where}: absolute path ${m}`);
        if (CREDENTIAL.test(s)) violations.push(`${where}: credential-shaped string ${JSON.stringify(s.slice(0, 60))}`);
        if (SESSION_URL.test(s)) violations.push(`${where}: session/token/auth URL ${JSON.stringify(s.slice(0, 60))}`);
        if (USER_HOME.test(s)) violations.push(`${where}: user-home path ${JSON.stringify(s.slice(0, 60))}`);
      }
    }
  }
  assert.deepEqual(violations, [], `hygiene violations:\n${violations.join("\n")}`);
});
