/**
 * T010 — the host-facts table (F150-FR-020, PT-150-020).
 * Every row mirrors contracts/150-host-hermes/host-facts.md: source and pin
 * on every row, `verifiedOn` null exactly when the row is `unverified`, a
 * settling check on every `unverified` row, and `hermesRange()` reading
 * `HF-VERSION` only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostFacts,
  factById,
  hermesRange,
  unverifiedHostFacts,
  HERMES_VERSION_PIN,
} from "../../src/host-facts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

test("the table holds the 39 rows of the contract, HF-VERSION through HF-KANBAN-NOTIFY", () => {
  assert.equal(hostFacts.length, 39);
  assert.equal(hostFacts[0].id, "HF-VERSION");
  assert.equal(hostFacts[hostFacts.length - 1].id, "HF-KANBAN-NOTIFY");
  const ids = hostFacts.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "row ids are unique");
});

test("the original 24 rows of 150 are unchanged and in order, row 24 still HF-VERSION-FMT", () => {
  const original24 = [
    "HF-VERSION",
    "HF-SKILL-FM",
    "HF-NO-INVOKE-FIELD",
    "HF-BUNDLED",
    "HF-ROOTS",
    "HF-ENABLE",
    "HF-VALIDATE",
    "HF-CMD",
    "HF-PRE-LLM",
    "HF-HOOK-TIMEOUT",
    "HF-SOURCE-ENV",
    "HF-GW-UNIT",
    "HF-GW-SURVIVAL",
    "HF-SEND",
    "HF-HEADLESS",
    "HF-SKILL-LOAD",
    "HF-STREAM-JSON",
    "HF-BACKEND",
    "HF-CONFIG-GET",
    "HF-PLUGINS-LIST",
    "HF-PLUGINS-DISABLE",
    "HF-SKILLS-LIST",
    "HF-PROFILE-CREATE",
    "HF-VERSION-FMT",
  ];
  assert.deepEqual(hostFacts.slice(0, 24).map((row) => row.id), original24);
  assert.equal(hostFacts[23].id, "HF-VERSION-FMT");
});

test("the 15 rows of 151 follow in the contract's order: six dashboard rows, then nine Kanban rows", () => {
  const dashboard = [
    "HF-DASH-TOKENS",
    "HF-DASH-THEME-SWITCH",
    "HF-DASH-SDK",
    "HF-DASH-API-404",
    "HF-DASH-CSS",
    "HF-SESSION-USAGE",
  ];
  const kanban = [
    "HF-KANBAN-CLI",
    "HF-KANBAN-NONSPAWN",
    "HF-KANBAN-BLOCK",
    "HF-KANBAN-PROMOTE",
    "HF-KANBAN-RUNNING",
    "HF-KANBAN-TRIAGE",
    "HF-KANBAN-SCHEDULED",
    "HF-KANBAN-HOOK",
    "HF-KANBAN-NOTIFY",
  ];
  assert.deepEqual(hostFacts.slice(24, 30).map((row) => row.id), dashboard);
  assert.deepEqual(hostFacts.slice(30, 39).map((row) => row.id), kanban);
});

test("every row carries a source and the Hermes pin", () => {
  for (const row of hostFacts) {
    assert.match(row.id, /^HF-[A-Z0-9-]+$/);
    assert.ok(row.fact.length > 0, `${row.id} states a fact`);
    assert.ok(row.source.length > 0, `${row.id} names its source`);
    assert.equal(row.pin, HERMES_VERSION_PIN, `${row.id} carries the pin`);
    assert.ok(
      row.status === "verified" || row.status === "readme-only" || row.status === "unverified",
      `${row.id} status is in the closed set`,
    );
    assert.ok(row.usedBy.length >= 1, `${row.id} is used by at least one FR`);
  }
});

test("verifiedOn is null exactly when the status is unverified", () => {
  for (const row of hostFacts) {
    if (row.status === "unverified") {
      assert.equal(row.verifiedOn, null, `${row.id} carries no verification date`);
    } else {
      assert.match(row.verifiedOn ?? "", /^\d{4}-\d{2}-\d{2}$/, `${row.id} carries a date`);
    }
  }
});

test("every unverified row carries a settling check", () => {
  const unverified = unverifiedHostFacts();
  assert.ok(unverified.length >= 8, "the not-yet-settled rows are recorded");
  for (const row of unverified) {
    assert.ok(
      row.settlingCheck !== null && row.settlingCheck.length > 0,
      `${row.id} names the check that would settle it`,
    );
  }
  const expected = [
    "HF-GW-SURVIVAL", // U-150-06
    "HF-BACKEND", // U-150-11
    "HF-CONFIG-GET",
    "HF-PLUGINS-LIST",
    "HF-PLUGINS-DISABLE",
    "HF-SKILLS-LIST",
    "HF-PROFILE-CREATE",
    "HF-VERSION-FMT",
    "HF-SESSION-USAGE", // U-151-10
    "HF-KANBAN-NOTIFY", // U-151-05
  ];
  for (const id of expected) {
    const row = factById(id);
    assert.ok(row !== undefined, `${id} is recorded`);
    assert.equal(row.status, "unverified");
  }
});

test("factById resolves a row and misses unknown ids", () => {
  assert.equal(factById("HF-PRE-LLM")?.id, "HF-PRE-LLM");
  assert.equal(factById("HF-NOPE"), undefined);
});

test("hermesRange() returns the range of HF-VERSION only", () => {
  assert.equal(hermesRange(), ">=0.22.2 <0.23.0");
});

test("the table mirrors the contract file row for row", () => {
  const contract = readFileSync(join(ROOT, "contracts", "150-host-hermes", "host-facts.md"), "utf8");
  for (const row of hostFacts) {
    assert.ok(contract.includes(`| ${row.id} `), `the contract holds ${row.id}`);
  }
  const contractRows = contract
    .split("\n")
    .filter((line) => line.startsWith("| HF-"))
    .map((line) => line.slice(2, line.indexOf(" ", 2)));
  assert.deepEqual(hostFacts.map((row) => row.id), contractRows);
});
