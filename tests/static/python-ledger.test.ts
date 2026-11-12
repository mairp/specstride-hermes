/**
 * PT-151-031 (T008): the language ledger stays consistent with the layout.
 * Every `*.py` under `hermes-plugin/specstride/dashboard/` has a row in
 * `docs/language-ledger.md` (`plugin_api.py` included); no Python lives
 * under `src/kanban/`, `src/tab/` or `scripts/`; and `plugin.yaml` still
 * declares no Python dependency (`python_runtime: external`, no packages).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LEDGER = join(ROOT, "docs", "language-ledger.md");

function pythonFilesUnder(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".py")) found.push(relative(ROOT, child));
    }
  };
  walk(absolute);
  return found.sort();
}

test("PT-151-031: every dashboard *.py has a language-ledger row", () => {
  const ledger = readFileSync(LEDGER, "utf8");
  const dashboard = pythonFilesUnder(join("hermes-plugin", "specstride", "dashboard"));
  // plugin_api.py is the only Python of the feature; the ledger must name it
  // even before the file itself is created (T064 builds it).
  assert.match(ledger, /hermes-plugin\/specstride\/dashboard\/plugin_api\.py/);
  for (const file of dashboard) {
    assert.ok(ledger.includes(file), `docs/language-ledger.md holds no row for ${file}`);
  }
});

test("PT-151-031: no *.py under src/kanban/, src/tab/ or scripts/", () => {
  for (const dir of ["src/kanban", "src/tab", "scripts"]) {
    assert.deepEqual(pythonFilesUnder(dir), [], `${dir} holds no Python`);
  }
});

test("PT-151-031: plugin.yaml still declares no Python dependency", () => {
  const manifest = readFileSync(join(ROOT, "hermes-plugin", "specstride", "plugin.yaml"), "utf8");
  assert.match(manifest, /python_runtime:\s*external/);
  assert.doesNotMatch(manifest, /python_runtime:\s*(?:venv|managed|bundled|internal)/);
  assert.doesNotMatch(manifest, /^\s*(?:python(?:_packages|_deps|_requirements)|dependencies):/m);
});
