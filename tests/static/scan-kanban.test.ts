/**
 * T054 (PT-151-049) — the scan tests (F151-FR-049): for each rule of
 * contracts/151-hermes-kanban/presentation.md §Scan one fixture that MUST be
 * flagged and one that MUST pass; the real tree scans clean.
 *
 * Fixtures live in a fresh temp directory per run; the scan seam takes
 * paths, so no repository file is written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanKanban, type Finding } from "../../scripts/scan-kanban.ts";

let root: string;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scan-kanban-"));
  mkdirSync(join(root, "src"), { recursive: true });
});

test.afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fixture(name: string, body: string): string {
  const path = join(root, "src", name);
  writeFileSync(path, body, "utf8");
  return path;
}

const flagged = (findings: Finding[], rule: string, what: string): Finding => {
  const hit = findings.find((f) => f.rule === rule);
  assert.ok(hit, `${what}: expected a ${rule} finding, got ${JSON.stringify(findings)}`);
  return hit;
};

const clean = (findings: Finding[], what: string): void => {
  assert.deepEqual(
    findings.filter((f) => !f.path.startsWith(root)),
    [],
    `${what}: findings outside the fixture`,
  );
  assert.deepEqual(findings, [], `${what}: expected the fixture to pass, got ${JSON.stringify(findings)}`);
};

test("scan: no-lane-assignment — a lane literal outside reader/lanes.ts is flagged", () => {
  const bad = fixture("bad-lane.ts", "const card = { lane: \"approved\" };\nexport function f() { card.lane = \"queued\"; }\nswitch (x) { case \"blocked\": break; }\n");
  const findings = scanKanban(bad);
  flagged(findings, "no-lane-assignment", "lane literal");
  const good = fixture("good-lane.ts", "export function f(card: { lane: unknown }) { return card.lane; }\n");
  clean(scanKanban(good), "a columnOf-style read of card.lane");
});

test("scan: css-colour — hex, named colour, rgb(), foreign var(), our non-sskh property", () => {
  const bad = fixture("bad.css", ".x { color: #ff0000; background: red; border-color: rgb(1,2,3); outline-color: var(--not-a-token); --mine: blue; }\n");
  const findings = scanKanban(bad);
  flagged(findings, "css-colour", "colour literals");
  const good = fixture("good.css", ".sskh-ab12cd34 .x { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 60%, var(--color-success)); --sskh-tint: var(--color-border); border-color: transparent; }\n");
  clean(scanKanban(good), "theme tokens, color-mix of tokens and --sskh-… only");
});

test("scan: css-selector — unscoped selector, @import, prefers-color-scheme", () => {
  const bad = fixture("bad-sel.css", ".x { color: inherit; }\n@import \"other.css\";\n@media (prefers-color-scheme: dark) { .x { color: inherit; } }\n");
  const findings = scanKanban(bad);
  flagged(findings, "css-selector", "unscoped selector / @import / prefers-color-scheme");
  const good = fixture("good-sel.css", ".sskh-ab12cd34 .x { color: inherit; }\n@media (min-width: 40em) { .sskh-ab12cd34 .x { color: inherit; } }\n");
  clean(scanKanban(good), "prefixed selectors and an allowed media query");
});

test("scan: markup-sink — innerHTML in code is flagged", () => {
  const bad = fixture("bad-sink.ts", "export function f(el: { innerHTML: string }) { el.innerHTML = \"<b>x</b>\"; }\n");
  const findings = scanKanban(bad);
  flagged(findings, "markup-sink", "innerHTML");
  const good = fixture("good-sink.ts", "import { txt } from \"../tab/client/tree.ts\";\nexport function f(): string { return txt(\"<b>x</b>\"); }\n");
  clean(scanKanban(good), "text nodes instead of markup");
});

test("scan: nondeterminism — Date in a pure builder is flagged", () => {
  const bad = fixture("bad-date.ts", "export function f() { return Date.now(); }\nconst r = Math.random();\nconst p = performance.now();\n");
  const findings = scanKanban(bad);
  flagged(findings, "nondeterminism", "Date / Math.random / performance.now in a builder");
  const good = fixture("good-date.ts", "export function f(now: number) { return now; }\n");
  clean(scanKanban(good), "an injected clock instead of Date");
});

test("scan: the real tree scans clean", () => {
  const findings = scanKanban([
    "src/tab/client",
    "src/kanban/map.ts",
    "src/kanban/signature.ts",
  ]);
  assert.deepEqual(findings, [], `the real tree must scan clean, got ${JSON.stringify(findings)}`);
});

test("scan: findings carry rule, path, line and snippet", () => {
  const bad = fixture("shape.ts", "export function f() { return Date.now(); }\n");
  const [hit] = scanKanban(bad);
  assert.ok(hit, "a finding is returned");
  assert.equal(hit.rule, "nondeterminism", "the rule is named");
  assert.equal(hit.path, bad, "the path is named");
  assert.equal(hit.line, 1, "the line is named");
  assert.ok(hit.snippet.includes("Date"), "the snippet carries the source");
});
