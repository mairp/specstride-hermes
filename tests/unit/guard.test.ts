/**
 * The guard table tests of US6 (T061, PT-150-040): every rule of
 * `src/guard.ts` matches its golden commands and none of the allowed ones;
 * `blocking` follows `doctor.last`; the table is written atomically by
 * `writeGuard` and by the doctor's own run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  blockingFromDoctorLast,
  guardPath,
  GUARD_RULES,
  matchRule,
  readGuard,
  ruleMatches,
  writeGuard,
} from "../../src/guard.ts";

const SHIM_LAUNCH = "specstride-hermes launch --comment ship the parser";
const BARE_LAUNCH = "specstride launch --comment ship the parser";
const NOHUP_LAUNCH = "nohup specstride-hermes launch &";
const AMPERSAND_LAUNCH = "specstride-hermes launch --comment quick &";
const CHAINED_LAUNCH = "npm test && specstride-hermes launch --comment after the gate";
const NON_LAUNCH = "specstride-hermes status";

test("the shim rule matches a launch outside the shim only", () => {
  const rule = GUARD_RULES.find((r) => r.absent.includes("specstride-hermes"));
  assert.ok(rule, "the shim rule exists");
  assert.equal(ruleMatches(BARE_LAUNCH, rule), true);
  assert.equal(ruleMatches(SHIM_LAUNCH, rule), false);
  assert.equal(ruleMatches(NON_LAUNCH, rule), false);
});

test("the nohup rule matches a nohup background launch", () => {
  const rule = GUARD_RULES.find((r) => r.contains.includes("nohup"));
  assert.ok(rule, "the nohup rule exists");
  assert.equal(ruleMatches(NOHUP_LAUNCH, rule), true);
  assert.equal(ruleMatches(SHIM_LAUNCH, rule), false);
});

test("the ampersand rule matches a background launch but not a chained foreground one", () => {
  const rule = GUARD_RULES.find((r) => r.contains.includes("&") && r.absent.includes("&&"));
  assert.ok(rule, "the ampersand rule exists");
  assert.equal(ruleMatches(AMPERSAND_LAUNCH, rule), true);
  assert.equal(ruleMatches(CHAINED_LAUNCH, rule), false);
});

test("a foreground launch through the shim matches no rule", () => {
  assert.equal(matchRule(SHIM_LAUNCH, GUARD_RULES), null);
  assert.equal(matchRule(CHAINED_LAUNCH, GUARD_RULES), null);
  assert.equal(matchRule(NON_LAUNCH, GUARD_RULES), null);
});

test("the golden refusals each hit their rule first", () => {
  assert.equal(matchRule(BARE_LAUNCH, GUARD_RULES)?.reason, "the engine's launch must run through the shim");
  assert.equal(matchRule(NOHUP_LAUNCH, GUARD_RULES)?.reason, "the engine's launch must run in the foreground");
  assert.equal(matchRule(AMPERSAND_LAUNCH, GUARD_RULES)?.reason, "the engine's launch must run in the foreground");
});

test("blocking follows doctor.last", () => {
  assert.deepEqual(blockingFromDoctorLast(null), { blocking: false, fix: null });
  assert.deepEqual(blockingFromDoctorLast({ checks: [] }), { blocking: false, fix: null });
  assert.deepEqual(
    blockingFromDoctorLast({
      exit: 0,
      checks: [{ id: "host.cli-found", severity: "ok", message: "found", blocking: false }],
    }),
    { blocking: false, fix: null },
  );
  assert.deepEqual(
    blockingFromDoctorLast({
      exit: 2,
      checks: [
        { id: "host.cli-found", severity: "fail", message: "no CLI on PATH — run npm install -g @specstride/cli", blocking: true },
        { id: "host.hermes-version", severity: "ok", message: "supported", blocking: false },
      ],
    }),
    { blocking: true, fix: "no CLI on PATH — run npm install -g @specstride/cli" },
  );
});

test("writeGuard writes the table atomically from doctor.last", () => {
  const home = mkdtempSync(join(tmpdir(), "guard-"));
  const hostDirectory = join(home, "specstride-host");
  mkdirSync(hostDirectory, { recursive: true });
  // No doctor.last: not blocking, but the rules are still written.
  const plain = writeGuard(home);
  assert.ok(plain, "a table is written without a doctor report");
  assert.equal(plain?.blocking, false);
  assert.equal(plain?.rules.length, GUARD_RULES.length);
  const written = JSON.parse(readFileSync(guardPath(home), "utf8")) as { schema: string };
  assert.equal(written.schema, "specstride.guard/1");
  assert.equal(existsSync(guardPath(home) + ".tmp-" + process.pid), false, "no temporary left");

  writeFileSync(join(hostDirectory, "doctor.last"), JSON.stringify({
    schema: "specstride.doctor-report/1",
    exit: 2,
    checks: [{ id: "host.cli-found", severity: "fail", message: "install the CLI first", blocking: true }],
  }));
  const blocked = writeGuard(home);
  assert.equal(blocked?.blocking, true);
  assert.equal(blocked?.fix, "install the CLI first");
  assert.equal(readGuard(home)?.blocking, true);
});

test("readGuard fails open on a missing or invalid table", () => {
  const home = mkdtempSync(join(tmpdir(), "guard-"));
  assert.equal(readGuard(home), null);
  mkdirSync(join(home, "specstride-host"), { recursive: true });
  writeFileSync(guardPath(home), "{not json");
  assert.equal(readGuard(home), null);
});
