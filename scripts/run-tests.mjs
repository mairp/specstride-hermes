#!/usr/bin/env node
/**
 * The per-change test runner of the Hermes host: every `tests` test file
 * (any depth, `.test.ts`) except the live lanes under `tests/live/` (T042's dispatcher lane and its
 * sibling run against the real Hermes 0.22.2 and take hours; their own
 * headers say "run it explicitly, not on every change", and Principle XVII
 * keeps them `skipped` — never `passed` — without Hermes). Run the live
 * lanes explicitly with `npm run test:live`.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = globSync(join(root, "tests/**/*.test.ts"))
  .filter((f) => !f.includes(`${join(root, "tests", "live")}`))
  .sort();
if (files.length === 0) {
  console.error("run-tests: no test files found");
  process.exit(1);
}
const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=1", ...files], {
  stdio: "inherit",
});
process.exit(run.status ?? 1);
