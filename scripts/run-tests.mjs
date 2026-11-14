#!/usr/bin/env node
/**
 * The per-change test runner of the Hermes host: every `tests` test file
 * (any depth, `.test.ts`), including the two live lanes under `tests/live/`
 * (T079). The runner sets `SPECSTRIDE_PER_CHANGE=1`, which both live lanes
 * answer with `skipped` — never `passed` — so a per-change run never spends
 * hours in the real Hermes dispatcher and never starts a dashboard
 * (Principle XVII). Run the lanes for real with `npm run test:live`.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = globSync(join(root, "tests/**/*.test.ts")).sort();
if (files.length === 0) {
  console.error("run-tests: no test files found");
  process.exit(1);
}
const run = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "--test-concurrency=1", ...files],
  { stdio: "inherit", env: { ...process.env, SPECSTRIDE_PER_CHANGE: "1" } },
);
process.exit(run.status ?? 1);
