/**
 * Bundle drift (F151-FR-052, contracts/151-hermes-kanban/tab-manifest.md §Drift,
 * task T065): the committed dashboard bundle
 * `hermes-plugin/specstride/dashboard/dist/index.js` and
 * `hermes-plugin/specstride/dashboard/dist/style.css` must be BYTE-EQUAL to a
 * fresh build of the same sources.
 *
 * Output-directory contract (documented per the task; scripts/build.ts does not
 * yet accept an output-directory flag): the test invokes the build entry
 *
 *     node --experimental-strip-types scripts/build.ts
 *
 * in a child process with the environment variable
 *
 *     SPECSTRIDE_TAB_OUT=<absolute temp dir>
 *
 * When the tab build wiring (scripts/build-tab.ts) lands, it MUST honor
 * `SPECSTRIDE_TAB_OUT` as the root under which the dashboard bundle is
 * written (`<SPECSTRIDE_TAB_OUT>/index.js`, `<SPECSTRIDE_TAB_OUT>/style.css`);
 * when unset it defaults to `hermes-plugin/specstride/dashboard/dist`. Until
 * that wiring exists this test FAILS with a missing-built-file message — the
 * desired redline. The child runs with a cleaned env (PATH, HOME, NODE_OPTIONS,
 * and the contract var only) so the build cannot depend on ambient state.
 *
 * No exported build function exists in scripts/build.ts (it is a top-level
 * script), so the child-process seam is the only one; the spawn is
 * deterministic and touches no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const BUILD_ENTRY = join(ROOT, "scripts", "build.ts");
const COMMITTED_DIST = join(ROOT, "hermes-plugin", "specstride", "dashboard", "dist");
const BUNDLE_FILES = ["index.js", "style.css"] as const;

/** First differing byte offset of two buffers, or -1 when byte-equal. */
function firstDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** Short hex/context excerpt around `offset` in `buf`. */
function excerpt(buf: Buffer, offset: number): string {
  const start = Math.max(0, offset - 8);
  const end = Math.min(buf.length, offset + 8);
  const hex = [...buf.subarray(start, end)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `bytes ${start}..${end} (len ${buf.length}): ${hex}`;
}

test("committed dashboard bundle is byte-equal to a fresh build (F151-FR-052)", () => {
  const outDir = mkdtempSync(join(tmpdir(), "specstride-bundle-drift-"));
  try {
    const cleaned: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SPECSTRIDE_TAB_OUT: outDir,
    };
    const run = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BUILD_ENTRY],
      { cwd: ROOT, env: { ...process.env, ...cleaned }, encoding: "buffer" },
    );
    assert.ok(
      !run.error,
      `build could not be started: ${String(run.error)}`,
    );
    assert.equal(
      run.status,
      0,
      `scripts/build.ts exited ${run.status} on a fresh build\nstderr: ${String(run.stderr)}`,
    );

    for (const name of BUNDLE_FILES) {
      const builtPath = join(outDir, name);
      const committedPath = join(COMMITTED_DIST, name);
      assert.ok(
        existsSync(builtPath),
        `fresh build did not produce ${name} under SPECSTRIDE_TAB_OUT (${builtPath}) — the build-tab wiring (T065's scripts/build-tab.ts) is missing or ignores SPECSTRIDE_TAB_OUT`,
      );
      assert.ok(
        existsSync(committedPath),
        `the committed dashboard bundle file hermes-plugin/specstride/dashboard/dist/${name} is missing`,
      );
      const built = readFileSync(builtPath);
      const committed = readFileSync(committedPath);
      const offset = firstDiff(built, committed);
      assert.equal(
        offset,
        -1,
        `drift in dist/${name}: first differing byte at offset ${offset}\n` +
          `  fresh:     ${excerpt(built, offset)}\n` +
          `  committed: ${excerpt(committed, offset)}`,
      );
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
