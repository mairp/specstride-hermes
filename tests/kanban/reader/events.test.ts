/**
 * The event fold tests (T016; PT-151-038): both streams parsed line by line
 * with torn lines skipped, merged in order, folded to RunFacts per the
 * activity table of contracts/workspace-reader.md §2, unknown event types
 * leaving the state untouched, error counts and lastAt, and the activity
 * returned as a NAME (no lane assignment here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_TABLE,
  endLaneOf,
  emptyFacts,
  foldEvents,
  foldStreams,
  mergeStreams,
  parseEvents,
} from "../../../src/kanban/reader/events.ts";

const line = (fields: Record<string, unknown>): string => JSON.stringify(fields);

test("both streams parse line by line and torn or malformed lines are skipped", () => {
  const text = [
    line({ seq: 1, type: "phase.started", phase: 1, at: "2026-11-11T10:00:00Z" }),
    line({ seq: 2, type: "pass.started", at: "2026-11-11T10:01:00Z" }),
    '{"seq":3,"type":"pass.star', // torn tail
    "garbage", // malformed
    line({ no: "type here" }), // no type: not an event
    "",
  ].join("\n");
  const events = parseEvents(text);
  assert.deepEqual(events.map((event) => event.type), ["phase.started", "pass.started"]);
  assert.equal(events[0].at, "2026-11-11T10:00:00Z");
});

test("two streams merge in order by seq, and without seq by stream order", () => {
  const ts = [line({ seq: 2, type: "pass.started" }), line({ seq: 5, type: "task.done" })].join("\n");
  const bash = [line({ seq: 1, type: "phase.started", phase: 1 }), line({ seq: 4, type: "critic.call" })].join("\n");
  const merged = mergeStreams(parseEvents(ts), parseEvents(bash));
  assert.deepEqual(
    merged.map((event) => event.fields.seq),
    [1, 2, 4, 5],
  );
  const unseqed = mergeStreams(parseEvents(line({ type: "task.done" })), parseEvents(line({ type: "task.done" })));
  assert.equal(unseqed.length, 2);
});

test("the fold fills the RunFacts fields of the activity table", () => {
  const facts = foldStreams(
    [
      line({ seq: 1, type: "run.started", at: "2026-11-11T09:00:00Z" }),
      line({ seq: 2, type: "phase.started", phase: 2, at: "2026-11-11T09:30:00Z" }),
      line({ seq: 3, type: "verification.started", at: "2026-11-11T09:40:00Z" }),
      line({ seq: 4, type: "verdict.recorded", at: "2026-11-11T09:50:00Z" }),
    ].join("\n"),
    "",
  );
  assert.equal(facts.currentPhase, 2);
  assert.equal(facts.activity, "reviewing", "the newest activity event wins");
  assert.equal(facts.lastAt, "2026-11-11T09:50:00Z");
  assert.equal(facts.ended, false);
  assert.equal(facts.done, 0);
});

test("unknown event types leave the state unchanged", () => {
  const known = foldEvents(parseEvents(line({ seq: 1, type: "phase.started", phase: 3, at: "2026-11-11T08:00:00Z" })));
  const events = [
    line({ seq: 2, type: "quantum.collapsed", at: "2099-01-01T00:00:00Z" }),
    line({ seq: 3, type: "agent.whispered", phase: 99, at: "2099-01-02T00:00:00Z" }),
  ];
  const after = foldEvents(parseEvents([line({ seq: 1, type: "phase.started", phase: 3, at: "2026-11-11T08:00:00Z" }), ...events].join("\n")));
  assert.deepEqual(after, known);
  assert.deepEqual(after, { ...emptyFacts(), currentPhase: 3, activity: "proposing", lastAt: "2026-11-11T08:00:00Z" });
});

test("run.ended fills ended, outcome, why and the end lane", () => {
  const ended = foldEvents(
    parseEvents(
      [
        line({ seq: 1, type: "phase.started", phase: 2 }),
        line({ seq: 2, type: "run.ended", outcome: "stopped", why: "stop requested", at: "2026-11-11T11:00:00Z" }),
      ].join("\n"),
    ),
  );
  assert.equal(ended.ended, true);
  assert.equal(ended.outcome, "stopped");
  assert.equal(ended.why, "stop requested");
  assert.equal(ended.endLane, "paused");
  assert.equal(endLaneOf("blocked"), "blocked");
  assert.equal(endLaneOf("failed"), null);
  assert.equal(endLaneOf("completed"), null);
  assert.equal(endLaneOf(null), null);
});

test("error counts and lastAt update correctly", () => {
  const facts = foldEvents(
    parseEvents(
      [
        line({ seq: 1, type: "attempt.failed", why: "the check refused", at: "2026-11-11T10:00:00Z" }),
        line({ seq: 2, type: "run.error", at: "2026-11-11T10:05:00Z" }),
        line({ seq: 3, type: "error", at: "2026-11-11T10:06:00Z" }),
        line({ seq: 4, type: "task.done", at: "2026-11-11T10:07:00Z" }),
        line({ seq: 5, type: "task.done", at: "2026-11-11T10:08:00Z" }),
        line({ seq: 6, type: "task.done", at: "2026-11-11T10:09:00Z" }),
        line({ seq: 7, type: "job.started", at: "2026-11-11T10:10:00Z" }),
      ].join("\n"),
    ),
  );
  assert.equal(facts.errors, 3);
  assert.equal(facts.done, 3);
  assert.equal(facts.lastAt, "2026-11-11T10:10:00Z");
  assert.equal(facts.activity, "verifying");
  assert.equal(facts.why, "the check refused");
});

test("the activity is a NAME; no lane is assigned here", () => {
  for (const [type, name] of Object.entries(ACTIVITY_TABLE)) {
    const facts = foldEvents(parseEvents(line({ seq: 1, type })));
    assert.equal(facts.activity, name, type);
  }
  // The names are activity names from the table, never a lane record.
  const facts = foldEvents(parseEvents(line({ seq: 1, type: "blocked" })));
  assert.equal(facts.activity, "blocked");
  assert.equal(Object.hasOwn(facts, "lane"), false);
});

test("the bash stream alone folds too", () => {
  const facts = foldStreams("", [line({ seq: 1, type: "yield.started" }), line({ seq: 2, type: "yield.ended" })].join("\n"));
  assert.equal(facts.activity, "proposing", "the newest known event wins");
  assert.equal(facts.lastAt, null, "no at field: no lastAt");
});
