/**
 * The build of the Hermes host (T020): render the skills (T019), insert and
 * validate the frontmatter (T013), write the plain copies under
 * `skills/specstride/<name>/SKILL.md` and the bundled copies under
 * `hermes-plugin/specstride/skills/<name>/SKILL.md`, and render the shim
 * (T014) to `bin/specstride-hermes.mjs` with mode 755.
 *
 * The build FAILS on:
 * - an unattributed body line (F150-FR-004);
 * - a budget breach or more than 500 body lines (F150-FR-045, the kit's
 *   `budget-exceeded` and line check through the profile of T011);
 * - a path into engine source or state (the reference-closure patterns);
 * - a file whose sha256 matches an engine tarball file (F150-SC-007);
 * - a shim named `specstride` (contracts/shim.md, F150-FR-014).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { byteBudgetOf } from "@specstride/host-kit";
import { hermesSkillRenders } from "../src/skills.ts";
import { hermesProfile } from "../src/profile.ts";
import { insertFrontmatter, validateFrontmatter } from "../src/frontmatter.ts";
import { hermesShimScript, assertShimFileName, SHIM_FILE_NAME, shimBuildChecks } from "../src/shim.ts";
import { checkReferenceClosure, checkNoEngineCopy, allGateFindings } from "../src/gates.ts";
import { writeGeneratedClosedSets } from "./gen-kanban-values.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// T007: the kanban closed-set code tables are generated, never edited by
// hand; every build refreshes src/kanban/generated/closed-sets.ts from the
// closed-sets JSON before any gate runs over the sources.
writeGeneratedClosedSets();

function fail(message: string): never {
  console.error("build failed: " + message);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
};

shimBuildChecks();
assertShimFileName(SHIM_FILE_NAME);

const renders = hermesSkillRenders();

// Fresh build outputs: the tree is written, never merged into.
rmSync(join(ROOT, "skills"), { recursive: true, force: true });
rmSync(join(ROOT, "hermes-plugin", "specstride", "skills"), { recursive: true, force: true });
rmSync(join(ROOT, "bin"), { recursive: true, force: true });

const written: string[] = [];
for (const render of renders) {
  const body = render.bodyLines.map((line) => line.text).join("\n");
  // F150-FR-004: every body line carries an attribution.
  const unattributed = render.bodyLines
    .filter((line) => line.text.trim() !== "")
    .filter((line) => !/^(host-kit:|curate-source$|HF-|launch-foreground$|shim-mapping$|survival$|state-home$|audience-notice$|relay-context$)/.test(line.attribution))
    .map((line) => JSON.stringify(line.text.slice(0, 60)));
  if (unattributed.length > 0) fail(`unattributed body line(s) in ${render.logicalId}: ${unattributed.join("; ")}`);
  // F150-FR-045: the body cap of 500 lines, and the profile's budget — the
  // kit's render already failed the build on a breach; the cap is held here
  // over the body as shipped.
  const bodyLines = body.split("\n").length;
  if (bodyLines > hermesProfile.maxBodyLines)
    fail(`the body of ${render.logicalId} is ${bodyLines} lines, over the cap of ${hermesProfile.maxBodyLines} (F150-FR-045)`);
  // The total byte budget of the skill, from the profile: the render above
  // already threw `budget-exceeded` on a breach; the written bytes are held
  // to the same figure again.
  const budget = byteBudgetOf(render.logicalId, hermesProfile);
  if (budget !== undefined && render.bytes > budget)
    fail(
      `the rendered ${render.logicalId} is ${render.bytes} bytes, over its budget of ${budget} (F150-FR-045)`,
    );

  const text = insertFrontmatter(
    { spelling: render.spelling, description: render.frontmatter.description, body },
    { version: manifest.version, tags: render.frontmatter.tags },
  );
  const verdict = validateFrontmatter(text);
  if (!verdict.ok) fail(`frontmatter of ${render.logicalId}: ${verdict.errors.join("; ")}`);

  for (const copy of render.copies) {
    const path =
      copy === "plain"
        ? join(ROOT, "skills", "specstride", render.spelling, "SKILL.md")
        : join(ROOT, "hermes-plugin", "specstride", "skills", render.spelling, "SKILL.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    written.push(path);
  }
}

// Reference closure over the rendered tree: no path into engine source or
// state (F150-FR-005 / F150-SC-003).
for (const finding of checkReferenceClosure(ROOT)) fail(finding);

// No-engine-copy: no rendered file matches an engine file byte for byte
// (F150-SC-007).
for (const finding of checkNoEngineCopy(ROOT)) fail(finding);

// The shim: the standalone script, executable.
const shimPath = join(ROOT, "bin", SHIM_FILE_NAME + ".mjs");
mkdirSync(join(ROOT, "bin"), { recursive: true });
writeFileSync(shimPath, hermesShimScript());
chmodSync(shimPath, 0o755);
written.push(shimPath);

// The control CLI (T031): its source of record is
// `scripts/specstride-host-hermes.mjs`; the build copies it beside the shim.
const controlSource = join(ROOT, "scripts", "specstride-host-hermes.mjs");
const controlPath = join(ROOT, "bin", "specstride-host-hermes.mjs");
if (!existsSync(controlSource)) fail("the control CLI source scripts/specstride-host-hermes.mjs is missing");
writeFileSync(controlPath, readFileSync(controlSource));
chmodSync(controlPath, 0o755);
written.push(controlPath);

// The whole static gate set must pass the built tree.
for (const finding of allGateFindings(ROOT)) fail(finding);

for (const path of written) {
  console.log("wrote " + path.replace(ROOT + "/", ""));
}
console.log(
  `build ok: ${written.length} file(s), ${renders.length} skill(s), protocol ${JSON.stringify(
    (await import("../src/shim.ts")).thisPackageProtocolRange(),
  )}`,
);
