/**
 * The budget tests of the Hermes host (T071, PT-150-045): every rendered
 * skill is measured at the profile's 2.8 bytes/token against `hermesProfile`
 * and held under the 500-line body cap. The build already fails on a breach
 * (`scripts/build.ts`, and the kit's `renderSkill`); this suite holds the
 * same figures over the rendered set independently, so a budget regression
 * fails the build even where the kit's lookup is bypassed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesSkillRenders } from "../../src/skills.ts";
import { hermesProfile, BYTES_PER_TOKEN, MAX_BODY_LINES } from "../../src/profile.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const EXPECTED_TOKEN_BUDGETS: Readonly<Record<string, number>> = {
  "specstride-run": 8000,
  "specstride-reverse": 7000,
  doctor: 1500,
  status: 1500,
  curate: 8000,
};

/** The rendered skill of a logical id, or a failing lookup. */
function renderOf(logicalId: string) {
  const render = hermesSkillRenders().find((r) => r.logicalId === logicalId);
  assert.ok(render, `no render for ${logicalId}`);
  return render;
}

test("every profile budget is the figure of F150-FR-045", () => {
  for (const [id, tokens] of Object.entries(EXPECTED_TOKEN_BUDGETS)) {
    assert.equal(
      hermesProfile.tokenBudgets[id],
      tokens,
      `budget of ${id} drifted from F150-FR-045`,
    );
  }
  assert.equal(BYTES_PER_TOKEN, 2.8);
  assert.equal(MAX_BODY_LINES, 500);
});

test("each rendered skill is within its byte budget at 2.8 B/token", () => {
  for (const render of hermesSkillRenders()) {
    const budgetTokens = EXPECTED_TOKEN_BUDGETS[render.logicalId];
    assert.ok(budgetTokens, `no budget declared for ${render.logicalId}`);
    const budgetBytes = budgetTokens * BYTES_PER_TOKEN;
    assert.ok(
      render.bytes <= budgetBytes,
      `${render.logicalId} is ${render.bytes} B, over its budget of ${budgetBytes} B (${budgetTokens} tokens at ${BYTES_PER_TOKEN} B/token)`,
    );
    assert.ok(
      render.tokens <= budgetTokens,
      `${render.logicalId} measures ${render.tokens.toFixed(1)} tokens, over ${budgetTokens}`,
    );
    // The written file is the rendered bytes: hold the shipped SKILL.md of
    // the plain copy (the bundled copy is the same content) to the figure.
    const shippedPath = render.copies.includes("plain")
      ? join(ROOT, "skills", "specstride", render.spelling, "SKILL.md")
      : join(ROOT, "hermes-plugin", "specstride", "skills", render.spelling, "SKILL.md");
    // The shipped file (frontmatter + body) is held to the same figure.
    const shippedBytes = Buffer.byteLength(readFileSync(shippedPath, "utf8"), "utf8");
    assert.ok(
      shippedBytes <= budgetBytes,
      `the shipped ${render.spelling} is ${shippedBytes} B, over its budget of ${budgetBytes} B`,
    );
  }
});

test("every skill body stays under the 500-line cap", () => {
  for (const render of hermesSkillRenders()) {
    const bodyLines = render.bodyLines.length;
    assert.ok(
      bodyLines <= MAX_BODY_LINES,
      `the body of ${render.logicalId} is ${bodyLines} lines, over the cap of ${MAX_BODY_LINES}`,
    );
  }
});

test("the supervision cycle budgets of the profile are 150 and 0", () => {
  assert.equal(hermesProfile.tokenBudgets["cycle"], 150);
  assert.equal(hermesProfile.tokenBudgets["unchanged"], 0);
  assert.equal(hermesProfile.tokenBudgets["supervision"], 3000);
});
