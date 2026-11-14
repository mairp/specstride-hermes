/**
 * T049 (US4) — the direction B layout of the board tree, against pure nodes via
 * `serialize` (never React). The board-model and board-tree implementations
 * come in a later unit; until then the stubs throw "US4 not implemented" and
 * these tests are the redline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptKnownView, type AcceptedView } from "../../src/kanban/view-read.ts";
import { closedSetLanes } from "../../src/kanban/generated/closed-sets.ts";
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
    progress: { phase: 1, phases: 2, phaseAttempt: 1, pass: 0, rejects: 0, malformed: 0, units: { done: 0, declared: 0 }, elapsedSeconds: 0 },
    strategy: { strategy: null, microLevel: 0, layerOffReason: null },
    phases: [
      { number: 1, title: "Setup", evidence: true, approved: true, feedback: false },
      { number: 2, title: null, evidence: false, approved: false, feedback: false },
    ],
    cards: [] as unknown[],
    lanes: [] as unknown[],
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

/** A view with two filled lanes (queued ×2, approved ×1), the rest empty. */
function directionBView(): Record<string, unknown> {
  const raw = baseView();
  raw.cards = [
    card("c-a1", "queued", 1),
    card("c-a2", "queued", 2),
    card("c-a3", "approved", 2),
  ];
  raw.lanes = [
    { lane: "queued", cards: ["c-a1", "c-a2"] },
    { lane: "approved", cards: ["c-a3"] },
  ];
  raw.featureDetails = {
    "151-hermes-kanban": {
      run: { id: "run-1", state: "running", phase: 3, lastAt: "2026-11-11T12:00:00.000Z" },
    },
  };
  return raw;
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

function textOf(node: ElementNode): string {
  let out = "";
  walk(node, (n) => {
    if (typeof n === "string") out += n;
  });
  return out;
}

// ---------- tests ----------------------------------------------------------

describe("T049 direction B board tree", () => {
  it("renders one chip per lane with glyph, label and count, and a count in every lane header", () => {
    const board = boardOf(accepted(directionBView()), null);
    const strip = board.strip;
    assert.ok(strip, "the run strip (data-summary) must be built for a board that is not windowed");
    assert.equal((strip as ElementNode).attrs["data-summary"], "", "the strip node must carry data-summary");
    const tree = serialize(strip as ElementNode);
    for (const lane of closedSetLanes) {
      const chip = findAll(strip as ElementNode, (n) => n.attrs["data-tint"] === lane && n.attrs["data-empty"] === (lane === "queued" || lane === "approved" ? undefined : "true"));
      assert.ok(chip.length === 1, `the strip must hold exactly one chip for lane ${lane}`);
      assert.ok((chip[0] as ElementNode).attrs["aria-label"], `the chip for lane ${lane} must carry the label`);
      assert.ok(/\d/.test(textOf(chip[0] as ElementNode)), `the chip for lane ${lane} must show its card count`);
    }
    const body = boardTreeOf(board);
    for (const lane of closedSetLanes) {
      const column = findByAttr(body, "data-lane", lane);
      assert.ok(column, `lane ${lane} must render a column`);
      assert.ok(/\d/.test(textOf(column as ElementNode).split("")[0]) || /\b\d+\b/.test(textOf(column as ElementNode)), `the lane header of ${lane} must carry its count`);
    }
    assert.ok(tree.includes("2"), "the queued lane count 2 must appear in the strip");
  });

  it("renders '<X> of <N> approved' per feature row", () => {
    const board = boardOf(accepted(directionBView()), null);
    assert.equal(board.features.length, 1, "the view carries one feature, so the strip holds one feature row");
    assert.equal(board.features[0].approved, 1, "the feature's approved count must be the cards in the approved lane");
    assert.equal(board.features[0].cards.length, 3, "the feature row must hold all three cards of the view");
    const tree = serialize(boardTreeOf(board));
    assert.ok(tree.includes("1 of 3 approved"), "the feature row must show '<X> of <N> approved' with X=1 and N=3");
  });

  it("renders one track segment per card in phase order, tinted by card.lane", () => {
    const board = boardOf(accepted(directionBView()), null);
    const tree = boardTreeOf(board);
    const tracks = findAll(tree, (n) => n.attrs["aria-hidden"] === "true" || n.attrs["data-track"] !== undefined);
    assert.ok(tracks.length >= 1, "each feature row must carry a track holding the card segments");
    const segments = findAll(tracks[0] as ElementNode, (n) => n.attrs["data-tint"] !== undefined);
    assert.equal(segments.length, 3, "the track must hold one segment per card of the feature");
    const tints = segments.map((s) => s.attrs["data-tint"]);
    assert.deepEqual(
      tints,
      ["queued", "queued", "approved"],
      "the segments must follow the cards in phase order, tinted by card.lane with data-tint",
    );
  });

  it("renders the run line when the view's featureDetails carries a run", () => {
    const board = boardOf(accepted(directionBView()), null);
    assert.ok(board.features[0].run, "the feature row must carry the run record from featureDetails[feature].run");
    const tree = serialize(boardTreeOf(board));
    assert.ok(
      tree.includes("run-1 · running · phase 3 · last event 2026-11-11T12:00:00.000Z"),
      "the run line '<run id> · <state> · phase <n> · last event <time>' must render verbatim",
    );
    const bare = baseView();
    bare.cards = [card("c-a1", "queued", 1)];
    bare.lanes = [{ lane: "queued", cards: ["c-a1"] }];
    const noRun = serialize(boardTreeOf(boardOf(accepted(bare), null)));
    assert.ok(!noRun.includes("last event"), "a feature with no run record must render no run line");
  });

  it("marks an empty lane adjacent to a filled one with data-empty, and folds no lane on an empty board", () => {
    const tree = boardTreeOf(boardOf(accepted(directionBView()), null));
    const blocked = findByAttr(tree, "data-lane", "blocked");
    assert.ok(blocked, "the empty blocked lane must still render as a column beside the filled lanes");
    assert.equal((blocked as ElementNode).attrs["data-empty"], "true", "the empty blocked lane must carry data-empty=\"true\"");
    const queued = findByAttr(tree, "data-lane", "queued");
    assert.equal((queued as ElementNode).attrs["data-empty"], undefined, "a filled lane must not carry data-empty");

    const empty = baseView();
    const emptyBoard = boardOf(accepted(empty), null);
    assert.equal(emptyBoard.windowed, false, "a board with no card is never windowed");
    const emptyTree = boardTreeOf(emptyBoard);
    const folded = findAll(emptyTree, (n) => n.attrs["data-empty"] === "true");
    assert.deepEqual(folded, [], "when the board holds no card, no lane may fold (no data-empty anywhere)");
    const columns = findAll(emptyTree, (n) => typeof n.attrs["data-lane"] === "string");
    assert.equal(columns.length, closedSetLanes.length, "every canonical lane must render as a column on an empty board");
  });

  it("renders a titled phase card as a phase token plus a title span carrying the full line", () => {
    const tree = boardTreeOf(boardOf(accepted(directionBView()), null));
    const tokens = findAll(tree, (n) => n.attrs["data-card-part"] === "phase");
    assert.ok(tokens.length >= 1, "a titled phase card must render a phase token with data-card-part=phase");
    const titles = findAll(tree, (n) => n.attrs["data-card-part"] === "title");
    assert.ok(titles.length >= 1, "a titled phase card must render a title span with data-card-part=title");
    const titled = titles.find((n) => n.attrs["title"] !== undefined);
    assert.ok(titled, "the title span must carry a title attribute");
    assert.equal(
      (titled as ElementNode).attrs["title"],
      "phase 1 — Setup",
      "the title attribute must hold the full line 'phase <n> — <title>'",
    );
    const untitled = baseView();
    untitled.cards = [card("c-a1", "queued", 2)];
    untitled.lanes = [{ lane: "queued", cards: ["c-a1"] }];
    const untitledTree = serialize(boardTreeOf(boardOf(accepted(untitled), null)));
    assert.ok(!untitledTree.includes("data-card-part"), "a card whose phase has no title must render no phase/title parts");
  });

  it("keeps the inspector a sibling of the lanes inside the body and banners direct children of the root", () => {
    const board = boardOf(accepted(directionBView()), null);
    const tree = boardTreeOf(board);
    const bodies = findAll(tree, (n) => "data-body" in n.attrs);
    assert.equal(bodies.length, 1, "the tree must hold exactly one body element");
    const body = bodies[0] as ElementNode;
    const lanes = findAll(body, (n) => "data-lanes" in n.attrs);
    const inspector = findAll(body, (n) => "data-inspector" in n.attrs);
    assert.equal(lanes.length, 1, "the body must hold exactly one lanes container");
    assert.equal(inspector.length, 1, "the body must hold exactly one inspector container");
    assert.deepEqual(
      (body as ElementNode).children.includes(lanes[0] as VNode) && (body as ElementNode).children.includes(inspector[0] as VNode),
      true,
      "the lanes container and the inspector must be siblings, both direct children of the body",
    );
    const banners = findAll(tree, (n) => n.attrs["role"] === "status");
    assert.ok(banners.length >= 1, "the condition banners must render with role=status");
    for (const banner of banners) {
      assert.ok(
        (tree as ElementNode).children.includes(banner as VNode),
        "every banner must be a direct child of the board root",
      );
    }
  });

  it("omits the data-summary strip while a lane is windowed", () => {
    const raw = baseView();
    const ids: string[] = [];
    for (let i = 0; i < 101; i++) {
      const id = `c-bulk-${i}`;
      ids.push(id);
      raw.cards.push(card(id, "queued", 1));
    }
    raw.lanes = closedSetLanes.map((lane) => ({ lane, cards: lane === "queued" ? ids : [] }));
    const board = boardOf(accepted(raw), null);
    assert.equal(board.windowed, true, "a lane above the window threshold of 100 must make the board windowed");
    const tree = boardTreeOf(board);
    const strips = findAll(tree, (n) => "data-summary" in n.attrs);
    assert.deepEqual(strips, [], "no data-summary node may render while a lane is windowed");
    assert.equal(board.strip, null, "the board model must hold no strip while a lane is windowed");
  });
});
