/**
 * T035 — the render part of PT-150-013 (F150-FR-013): the rendered
 * `specstride-run` — and the gated `specstride-reverse` — carry the
 * `launch-foreground` and `survival` Hermes runtime-note blocks, and carry no
 * instruction to run `launch` in the background. Survival rests on the
 * engine's detached start and the shim's scope escape, never on a background
 * job of the session (H5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtBodyOf, builtRunBody } from "../contract/run-body.ts";
import { runtimeNoteById, runtimeNotes } from "../../src/runtime-notes.ts";
import { hermesSkillRenders } from "../../src/skills.ts";

const body = builtRunBody();

test("the rendered specstride-run carries the launch-foreground block, verbatim", () => {
  const note = runtimeNoteById("launch-foreground");
  assert.ok(note, "the launch-foreground note exists");
  for (const line of note.lines) {
    assert.ok(body.includes(line), `launch-foreground line missing: ${line}`);
  }
  assert.match(body, /Launch is a foreground terminal call of `specstride-hermes`/);
});

test("the rendered specstride-run carries the survival block, verbatim", () => {
  const note = runtimeNoteById("survival");
  assert.ok(note, "the survival note exists");
  for (const line of note.lines) {
    assert.ok(body.includes(line), `survival line missing: ${line}`);
  }
  assert.match(body, /the engine detaches by itself/);
  assert.match(body, /outlives the conversation that started it/);
});

test("the rendered specstride-run never instructs a background launch", () => {
  assert.ok(!/run_in_background/.test(body), "no run_in_background in the body");
  assert.ok(!/in the background/.test(body), "no background instruction in the body");
  assert.ok(!/&\s*$/m.test(body), "no backgrounded shell line in the body");
  // The launch step is the only place the verb appears, and its note is the
  // foreground one.
  const stepText = body.match(/## Order[\s\S]*?##/)?.[0] ?? body;
  assert.ok(stepText.includes("foreground") || stepText.includes("Order"));
});

test("the gated specstride-reverse carries both blocks and no background instruction", () => {
  const reverse = builtBodyOf("specstride-reverse");
  for (const id of ["launch-foreground", "survival"]) {
    const note = runtimeNoteById(id);
    assert.ok(note, `the ${id} note exists`);
    for (const line of note.lines) {
      assert.ok(reverse.includes(line), `${id} line missing from reverse: ${line}`);
    }
  }
  assert.ok(!/run_in_background/.test(reverse));
  assert.ok(!/in the background/.test(reverse));
});

test("every supervising skill render holds all six Hermes runtime notes (T036 wiring)", () => {
  const ids = runtimeNotes.map((note) => note.id);
  assert.deepEqual(
    [...ids].sort(),
    ["audience-notice", "launch-foreground", "relay-context", "shim-mapping", "state-home", "survival"],
  );
  for (const render of hermesSkillRenders()) {
    if (render.logicalId !== "specstride-run" && render.logicalId !== "specstride-reverse") continue;
    const bodyText = render.bodyLines.map((line) => line.text).join("\n");
    for (const id of ids) {
      const note = runtimeNoteById(id)!;
      for (const line of note.lines) {
        assert.ok(bodyText.includes(line), `${render.logicalId} misses ${id}: ${line}`);
      }
    }
  }
});
