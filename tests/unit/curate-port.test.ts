/**
 * The curate port test (T048, PT-150-032, F150-FR-032): the rendered
 * `specstride-curate` is the port of the source of record
 * (`skills-src/curate/source.md`, retargeted by `retarget.json`), so every
 * body line attributes to `curate-source` or a runtime-notes id (F150-FR-004),
 * no term of the original host remains outside quoted history, and the skill
 * stays within its 8,000-token budget (F150-FR-045). No model call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesSkillRenders } from "../../src/skills.ts";
import { runtimeNotes } from "../../src/runtime-notes.ts";
import { hermesProfile } from "../../src/profile.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const NOTE_IDS = new Set(runtimeNotes.map((note) => note.id));
const render = hermesSkillRenders().find((r) => r.logicalId === "curate");

test("the curate render exists, spelled specstride-curate, plain and bundled", () => {
  assert.ok(render, "the curate render exists");
  assert.equal(render.spelling, "specstride-curate");
  assert.deepEqual([...render.copies], ["plain", "bundled"]);
});

test("every body line attributes to curate-source or a runtime-notes id (F150-FR-004)", () => {
  const unattributed = render.bodyLines
    .filter((line) => line.text.trim() !== "")
    .filter((line) => line.attribution !== "curate-source" && !NOTE_IDS.has(line.attribution));
  assert.deepEqual(
    unattributed.map((line) => line.text.slice(0, 60)),
    [],
    "unattributed body line(s)",
  );
});

test("no term of the original host remains in the rendered skill", () => {
  const body = render.bodyLines.map((line) => line.text).join("\n");
  assert.doesNotMatch(body, /dsh/i);
  // The original host's deterministic script and prompt never appear: the
  // skill calls this package's control command instead (F150-FR-033).
  assert.doesNotMatch(body, /reconcile-specs\.sh/);
  assert.doesNotMatch(body, /curate-for-dsh/);
  assert.match(body, /specstride-host-hermes curate reconcile/);
  assert.match(body, /curate-for-hermes\.md/);
});

test("the curate budget holds: at most 8,000 tokens and 500 body lines (F150-FR-045)", () => {
  assert.equal(hermesProfile.tokenBudgets["curate"], 8000);
  assert.ok(render.tokens <= 8000, `tokens ${render.tokens} exceed 8000`);
  assert.ok(render.bodyLines.length <= 500, `${render.bodyLines.length} body lines exceed 500`);
});

test("retarget.json declares the source of record, the prompt and the substitutions", () => {
  const retarget = JSON.parse(readFileSync(join(ROOT, "skills-src", "curate", "retarget.json"), "utf8"));
  assert.equal(retarget.prompt, "curate-for-hermes.md");
  assert.equal(retarget.sourceCopy, "skills-src/curate/source.md");
  assert.ok(retarget.sourceOfRecord.includes("specstride-curate/SKILL.md"), "names the source of record");
  assert.ok(Array.isArray(retarget.substitutions) && retarget.substitutions.length >= 5, "the substitutions");
  // The retargeted copy exists and carries the retargeted call and prompt.
  assert.equal(existsSync(join(ROOT, "skills-src", "curate", "source.md")), true);
  const source = readFileSync(join(ROOT, "skills-src", "curate", "source.md"), "utf8");
  assert.match(source, /specstride-host-hermes curate reconcile/);
  assert.match(source, /curate-for-hermes\.md/);
  assert.match(source, /delegate_task/);
});

test("the built copies match the render", () => {
  const plain = readFileSync(join(ROOT, "skills", "specstride", "specstride-curate", "SKILL.md"), "utf8");
  const body = render.bodyLines.map((line) => line.text).join("\n");
  assert.ok(plain.includes(body), "the plain copy carries the rendered body");
});
