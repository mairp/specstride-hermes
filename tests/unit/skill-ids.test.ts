/**
 * The skill-id tests of the Hermes host (T073, PT-150-001, PT-150-002): the
 * five Hermes spellings exist under their logical ids, an unknown id fails
 * the build, and the copy table of R3 holds — the doctor ships `bundled`
 * only (never model-invocable), run, status and curate ship both copies,
 * and `specstride-reverse` ships both but is gated on the CLI verb.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesSkillRenders } from "../../src/skills.ts";
import { hermesEntry, hermesProfile, HERMES_SPELLINGS } from "../../src/profile.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const SPELLINGS: Readonly<Record<string, string>> = {
  "specstride-run": "specstride-run",
  "specstride-reverse": "specstride-reverse",
  doctor: "specstride-doctor",
  status: "specstride-status",
  curate: "specstride-curate",
};

function renderOf(logicalId: string) {
  const render = hermesSkillRenders().find((r) => r.logicalId === logicalId);
  assert.ok(render, `no render for ${logicalId}`);
  return render;
}

test("the five logical ids render to exactly the five Hermes spellings (F150-FR-001)", () => {
  const renders = hermesSkillRenders();
  assert.equal(renders.length, 5);
  for (const [logicalId, spelling] of Object.entries(SPELLINGS)) {
    assert.equal(hermesEntry(logicalId), spelling, `the spelling of ${logicalId} drifted`);
    assert.equal(renderOf(logicalId).spelling, spelling);
  }
  assert.deepEqual(Object.keys(HERMES_SPELLINGS).sort(), Object.keys(SPELLINGS).sort());
  assert.equal(hermesProfile.spellings, HERMES_SPELLINGS satisfies typeof hermesProfile.spellings);
});

test("an unknown logical id fails the build (F150-FR-001)", () => {
  assert.throws(() => hermesEntry("specstride-batch"), /unknown|Unknown/i);
  assert.throws(() => hermesEntry(""), /unknown|Unknown/i);
  assert.throws(() => hermesEntry("specstride-doctor "), /unknown|Unknown/i);
});

test("the doctor ships bundled only — no plain copy, on disk or in the render (F150-FR-002)", () => {
  const render = renderOf("doctor");
  assert.deepEqual([...render.copies], ["bundled"]);
  assert.ok(!existsSync(join(ROOT, "skills", "specstride", "specstride-doctor")), "a plain specstride-doctor copy exists");
  assert.ok(existsSync(join(ROOT, "hermes-plugin", "specstride", "skills", "specstride-doctor", "SKILL.md")));
});

test("run, status and curate ship both copies, on disk and in the render", () => {
  for (const logicalId of ["specstride-run", "status", "curate"]) {
    const render = renderOf(logicalId);
    assert.deepEqual([...render.copies].sort(), ["bundled", "plain"], `${logicalId} does not ship both copies`);
    const plain = join(ROOT, "skills", "specstride", render.spelling, "SKILL.md");
    const bundled = join(ROOT, "hermes-plugin", "specstride", "skills", render.spelling, "SKILL.md");
    assert.ok(existsSync(plain), `no plain copy of ${render.spelling}`);
    assert.ok(existsSync(bundled), `no bundled copy of ${render.spelling}`);
  }
});

test("specstride-reverse ships both copies and is gated on the CLI verb (F150-FR-031)", () => {
  const render = renderOf("specstride-reverse");
  assert.deepEqual([...render.copies].sort(), ["bundled", "plain"]);
  assert.equal(render.gated, true);
  for (const render of hermesSkillRenders()) {
    if (render.logicalId !== "specstride-reverse") assert.equal(render.gated, false);
  }
});
