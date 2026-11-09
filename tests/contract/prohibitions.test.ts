/**
 * T034 — contract test for the prohibitions (PT-150-008, PT-150-009,
 * PT-150-010; F150-FR-008, F150-FR-009, F150-FR-010).
 *
 * Judgment batches are at most 3,000 tokens (the kit's cap, stated in the
 * body); the fixture repository is byte-identical after the hermetic
 * sequence; no `learn apply|revert|off` call is made; artifacts are named by
 * the logical name the CLI printed, never by a path; and supervision makes
 * one `wait --until-change` per cycle with the previous cursor, prints
 * nothing for an unchanged cycle and prints the digest last.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIGEST_IS_THE_FINAL_LINE,
  DIGEST_IS_PRINTED_VERBATIM,
  JUDGMENT_BATCH_TOKEN_CAP,
  PROHIBITION_TEXTS,
  SUPERVISION_CHANGE_OPTION,
  SUPERVISION_COMMAND,
  SUPERVISION_CURSOR_OPTION,
  UNCHANGED_CYCLE_PRINTS_NOTHING,
  UNCHANGED_CYCLE_TOKENS,
  judgmentSectionOf,
  prohibitionSectionOf,
  prohibitionsOf,
} from "@specstride/host-kit";
import { hermesProfile } from "../../src/profile.ts";
import { runtimeNotes } from "../../src/runtime-notes.ts";
import { builtRunBody } from "./run-body.ts";
import { calls, driveRun, setupHermetic, treeDigest } from "./hermetic-run.ts";

const body = builtRunBody();

test("judgment batches are at most 3,000 tokens, stated in the body (F150-FR-008)", () => {
  assert.equal(JUDGMENT_BATCH_TOKEN_CAP, 3000);
  const section = judgmentSectionOf({ delegatesToAHarness: true });
  for (const line of section) {
    assert.ok(body.includes(line), `judgment line missing from the body: ${line}`);
  }
  assert.match(body, /a batch is at most 3000 tokens/);
});

test("the fixture repository is byte-identical after the sequence (F150-FR-009)", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());

  const result = driveRun(ctx, { comment: "run it", mode: "run" });

  assert.ok(result.launched);
  assert.equal(treeDigest(ctx.fixture), ctx.before, "no file of the fixture changed");
});

test("no `learn apply|revert|off` call is made, and the body forbids them (F150-FR-009)", (t) => {
  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());

  driveRun(ctx, { comment: "run it", mode: "run" });

  for (const argv of calls(ctx)) {
    const joined = argv.join(" ");
    assert.ok(!/^learn (apply|revert|off)/.test(joined), `forbidden call: ${joined}`);
    assert.ok(!/\blearn (apply|revert|off)\b/.test(joined), `forbidden verb in: ${joined}`);
  }
  // The body's prohibition text carries the rule for the model, too.
  const prohibitionLines = prohibitionSectionOf(
    prohibitionsOf({
      "no-repository-write": { requirement: "F150-FR-006", origin: null },
      "no-verification-file": { requirement: "F150-FR-007", origin: null },
      "no-cli-search": { requirement: "F150-FR-011", origin: null },
      "logical-names-only": { requirement: "F150-FR-005", origin: null },
      "no-launcher-edit": { requirement: "F150-FR-009", origin: null },
      "supervision-reads-only": { requirement: "F150-FR-010", origin: null },
    }),
  );
  for (const line of prohibitionLines) {
    assert.ok(body.includes(line), `prohibition line missing from the body: ${line}`);
  }
  for (const id of ["learn-apply", "learn-revert", "learn-off"]) {
    const text = PROHIBITION_TEXTS[id];
    if (text === undefined) continue;
    const line = String(text.requirement ?? text);
    assert.ok(
      body.includes(line) || body.includes(id),
      `the ${id} prohibition is stated in the body`,
    );
  }
});

test("artifacts are named by logical name, never by a path (F150-FR-009)", () => {
  // The body's own reference closure: no path into product source, engine
  // state or logs, and no state root spelled out.
  assert.ok(!/node_modules/.test(body), "the body names no installed package");
  assert.ok(!/XDG_STATE_HOME\/specstride\b/.test(body), "the body names no engine state path");
  assert.ok(!/\.specstride\//.test(body), "the body names no engine state directory");
  // The engine's artifacts enter the body only by logical name: the draft,
  // the bundle, the run — the stub's own answers are the shape.
  assert.match(body, /logical name/);
});

test("supervision: one blocking wait per cycle with the previous cursor, unchanged prints nothing, the digest last (F150-FR-010)", (t) => {
  // The kit's figures, and this host's budgets over them.
  assert.equal(SUPERVISION_COMMAND, "wait");
  assert.equal(SUPERVISION_CHANGE_OPTION, "--until-change");
  assert.equal(SUPERVISION_CURSOR_OPTION, "--cursor");
  assert.equal(UNCHANGED_CYCLE_PRINTS_NOTHING, true);
  assert.equal(DIGEST_IS_PRINTED_VERBATIM, true);
  assert.equal(DIGEST_IS_THE_FINAL_LINE, true);
  assert.equal(UNCHANGED_CYCLE_TOKENS, 0);
  assert.equal(hermesProfile.tokenBudgets["cycle"], 150);
  assert.equal(hermesProfile.tokenBudgets["supervision"], 3000);
  // The Hermes supervision note: no background primitive on this host.
  const survival = runtimeNotes.find((note) => note.id === "launch-foreground");
  assert.ok(survival, "the launch-foreground note exists");
  assert.ok(body.includes("foreground"), "the body launches in the foreground");

  const ctx = setupHermetic();
  t.after(() => ctx.cleanup());

  const result = driveRun(ctx, { comment: "run it", mode: "run" });

  // Exactly one wait per cycle, each with the cursor of the previous cycle.
  const waits = calls(ctx).filter((argv) => argv[0] === "wait");
  assert.equal(waits.length, 3);
  assert.deepEqual(waits[0], ["wait", "--until-change", "--cursor", "0001"]);
  assert.deepEqual(waits[1], ["wait", "--until-change", "--cursor", "0002"]);
  assert.deepEqual(waits[2], ["wait", "--until-change", "--cursor", "0002"]);
  // The changed line is relayed verbatim; the unchanged cycle printed
  // nothing; the digest is the last line printed.
  assert.ok(result.printed.includes("changed cursor=0002"));
  assert.equal(result.printed[result.printed.length - 1], "DIGEST run-001 verdict=pass");
  const digestIndex = result.printed.indexOf("DIGEST run-001 verdict=pass");
  assert.equal(
    result.printed.slice(digestIndex + 1).length,
    0,
    "nothing prints after the digest",
  );
});
