/**
 * The session-log grader tests (T064, PT-150-046): each fixture under
 * `evals/fixtures/` grades to matched, not matched or not scored exactly as
 * recorded, and the typed-load fixture marked `unverified` (U-150-09) grades
 * `not scored` with its reason. No model is called: the grader reads
 * recorded `stream-json` logs only (F150-FR-046).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  gradeFixtureFile,
  gradeSessionLog,
  parseSessionLog,
  gradeParsedSessionLog,
  loadedSkillOf,
} from "../../src/evals/grader.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "evals", "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

test("skill-view-run grades matched", () => {
  const grade = gradeFixtureFile(fixture("skill-view-run.jsonl"), "specstride-run");
  assert.equal(grade.outcome, "matched");
  assert.equal(grade.loaded, "specstride-run");
});

test("skill-view-other grades not matched against the expected skill", () => {
  const grade = gradeFixtureFile(fixture("skill-view-other.jsonl"), "specstride-run");
  assert.equal(grade.outcome, "not-matched");
  assert.equal(grade.loaded, "specstride-status");
});

test("no-skill grades matched where no skill may fire, not matched where one is expected", () => {
  const none = gradeFixtureFile(fixture("no-skill.jsonl"), null);
  assert.equal(none.outcome, "matched");
  assert.equal(none.loaded, null);
  const expected = gradeFixtureFile(fixture("no-skill.jsonl"), "specstride-run");
  assert.equal(expected.outcome, "not-matched");
});

test("interrupted-130 grades not scored, never a failure", () => {
  const grade = gradeFixtureFile(fixture("interrupted-130.jsonl"), "specstride-run");
  assert.equal(grade.outcome, "not-scored");
  assert.match(grade.reason, /interrupted \(exit 130\)/);
});

test("usage-limit grades not scored with its reason", () => {
  const grade = gradeFixtureFile(fixture("usage-limit.jsonl"), "specstride-run");
  assert.equal(grade.outcome, "not-scored");
  assert.match(grade.reason, /usage limit/);
});

test("content-injection text is data: no skill loads, and the grade reads only behaviour", () => {
  const grade = gradeFixtureFile(fixture("content-injection.jsonl"), null);
  assert.equal(grade.outcome, "matched");
  const againstRun = gradeFixtureFile(fixture("content-injection.jsonl"), "specstride-run");
  assert.equal(againstRun.outcome, "not-matched");
});

test("a typed-load fixture marked unverified grades not scored with the U-150-09 reason", () => {
  const marked = gradeFixtureFile(fixture("typed-load.jsonl"), "specstride-run", {
    typedLoadUnverified: true,
  });
  assert.equal(marked.outcome, "not-scored");
  assert.match(marked.reason, /U-150-09/);
  // Without the marker the same log is an ordinary not-matched: the grader
  // never treats the unverified event as a load.
  const unmarked = gradeFixtureFile(fixture("typed-load.jsonl"), "specstride-run");
  assert.equal(unmarked.outcome, "not-matched");
});

test("a log without a result event is not matched, not guessed about", () => {
  const grade = gradeSessionLog(
    '{"type":"system","event":"init","session":"s"}\n{"type":"user","text":"run"}\n',
    "specstride-run",
  );
  assert.equal(grade.outcome, "not-matched");
});

test("malformed lines are skipped, not parsed as events", () => {
  const log = parseSessionLog("not json\n{\"type\":\"result\",\"exit_code\":0}\n");
  assert.equal(log.events.length, 1);
  assert.equal(loadedSkillOf(log), null);
  assert.equal(gradeParsedSessionLog(log, null).outcome, "matched");
});
