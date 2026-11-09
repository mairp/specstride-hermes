/**
 * T032 — contract test for the run sequence (PT-150-004, PT-150-005,
 * PT-150-006; F150-FR-004, F150-FR-005, F150-FR-006).
 *
 * The rendered `specstride-run` body carries the kit's `RUN_STEPS` order —
 * capture the comment; check the CLI; derive; judge; validate and promote;
 * render; launch; outcome; supervise; digest — and, hermetically (stub CLI
 * behind the shim, temporary HERMES_HOME), the stub's call log holds that
 * order, `started`/`attached`/`refused` are relayed verbatim with the
 * sequence stopping at the first refusal, and `dry-run` — or a refusing
 * comment — makes no `launch` call and leaves the fixture untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODE,
  DRY_RUN_LAST_STEP,
  MODES,
  RUN_STEP_IDS,
  RUN_STEPS,
  decideMode,
  stepLines,
  stepsOfMode,
} from "@specstride/host-kit";
import { builtRunBody } from "./run-body.ts";
import {
  driveRun,
  calls,
  commandsOf,
  scenario,
  setupHermetic,
  treeDigest,
} from "./hermetic-run.ts";

const body = builtRunBody();

/** The ids of the ten steps, in the order of F150-FR-004. */
const EXPECTED_STEP_IDS = [
  "capture-the-comment",
  "cli-check",
  "derive",
  "judge",
  "validate",
  "render",
  "launch",
  "outcome-line",
  "supervise",
  "digest",
];

test("the kit's RUN_STEPS hold the ten steps of F150-FR-004, in order", () => {
  assert.equal(RUN_STEPS.length, 10);
  assert.deepEqual([...RUN_STEP_IDS], EXPECTED_STEP_IDS);
  assert.deepEqual(
    RUN_STEP_IDS.map((_, i) => RUN_STEPS[i].number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test("the composed body carries the RUN_STEPS order, verbatim and in order (F150-FR-004)", () => {
  const lines = stepLines(RUN_STEPS);
  let cursor = 0;
  for (const line of lines) {
    const at = body.indexOf(line, cursor);
    assert.notEqual(at, -1, `step line missing or out of order: ${line}`);
    cursor = at + line.length;
  }
});

test("mode resolution follows the kit decideMode (F113-FR-005, F150-FR-006)", () => {
  assert.deepEqual([...MODES], ["run", "dry-run"]);
  assert.equal(DEFAULT_MODE, "run");

  assert.equal(decideMode({}).mode, "run");
  // An explicit mode beats prose in the comment — even inviting prose.
  const explicit = decideMode({ explicit: "dry-run", comment: "run it, go ahead, for real" });
  assert.equal(explicit.mode, "dry-run");
  assert.equal(explicit.changedByTheComment, false);
  // A refusal in the comment beats an invitation and gives dry-run.
  const refusal = decideMode({ comment: "run it — actually, do not run yet, just show me" });
  assert.equal(refusal.mode, "dry-run");
  assert.equal(refusal.changedByTheComment, true);
  assert.ok(refusal.saysWhatChanged !== null);
  const invitation = decideMode({ comment: "go ahead and run it" });
  assert.equal(invitation.mode, "run");
  assert.equal(invitation.source, "an invitation in the comment");
});

test("dry-run stops at DRY_RUN_LAST_STEP, prints the plan and the verdict, launches nothing", () => {
  assert.equal(DRY_RUN_LAST_STEP, "validate");
  const drySteps = stepsOfMode("dry-run");
  assert.deepEqual([...drySteps.map((s) => s.id)], EXPECTED_STEP_IDS.slice(0, 5));
  assert.ok(!drySteps.some((s) => s.id === "launch"), "dry-run has no launch step");
  assert.match(body, /In `dry-run`: derive and validate, print the plan, and STOP\. Never launch\./);
});

test("hermetic run: the stub log holds the kit's order and the outcome is relayed verbatim", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());
  const comment = "please `run` it   with odd  spacing and \"quotes\"";

  const result = driveRun(ctx, { comment, mode: "run" });

  // The calls arrived in the order of F150-FR-004 (= RUN_STEP_IDS), and the
  // shim probed the protocol before every call (its own step of F150-FR-011).
  const log = calls(ctx);
  assert.equal(commandsOf(log)[0], "contract derive");
  assert.deepEqual(
    commandsOf(log),
    [
      "contract derive",
      "contract derive",
      "contract validate",
      "contract promote",
      "contract render",
      "launch",
      "wait",
      "wait",
      "wait",
      "digest",
    ],
  );
  for (let i = 0; i < log.length; i += 2) {
    assert.equal(log[i][0], "--protocol", `the shim's probe precedes call ${i / 2}`);
  }
  // The outcome line is relayed verbatim: what the CLI printed is what is printed.
  assert.equal(result.outcomeLine, "started run-001 detached from the session");
  // The digest is the last line printed (F150-FR-010).
  assert.equal(result.printed[result.printed.length - 1], "DIGEST run-001 verdict=pass");
  // Zero files of the fixture repository changed.
  assert.equal(treeDigest(ctx.fixture), ctx.before);
});

test("`refused` is relayed verbatim, the fix line printed, and nothing follows the refusal", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());
  // The stub refuses the launch with the CLI's fix line, exit 4.
  scenario(ctx, "launch-outcome.txt", "refused: the launch check 'tests-green' failed — run npm test first");
  scenario(ctx, "launch-exit.txt", "4");

  const result = driveRun(ctx, { comment: "run it", mode: "run", supervise: false });

  // Verbatim: the CLI's refused line, with its fix, is what reaches the user.
  assert.equal(
    result.outcomeLine,
    "refused: the launch check 'tests-green' failed — run npm test first",
  );
  // The sequence stops at the first refusal: no wait, no digest, no retry.
  assert.deepEqual(commandsOf(calls(ctx)).slice(-1), ["launch"]);
  assert.ok(!result.printed.some((l) => l.startsWith("DIGEST")));
});

test("`attached` is relayed verbatim and supervision follows it", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());
  scenario(ctx, "launch-outcome.txt", "attached run-001 state root /run/specstride");

  const result = driveRun(ctx, { comment: "run it", mode: "run" });

  assert.equal(result.outcomeLine, "attached run-001 state root /run/specstride");
  assert.ok(result.launched);
  // Supervision ran and the digest closed it.
  assert.ok(calls(ctx).some((argv) => argv[0] === "wait"));
  assert.equal(result.printed[result.printed.length - 1], "DIGEST run-001 verdict=pass");
});

test("dry-run launches nothing and the fixture is untouched", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());
  const comment = "do not run yet, just show me the plan";

  const result = driveRun(ctx, { comment, mode: "dry-run" });

  assert.equal(result.launched, false);
  const log = calls(ctx);
  assert.ok(!log.some((argv) => argv[0] === "launch"), "dry-run launches nothing");
  assert.ok(!log.some((argv) => argv[0] === "wait" || argv[0] === "digest"));
  assert.deepEqual(
    commandsOf(log),
    ["contract derive", "contract derive", "contract validate"],
  );
  // The comment reached derive verbatim even in dry-run.
  assert.deepEqual(log.find((argv) => argv[0] === "contract")!.slice(-2), ["--comment", comment]);
  assert.match(result.printed.join("\n"), /validation verdict: pass/);
  assert.equal(treeDigest(ctx.fixture), ctx.before);
});

test("a refusing comment resolves dry-run and makes no launch call", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());

  const result = driveRun(ctx, {
    comment: "run it — actually, do not run yet, just show me",
    mode: "dry-run",
  });

  assert.equal(result.launched, false);
  assert.ok(!calls(ctx).some((argv) => argv[0] === "launch"));
  assert.equal(treeDigest(ctx.fixture), ctx.before);
});

