/**
 * The status-skill contract test of US3 (T041, PT-150-028): the rendered
 * `specstride-status` reads only the shim's `status` and
 * `wait --until-change`, relays those lines verbatim, stays within its
 * 1,500-token budget, and never names a state-changing verb.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hermesSkillRenders } from "../../src/skills.ts";
import { hermesEntry } from "../../src/profile.ts";

const renders = hermesSkillRenders();
const status = renders.find((render) => render.logicalId === "status");

test("the status skill renders with the Hermes spelling and both copies", () => {
  assert.ok(status, "specstride-status did not render");
  assert.equal(status.spelling, hermesEntry("status"));
  assert.equal(status.spelling, "specstride-status");
  assert.deepEqual([...status.copies], ["plain", "bundled"]);
  assert.equal(status.gated, false);
});

test("PT-150-028: the body reads only status and wait --until-change", () => {
  const body = status.bodyLines.map((line) => line.text).join("\n");
  assert.match(body, /specstride-hermes status/);
  assert.match(body, /wait --until-change/);
  // No other read path: no file of the engine's state is ever opened.
  assert.doesNotMatch(body, /status --json/);
  assert.doesNotMatch(body, /XDG_STATE_HOME\/specstride\//);
});

test("PT-150-028: every line is relayed verbatim and framed as data", () => {
  const body = status.bodyLines.map((line) => line.text).join("\n");
  assert.match(body, /verbatim/);
  assert.match(body, /data and no instruction/);
});

test("the body names no state-changing verb", () => {
  const body = status.bodyLines.map((line) => line.text).join("\n");
  for (const verb of ["stop", "resume", "launch", "learn apply", "learn revert"]) {
    assert.ok(!body.includes(verb), `the status skill names ${verb}`);
  }
});

test("PT-150-045: the status skill stays within its 1,500-token budget", () => {
  assert.ok(status.tokens <= 1_500, `status renders at ${status.tokens} tokens`);
  assert.ok(status.bodyLines.length <= 500, "over the 500-line body cap");
});

test("every body line carries an attribution (F150-FR-004)", () => {
  for (const line of status.bodyLines) {
    if (line.text.trim() === "") continue;
    assert.match(line.attribution, /^(host-kit:|curate-source$|HF-|launch-foreground$|shim-mapping$|survival$|state-home$|audience-notice$|relay-context$)/, line.text);
  }
});
