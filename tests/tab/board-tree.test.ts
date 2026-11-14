/**
 * T048 (US4) — the board element-tree layer: the root child order of
 * contracts/151-hermes-kanban/tab-manifest.md, asserted against pure nodes
 * via `serialize` (never React). The board-model and board-tree
 * implementations come in a later unit; until then the stubs throw
 * "US4 not implemented" and these tests are the redline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptKnownView, type AcceptedView } from "../../src/kanban/view-read.ts";
import { serialize, type ElementNode, type VNode } from "../../src/tab/client/tree.ts";
import { boardOf } from "../../src/tab/client/board-model.ts";
import { boardTreeOf } from "../../src/tab/client/board-tree.ts";

// ---------- deterministic view builders (no fixtures, no clock, no I/O) ----

function card(id: string, lane: string, phase: number, feature = "151-hermes-kanban") {
  return { id, feature, phase, lane, ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } };
}

function baseView(): Record<string, unknown> {
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
    cards: [] as unknown[],
    lanes: [] as unknown[],
    laneTable: { id: "kanban", version: "v1" },
    attention: [] as unknown[],
    attentionOmitted: 0,
    budget: [] as unknown[],
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

function accepted(raw: Record<string, unknown>): AcceptedView {
  const view = acceptKnownView(raw);
  assert.equal(view.ok, true, "the test view must be accepted by acceptKnownView");
  return view;
}

// ---------- tree helpers ---------------------------------------------------

function findAll(root: VNode, predicate: (n: ElementNode) => boolean): ElementNode[] {
  const out: ElementNode[] = [];
  const stack: VNode[] = [root];
  while (stack.length > 0) {
    const node = stack.shift() as VNode;
    if (typeof node === "string") continue;
    if (predicate(node)) out.push(node);
    stack.push(...node.children);
  }
  return out;
}

// ---------- tests ----------------------------------------------------------

describe("T048 board tree root order", () => {
  it("renders the root's children in the manifest order: banners, source line, markers, strip, attention, budget, approvals, body", () => {
    const raw = baseView();
    raw.cards = [card("c-1", "queued", 1)];
    raw.lanes = [{ lane: "queued", cards: ["c-1"] }];
    raw.attention = [{ kind: "stale-card", since: "2026-11-11T12:00:00.000Z", text: "card is old" }];
    raw.budget = [{ scope: "run", level: "comfortable", quota: 42 }];
    raw.phases = [{ number: 1, title: "Setup", evidence: true, approved: false, feedback: false }];
    const tree = boardTreeOf(boardOf(accepted(raw), null));
    assert.equal(typeof tree, "object", "boardTreeOf must return an element node");
    const banners = (tree as ElementNode).children.filter(
      (child) => typeof child !== "string" && (child as ElementNode).attrs["role"] === "status",
    );
    assert.ok(banners.length >= 1, "the banners must come first among the root's children, as direct children with role=status");
    assert.equal(
      (tree as ElementNode).children.indexOf(banners[0] as VNode),
      0,
      "the first child of the root must be a banner (the conditions render before everything else)",
    );
    const bodies = findAll(tree, (n) => "data-body" in n.attrs);
    assert.equal(bodies.length, 1, "the tree must hold exactly one body element");
    assert.equal(
      (tree as ElementNode).children.indexOf(bodies[0] as VNode),
      (tree as ElementNode).children.length - 1,
      "the body must be the last child of the root, after the run strip, attention, budget and approvals",
    );
    const serialized = serialize(tree as VNode);
    assert.ok(serialized.includes("card is old"), "the attention text must render verbatim");
    assert.ok(serialized.includes("comfortable"), "the budget level must render");
    assert.ok(serialized.includes("Setup"), "the per-phase approvals must render the phase titles");
  });

  it("renders no source line node for an engine view", () => {
    const raw = baseView();
    raw.cards = [card("c-1", "queued", 1)];
    raw.lanes = [{ lane: "queued", cards: ["c-1"] }];
    const tree = boardTreeOf(boardOf(accepted(raw), null));
    const sources = findAll(tree, (n) => "data-view-source" in n.attrs);
    assert.deepEqual(sources, [], "an engine view must render no data-view-source node");
    assert.ok(!serialize(tree as VNode).includes("quota: not reported"), "an engine view must show no 'quota: not reported' line");
  });
});
