/**
 * The tasks.md parser tests (T015; PT-151-034): this repository's own
 * `specs/150-host-hermes/tasks.md` parses to 10 phases; fenced code is
 * skipped; representative fixtures parse the goal, the independent test, the
 * checkpoint, the `[P]` and `[USn]` tags and the file references.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePhases, parseScopes } from "../../../src/kanban/reader/tasks-md.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const TASKS_150 = readFileSync(join(ROOT, "specs", "150-host-hermes", "tasks.md"), "utf8");

test("this repository's specs/150-host-hermes/tasks.md parses to 10 phases", () => {
  const phases = parsePhases(TASKS_150);
  assert.equal(phases.length, 10);
  assert.equal(phases[0].number, 1);
  assert.equal(phases[0].title, "Setup");
  assert.ok(phases.every((phase, index) => phase.number === index + 1));
  // The tasks are real: the repo's own phase 1 holds T001–T009.
  assert.deepEqual(
    phases[0].tasks.map((task) => task.id),
    ["T001", "T002", "T003", "T004", "T005", "T006", "T007", "T008", "T009"],
  );
  assert.ok(phases[0].tasks.every((task) => task.done), "150 is finished: every task is ticked");
  assert.equal(phases[0].goal, null, "phase 1 of 150 has no **Goal** line");
});

test("fenced code is skipped: a Phase heading shown in a code block is not a phase", () => {
  const text = [
    "# Tasks",
    "",
    "```",
    "## Phase 9: Fake (inside a fence)",
    "- [ ] T901 Fake task",
    "~~~",
    "- [ ] T902 Also inside",
    "```",
    "",
    "## Phase 1: Real",
    "",
    "- [ ] T001 Real task",
  ].join("\n");
  const phases = parsePhases(text);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].number, 1);
  assert.deepEqual(phases[0].tasks.map((task) => task.id), ["T001"]);
});

test("representative fixture: goal, independent test, checkpoint, [P], [USn], files", () => {
  const text = [
    "## Phase 3: User Story 7 — Relaunch and ended runs (P1)",
    "",
    "**Goal**: the reader shows the run that is alive, reads `src/kanban/reader/runs.ts` semantics.",
    "",
    "**Independent Test**: the fixture workspaces `relaunch`, `pid-reuse` through the reader.",
    "",
    "### Tests for US7",
    "",
    "- [ ] T018 [P] [US7] `tests/kanban/reader/pick-run.test.ts` first; uses `tests/helpers/fs-port.ts`.",
    "- [x] T019 [P] [US7] `tests/kanban/reader/alive.test.ts` after.",
    "- [ ] T020 [US7] no parallel tag here.",
    "",
    "**Checkpoint**: T018–T022 pass.",
    "",
    "## Phase 4: User Story 1 — Projection (P1)",
    "",
    "**Goal**: cards of a run on the native board.",
    "",
    "- [ ] T026 plain task.",
  ].join("\n");
  const phases = parsePhases(text);
  assert.equal(phases.length, 2);
  assert.equal(phases[0].goal, "the reader shows the run that is alive, reads `src/kanban/reader/runs.ts` semantics.");
  assert.match(phases[0].independentTest ?? "", /fixture workspaces/);
  assert.match(phases[0].checkpoint ?? "", /T018–T022 pass/);
  assert.equal(phases[1].independentTest, null);

  const scopes = parseScopes(text);
  assert.equal(scopes.tasksTotal, 4);
  assert.equal(scopes.tasksDone, 1);
  assert.deepEqual(scopes.parallel.map((task) => task.id), ["T018", "T019"]);
  assert.deepEqual(scopes.stories["US7"].map((task) => task.id), ["T018", "T019", "T020"]);
  assert.ok(scopes.stories["US7"][0].done === false);
  // The file references of the goal/test/checkpoint lines are collected.
  assert.deepEqual(scopes.files, ["src/kanban/reader/runs.ts"]);
  // And the file references of a task line sit on the task.
  assert.deepEqual(scopes.parallel[0].files, ["tests/kanban/reader/pick-run.test.ts", "tests/helpers/fs-port.ts"]);
});

test("a bracket that is not a tag ends the tag run, and ticks are read", () => {
  const text = ["## Phase 1: P", "", "- [x] T001 [P] done `a.ts`", "- [ ] T002 [US2] todo", "- [X] T003 [P] capital tick"].join("\n");
  const scopes = parseScopes(text);
  assert.equal(scopes.tasksDone, 2);
  assert.deepEqual(scopes.parallel.map((task) => task.id), ["T001", "T003"]);
  assert.deepEqual(scopes.stories["US2"].map((task) => task.id), ["T002"]);
  assert.deepEqual(scopes.parallel[0].files, ["a.ts"]);
});

test("this repository's own 151 tasks.md parses with story scopes", () => {
  const tasks151 = readFileSync(join(ROOT, "specs", "151-hermes-kanban", "tasks.md"), "utf8");
  const scopes = parseScopes(tasks151);
  assert.ok(scopes.phases.length >= 10);
  assert.ok(scopes.stories["US7"].length > 0, "US7 exists in 151's tasks.md");
  assert.ok(scopes.parallel.length > 0);
});
