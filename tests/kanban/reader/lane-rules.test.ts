/**
 * T021 — the lane rules (US7, F151-FR-038, F151-FR-049).
 *
 * The ordered table W0–W4 of the closed set, first match wins, rule id
 * `W-<lane>`; this file (src/kanban/reader/lanes.ts) is the only place a
 * lane is assigned. A never-started feature gets one card; a voided
 * approval is no approval; a live run's current phase beats everything.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readTree, readFixture } from "../../helpers/reader-harness.ts";
import { LANE_RULES, liveLaneOf } from "../../../src/kanban/reader/lanes.ts";
import { closedSetLaneRules, closedSetLiveLanes } from "../../../src/kanban/generated/closed-sets.ts";

const NOW = "2026-11-11T09:00:10Z";

test("the rule table is the closed set, in its order", () => {
  assert.deepEqual(LANE_RULES.map((row) => row.rule), ["W0", "W1", "W2", "W3", "W4"]);
  const members = closedSetLaneRules.members as { rule: string; lane: string; when: string }[];
  assert.deepEqual(
    LANE_RULES.map((row, index) => ({ rule: row.rule, when: row.when, lane: row.lane === "the run's live lane (kanban-reader-live-lanes), proposing when it has none" ? "<live>" : row.lane === "the end lane (kanban-reader-end-rules)" ? "<end>" : row.lane })),
    members.map((member) => ({ rule: member.rule, when: member.when, lane: member.lane === "the run's live lane (kanban-reader-live-lanes), proposing when it has none" ? "<live>" : member.lane === "the end lane (kanban-reader-end-rules)" ? "<end>" : member.lane })),
  );
});

test("liveLaneOf maps the closed activity names and nothing else", () => {
  for (const lane of closedSetLiveLanes.members as string[]) assert.equal(liveLaneOf(lane), lane);
  assert.equal(liveLaneOf(null), "proposing");
  assert.equal(liveLaneOf("unknown-activity"), "proposing");
});

test("W0: a never-started feature gets one card, not one per phase", () => {
  const { view } = readTree(
    {
      "specs/151-fresh/tasks.md": "# 151-fresh\n\n## Phase 1: first\n- [ ] T1 open\n\n## Phase 2: second\n- [ ] T2 open\n\n",
      ".specstride/workspace.json": JSON.stringify({ schema: "specstride.layout/1", workspaceId: "lanerules0000001" }) + "\n",
    },
    { now: NOW },
  );
  assert.deepEqual(
    view.cards.map((card) => ({ id: card.id, lane: card.lane, ruleId: card.ruleId, title: card.title })),
    [{ id: "151-fresh#queued", lane: "queued", ruleId: "W-queued", title: "not started (2 phases)" }],
  );
  assert.equal(view.state, "idle");
});

test("W1: a live run's current phase sits on its activity lane, ahead of any approval", () => {
  const { view } = readFixture("voided-approval", { now: NOW, processes: [{ pid: 4240, starttime: 4200000 }] });
  const current = view.cards.find((card) => card.id === "151-voided#2");
  assert.ok(current);
  assert.equal(current.lane, "proposing", "the live lane wins over the phase's approval record");
  assert.equal(current.ruleId, "W-proposing");
  assert.equal(current.flags.stale, false, "a fresh event is not stale");
  assert.equal(view.state, "running");
});

test("a voided approval is no approval: the earlier phase falls to W4", () => {
  const { view } = readFixture("voided-approval", { now: NOW, processes: [{ pid: 4240, starttime: 4200000 }] });
  const earlier = view.cards.find((card) => card.id === "151-voided#1");
  assert.ok(earlier);
  assert.equal(earlier.lane, "queued", "the voided approval does not pin approved");
  assert.equal(earlier.ruleId, "W-queued");
});

test("W2: an approval record pins approved", () => {
  const { view } = readFixture("relaunch", { now: NOW, processes: [{ pid: 4200, starttime: 4200000 }] });
  const first = view.cards.find((card) => card.id === "151-relaunch#1");
  assert.ok(first);
  assert.equal(first.lane, "approved");
  assert.equal(first.ruleId, "W-approved");
});

test("W3: the end lane of the ended run's current phase", () => {
  const { view } = readFixture("engine-died", { now: NOW });
  const current = view.cards.find((card) => card.id === "151-dead#1");
  assert.ok(current);
  assert.equal(current.lane, "failed");
  assert.equal(current.ruleId, "W-failed");
});

test("W4: otherwise queued", () => {
  const { view } = readFixture("signalled", { now: NOW });
  const later = view.cards.find((card) => card.id === "151-signal#2");
  assert.ok(later);
  assert.equal(later.lane, "queued");
  assert.equal(later.ruleId, "W-queued");
});

test("a stale live run flags its card", () => {
  const { view } = readFixture("voided-approval", { now: "2026-11-11T11:00:00Z", processes: [{ pid: 4240, starttime: 4200000 }] });
  const current = view.cards.find((card) => card.id === "151-voided#2");
  assert.ok(current);
  assert.equal(current.flags.stale, true, "no event for more than two hours: stale");
});

test("a workspace with no features at all has no cards and no state", () => {
  const { view } = readTree(
    { ".specstride/workspace.json": JSON.stringify({ schema: "specstride.layout/1", workspaceId: "lanerules0000001" }) + "\n" },
    { now: NOW },
  );
  assert.deepEqual(view.cards, []);
  assert.deepEqual(view.attention, []);
  assert.equal(view.state, "none");
  assert.deepEqual(view.budget, []);
  assert.deepEqual(view.phases, []);
});
