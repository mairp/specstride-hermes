/**
 * T048 (US4) — the element-tree layer of the board, against pure nodes via
 * `serialize` (never React). The board-model and board-tree implementations
 * come in a later unit; until then the stubs throw "US4 not implemented" and
 * these tests are the redline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptKnownView, type AcceptedView } from "../../src/kanban/view-read.ts";
import { closedSetLanes } from "../../src/kanban/generated/closed-sets.ts";
import { serialize, txt, type ElementNode, type VNode } from "../../src/tab/client/tree.ts";
import { boardOf, columnOf } from "../../src/tab/client/board-model.ts";
import { boardTreeOf } from "../../src/tab/client/board-tree.ts";

// ---------- deterministic view builders (no fixtures, no clock, no I/O) ----

function card(id: string, lane: unknown, phase: number | null = 1, feature = "151-hermes-kanban") {
  return { id, feature, phase, lane, ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
}

function baseView(cards: unknown[], lanes: unknown[]): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    now: "2026-11-11T12:00:00.000Z",
    runId: "run-1",
    workspaceId: "w",
    feature: "151-hermes-kanban",
    cursor: { file: "run:1:events", offset: 0, lastSeq: 0 },
    state: "running",
    stateSince: "2026-11-11T12:00:00.000Z",
    transition: null,
    display: "running",
    liveness: "alive",
    conditions: { dead: false, stale: null, launchAbandoned: false },
    launch: { launchId: null, reason: null, outcome: null, engineStartId: null },
    progress: { phase: 1, phases: 1, phaseAttempt: 1, pass: 0, rejects: 0, malformed: 0, units: { done: 0, declared: 0 }, elapsedSeconds: 0 },
    strategy: { strategy: null, microLevel: 0, layerOffReason: null },
    phases: [{ number: 1, title: "Setup", evidence: false, approved: false, feedback: false }],
    cards,
    lanes,
    laneTable: { id: "kanban", version: "v1" },
    attention: [],
    attentionOmitted: 0,
    budget: [],
    budgetOmitted: 0,
    processes: { holders: [], omitted: 0, cut: 0 },
    supervision: null,
    activity: { latestTool: null, observabilityMode: "off", observabilityReason: null },
    telemetry: [],
    timeline: { rows: [], omitted: 0 },
    parallel: null,
    diagnostics: {
      skippedLines: 0, gaps: [], majorsSeen: [], majorsAccepted: { from: 1, to: 1 },
      majorsOutOfRange: 0, tornLastLine: false, fieldsCut: [], fieldsDropped: [], redactorFailed: false,
    },
    signature: { record: {}, token: "00000000" },
    stream: { first: null, last: null, runStartedAt: null, runEndedAt: null },
    settled: { heartbeatLate: false, staleEventSec: 0 },
  };
}

function simpleView(): Record<string, unknown> {
  return baseView(
    [card("c-queued", "queued"), card("c-approved", "approved")],
    closedSetLanes.map((lane) => ({
      lane,
      cards: lane === "queued" ? ["c-queued"] : lane === "approved" ? ["c-approved"] : [],
    })),
  );
}

function accepted(raw: Record<string, unknown>): AcceptedView {
  const view = acceptKnownView(raw);
  assert.equal(view.ok, true, "the test view must be accepted by acceptKnownView");
  return view;
}

// ---------- tree helpers ---------------------------------------------------

function walk(node: VNode, visit: (n: VNode) => void): void {
  visit(node);
  if (typeof node !== "string") for (const child of node.children) walk(child, visit);
}

function findAll(root: VNode, predicate: (n: ElementNode) => boolean): ElementNode[] {
  const out: ElementNode[] = [];
  walk(root, (n) => {
    if (typeof n !== "string" && predicate(n)) out.push(n);
  });
  return out;
}

function findByAttr(root: VNode, name: string, value: string): ElementNode | undefined {
  return findAll(root, (n) => n.attrs[name] === value)[0];
}

// ---------- tests ----------------------------------------------------------

describe("T048 board element tree", () => {
  it("gives a byte-equal serialization for equal view and equal selection", () => {
    const view = accepted(simpleView());
    const a = serialize(boardTreeOf(boardOf(view, "c-queued")));
    const b = serialize(boardTreeOf(boardOf(view, "c-queued")));
    assert.equal(a, b, "serialize of two boardTreeOf calls over equal inputs must be byte-equal");
    assert.equal(typeof a, "string", "serialize must return a string");
  });

  it("renders the eight lanes in canonical closedSetLanes order, empty lanes as explicit nodes", () => {
    const view = accepted(simpleView());
    const board = boardOf(view, null);
    assert.deepEqual(
      board.lanes.slice(0, closedSetLanes.length).map((l) => l.lane),
      closedSetLanes as unknown[],
      "the first eight board lanes must be closedSetLanes in canonical order",
    );
    const tree = boardTreeOf(board);
    for (const lane of closedSetLanes) {
      const column = findByAttr(tree, "data-lane", lane);
      assert.ok(column, `lane ${lane} must render as an explicit column node even when it holds no card`);
      assert.equal(
        (column as ElementNode).attrs["data-empty"],
        lane === "queued" || lane === "approved" ? undefined : "true",
        `lane ${lane} emptiness flag must follow the cards the view carries`,
      );
    }
  });

  it("renders an unknown lane as a trailing column with glyph '?' and the raw value as label", () => {
    const raw = baseView([card("c-x", "shelved")], []);
    const view = accepted(raw);
    const board = boardOf(view, null);
    assert.ok(
      board.lanes.some((l) => l.lane === "shelved"),
      "an unknown lane value must gain its own board lane",
    );
    assert.equal(board.lanes[board.lanes.length - 1].lane, "shelved", "the unknown lane must be a trailing column after the eight canonical lanes");
    const tree = boardTreeOf(board);
    const column = findByAttr(tree, "data-lane", "shelved");
    assert.ok(column, "the unknown lane must render as a column with data-lane shelved");
    const badge = findAll(column as ElementNode, (n) => n.attrs["aria-label"] === "shelved")[0];
    assert.ok(badge, "the unknown lane header must carry a badge whose aria-label is the raw lane value");
    assert.ok(
      typeof badge === "object" && JSON.stringify(badge).includes('"?"'),
      "the unknown lane badge must show the '?' glyph",
    );
    assert.ok(
      closedSetLanes.every((l) => l !== "shelved"),
      "the unknown lane must not collide with a canonical lane name",
    );
  });

  it("renders an unknown attention kind and budget level as '?' with the raw value as label", () => {
    const raw = baseView([], []);
    raw.attention = [{ kind: "weird-kind", since: "2026-11-11T12:00:00.000Z", text: "check the lease" }];
    raw.budget = [{ scope: "run", level: "weird-level", quota: null }];
    const view = accepted(raw);
    const tree = boardTreeOf(boardOf(view, null));
    const serialized = serialize(tree);
    assert.ok(serialized.includes("?"), "unknown attention kind and budget level must render the '?' glyph as text");
    for (const rawValue of ["weird-kind", "weird-level"]) {
      const badge = findAll(tree, (n) => n.attrs["aria-label"] === rawValue);
      assert.ok(badge.length > 0, `an unknown set member ${rawValue} must keep the raw value as its label`);
    }
  });

  it("derives a card's column from card.lane only, with no remapping", () => {
    assert.equal(columnOf({ lane: "shelved" }), "shelved", "columnOf must return the raw lane value of the card");
    assert.equal(columnOf({ lane: "queued" }), "queued", "columnOf must return the raw lane value of the card");
    assert.equal(columnOf({ lane: "queued" }), columnOf({ lane: "queued" } as { lane: unknown }), "two cards with the same lane value must land in the same column");
  });

  it("carries attention, budget and approvals through exactly as the view holds them", () => {
    const raw = baseView([], []);
    raw.attention = [{ kind: "stale-card", since: "2026-11-11T12:00:00.000Z", text: "card is old" }];
    raw.budget = [{ scope: "run", level: "comfortable", quota: 42 }];
    const phases = [
      { number: 1, title: "Setup", evidence: true, approved: true, feedback: false },
      { number: 2, title: null, evidence: false, approved: false, feedback: true },
    ];
    raw.phases = phases;
    const view = accepted(raw);
    const board = boardOf(view, null);
    assert.deepEqual(board.attention, view.view.attention, "board attention must be the view's attention unchanged");
    assert.deepEqual(board.budget, view.view.budget, "board budget must be the view's budget unchanged");
    assert.deepEqual(board.approvals, phases, "board approvals must be the view's phases[] unchanged");
  });

  it("shows the source line and 'quota: not reported' for a workspace-reader view", () => {
    const raw = baseView([card("c-x", "queued")], [{ lane: "queued", cards: ["c-x"] }]);
    raw.source = "workspace-reader";
    const tree = boardTreeOf(boardOf(accepted(raw), null));
    const serialized = serialize(tree);
    assert.ok(findAll(tree, (n) => "data-view-source" in n.attrs).length > 0, "a reader view must render the source line node with data-view-source");
    assert.ok(
      serialized.includes("View from workspace files (the engine&#x27;s view is absent or empty)") ||
        serialized.includes("View from workspace files (the engine's view is absent or empty)"),
      "the source line must carry the exact reader-view text",
    );
    assert.ok(serialized.includes("quota: not reported"), "a reader view must show the 'quota: not reported' line");
  });

  it("never renders a string as markup: text is escaped and no node carries an html sink", () => {
    const raw = baseView([card("c-x", "queued")], [{ lane: "queued", cards: ["c-x"] }]);
    raw.phases = [{ number: 1, title: "<b>bold</b> & \"quoted\"", evidence: false, approved: false, feedback: false }];
    const tree = boardTreeOf(boardOf(accepted(raw), null));
    const serialized = serialize(tree);
    assert.ok(txt("<b>&") === "&lt;b&gt;&amp;", "txt must escape markup characters in text nodes");
    assert.ok(!serialized.includes("<b>bold</b>"), "a hostile title must never appear unescaped in the serialization");
    assert.ok(serialized.includes("&lt;b&gt;bold&lt;/b&gt;"), "the hostile title must appear escaped in the serialization");
    assert.ok(serialized.includes("&amp;"), "the ampersand must be escaped in the serialization");
    const sinks = findAll(tree, (n) => "html" in n.attrs || "innerHTML" in n.attrs || "dangerouslySetInnerHTML" in n.attrs);
    assert.deepEqual(sinks, [], "no node of the tree may carry an html/innerHTML sink attribute");
    walk(tree, (n) => {
      if (typeof n !== "string") {
        for (const value of Object.values(n.attrs)) {
          assert.ok(
            typeof value === "string" || typeof value === "number" || typeof value === "boolean",
            `attribute values must be AttrValue scalars, saw ${typeof value}`,
          );
        }
        for (const child of n.children) {
          assert.ok(typeof child !== "object" || Array.isArray((child as ElementNode).children), "element children must be text nodes or element nodes");
        }
      }
    });
  });
});
