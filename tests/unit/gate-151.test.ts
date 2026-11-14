/**
 * T079 (PT-151-032) — the gate, the build chain and the spawn scan of 151.
 * Constitution H2 and H8:
 *
 * - `npm run gate` is the H8 line, unchanged (pin:check → build → test →
 *   conformance → hermes plugins validate);
 * - `npm run build` runs `gen-kanban-values`, `scan-kanban` and `build-tab`;
 * - `npm test` includes the drift test, the scan tests and both live lanes
 *   (which skip on the per-change runner);
 * - 150's CLI-spawn scan is extended over `src/kanban/` and `src/tab/`:
 *   only `src/kanban/shim-call.ts` and `src/tab/handler.ts` may spawn, and
 *   only 150's shim; nothing spawns from `src/kanban/reader/`; no file
 *   names the engine executable (the string-literal scan);
 * - no test file of this feature names a provider host of
 *   `tests/helpers/provider-hosts.json` or a model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkKanbanSpawnScan, checkNoProviderHostsInTests } from "../../src/gates.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

function readRoot(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

test("npm run gate is the H8 line, unchanged", () => {
  const scripts = (JSON.parse(readRoot("package.json")) as { scripts: Record<string, string> }).scripts;
  assert.equal(
    scripts["gate"],
    "npm run pin:check && npm run build && npm test && npm run conformance && hermes plugins validate hermes-plugin/specstride",
  );
});

test("npm run build runs gen-kanban-values, scan-kanban and build-tab", () => {
  const build = readRoot("scripts", "build.ts");
  assert.match(build, /writeGeneratedClosedSets\(\)/, "build runs the closed-set generator (gen-kanban-values)");
  assert.match(build, /from "\.\/gen-kanban-values\.ts"/);
  assert.match(build, /scanKanban\(\[/, "build runs the tab/kanban rule scan (scan-kanban)");
  assert.match(build, /from "\.\/scan-kanban\.ts"/);
  assert.match(build, /buildTab\(/, "build runs the tab bundle build (build-tab)");
  assert.match(build, /from "\.\/build-tab\.ts"/);
  // The closed-set generator runs before any gate reads the tree.
  assert.ok(
    build.indexOf("writeGeneratedClosedSets()") < build.indexOf("allGateFindings(ROOT)"),
    "gen-kanban-values runs before the static gates",
  );
});

test("npm test includes the drift test, the scan tests and both live lanes, which skip", () => {
  const runner = readRoot("scripts", "run-tests.mjs");
  assert.match(runner, /tests\/\*\*\/\*\.test\.ts/, "the runner selects every tests/**/*.test.ts, live lanes included");
  assert.match(runner, /SPECSTRIDE_PER_CHANGE/, "the runner marks a per-change run");
  // The lane files carry the per-change skip (never `passed` there).
  for (const lane of ["dispatcher.live.test.ts", "tab.live.test.ts"]) {
    const text = readRoot("tests", "live", lane);
    assert.match(text, /SPECSTRIDE_PER_CHANGE/, `${lane} answers the per-change seam`);
    assert.match(text, /skip:\s*SKIP_REASON/, `${lane} skips, never runs, on npm test`);
  }
  // The named per-change tests of the gate exist where the runner finds them.
  assert.ok(readRoot("tests", "static", "bundle-drift.test.ts").length > 0, "the drift test is present");
  assert.ok(readRoot("tests", "static", "scan-kanban.test.ts").length > 0, "the scan test is present");
});

test("the kanban/tab spawn scan passes the real tree", () => {
  assert.deepEqual(checkKanbanSpawnScan(ROOT), []);
});

test("only shim-call.ts and handler.ts may spawn, and only through 150's shim", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "gate151-"));
  try {
    cpSync(join(ROOT, "src"), join(sandbox, "src"), { recursive: true });
    // A spawn naming the executable in another kanban file is a finding.
    const syncPath = join(sandbox, "src", "kanban", "sync.ts");
    writeFileSync(
      syncPath,
      readRoot("src", "kanban", "sync.ts") + '\nconst _violation = spawnSync("specstride", ["launch"]);\nvoid _violation;\n',
    );
    let findings = checkKanbanSpawnScan(sandbox);
    assert.ok(
      findings.some((f) => f.includes("src/kanban/sync.ts") && f.includes("engine executable")),
      `a spawn naming the executable outside the allowlist must be flagged: ${JSON.stringify(findings)}`,
    );
    // Nothing spawns from the reader, in any file.
    writeFileSync(
      join(sandbox, "src", "kanban", "reader", "index.ts"),
      readRoot("src", "kanban", "reader", "index.ts") + '\nvoid spawnSync;\nconst _x = execSync("true");\nvoid _x;\n',
    );
    findings = checkKanbanSpawnScan(sandbox);
    assert.ok(
      findings.some((f) => f.includes("src/kanban/reader/index.ts") && f.includes("may spawn")),
      `a spawn in the reader must be flagged: ${JSON.stringify(findings)}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("no test file of this feature names a provider host or a model", () => {
  assert.deepEqual(checkNoProviderHostsInTests(ROOT), []);
});

test("the provider-host gate flags a test that names a host or a model", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "gate151-hosts-"));
  try {
    cpSync(join(ROOT, "tests", "helpers"), join(sandbox, "tests", "helpers"), { recursive: true });
    mkdirSync(join(sandbox, "tests", "kanban"), { recursive: true });
    writeFileSync(
      join(sandbox, "tests", "kanban", "violation.test.ts"),
      'import test from "node:test";\n' +
        'test("x", () => {});\n' +
        '// const base = "https://api.openai.com/v1";\n' +
        'const model = "claude-3-5-sonnet";\n' +
        "void model;\n",
    );
    const findings = checkNoProviderHostsInTests(sandbox);
    assert.ok(
      findings.some((f) => f.includes("violation.test.ts") && f.includes("api.openai.com")),
      `a provider host must be flagged: ${JSON.stringify(findings)}`,
    );
    assert.ok(
      findings.some((f) => f.includes("violation.test.ts") && f.includes("a model")),
      `a model name must be flagged: ${JSON.stringify(findings)}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
