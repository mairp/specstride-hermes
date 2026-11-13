/**
 * Meta test: no placeholder markers may remain in a shipped source file of
 * this feature. Reads every .ts file under src/kanban/ and fails on any
 * placeholder marker. The marker list is assembled at runtime from pieces so
 * that this file does not itself embed the markers it bans.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const at = (...codes: number[]) => String.fromCharCode(...codes);
const MARKERS = [
  at(82, 69, 68, 65, 67, 84, 69, 68), // "marker 1"
  at(84, 79, 68, 79), // "marker 2"
  at(70, 73, 88, 77, 69), // "marker 3"
];
const PATTERN = new RegExp(MARKERS.join("|"));

const roots = ["src/kanban"];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const sources = roots.flatMap((root) => walk(root));

for (const path of sources) {
  test(`no placeholders in ${path}`, () => {
    const body = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(body, PATTERN);
  });
}
