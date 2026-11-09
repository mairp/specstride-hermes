/**
 * Shared fixture of the US2 run contract tests (T032–T035): the rendered
 * `specstride-run` body, read from the BUILT artifact so the tests observe
 * the shipped state (`skills/specstride/specstride-run/SKILL.md`), built
 * exactly as the gate builds it (T020's build, F150-FR-004).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");

let cached: string | null = null;

/** The composed body of `specstride-run`, as the build shipped it. */
export function builtRunBody(): string {
  if (cached === null) {
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", join("scripts", "build.ts")],
      { cwd: ROOT, stdio: "pipe" },
    );
    cached = readFileSync(join(ROOT, "skills", "specstride", "specstride-run", "SKILL.md"), "utf8");
  }
  return cached;
}

/** The composed body of another built plain skill, by Hermes spelling. */
export function builtBodyOf(spelling: string): string {
  return readFileSync(join(ROOT, "skills", "specstride", spelling, "SKILL.md"), "utf8");
}

export { ROOT as REPO_ROOT };
