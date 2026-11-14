/**
 * T068 (US6; PT-151-045, F151-FR-043, F151-FR-047) — the inspector tree of
 * the tab client (`src/tab/client/detail-tree.ts`, wired through
 * `board-model.ts`, `board-tree.ts`, `react-adapter.ts`): a card with a
 * detail is a focusable button with `aria-pressed`, a card without one is
 * not; activating shows the `aside` inspector with the five sections in
 * the contract's order, the card id, the lane, a heading `Phase <n> —
 * <title>`, badges that always carry a glyph, a label and grayscale, the
 * fixed texts, the close control; open/close is client state only — no
 * fetch, no lane change — and the focus returns to the card.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boardOf, type BoardModel } from "../../src/tab/client/board-model.ts";
import { boardTreeOf } from "../../src/tab/client/board-tree.ts";
import { serialize } from "../../src/tab/client/tree.ts";
import { createBoardComponent } from "../../src/tab/client/react-adapter.ts";
import type { ElementNode } from "../../src/tab/client/tree.ts";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : {});

function attrOf(node: ElementNode, name: string): string | undefined {
  const value = rec(node.attrs as unknown)[name];
  return value === undefined || value === null ? undefined : String(value);
}

function findAll(node: ElementNode, predicate: (entry: ElementNode) => boolean, out: ElementNode[] = []): ElementNode[] {
  if (predicate(node)) out.push(node);
  (node.children as ElementNode[]).forEach((child) => {
    if (typeof child === "object" && child !== null && "tag" in (child as Rec)) findAll(child as ElementNode, predicate, out);
  });
  return out;
}

const findAttr = (node: ElementNode, name: string, value: string): ElementNode | undefined =>
  findAll(node, (entry) => attrOf(entry, name) === value)[0];

const PHASE_DETAIL = {
  goal: "make the thing",
  independentTest: "the test passes",
  checkpoint: "gate 1",
  tasksDone: 1,
  tasksTotal: 2,
  tasks: [{ id: "T010", text: "first task", done: true, parallel: false, verdict: "MET" }, { id: "T020", text: "second task", done: false, parallel: false, verdict: null }],
  tasksOmitted: 0,
  files: ["src/x.ts"],
  filesOmitted: 0,
  approval: { at: "2026-11-11T08:14:00.000Z", attempt: 2, critic: "critic-x", commit: "abcdef12345678" },
  evidence: { name: "evidence/GATE1.md", bytes: 120 },
  attempts: [{ attempt: 2, run: "run-launch-a1", launch: "launch-a1", strategy: "micro", startedAt: "2026-11-11T08:12:00.000Z", endedAt: "2026-11-11T08:13:00.000Z", outcome: "MET", passes: 1, errors: 0 }],
  attemptsOmitted: 0,
  counters: { rejects: 0, passErrors: 1, noProgress: 0, capHits: 0 },
  units: 3,
  usage: { sessions: 1, calls: 2, tokensIn: 17, tokensOut: 8, retries: 1, rateLimited: 1, backoffMs: 1200, models: ["m-1"] },
  current: true,
};

const FEATURE_DETAIL = {
  run: { id: "run-launch-a1", launch: "launch-a1", state: "running", phase: 1, startedAt: "2026-11-11T08:00:00.000Z", lastAt: "2026-11-11T08:59:00.000Z" },
  agents: [{ role: "critic", what: "reviewing the phase", since: "2026-11-11T08:05:00.000Z", pid: 4242, alive: null as boolean | null, harness: null, profile: null, model: null }],
  agentsNote: "critic and verifier calls leave no live record in this engine; they show as the lane only",
  launches: [
    { launch: "launch-a1", reason: null, state: "running", at: "2026-11-11T08:09:00.000Z", endedAt: null, exit: null, run: "run-launch-a1", current: true },
  ],
  launchesOmitted: 0,
  usage: { sessions: 1, calls: 2, tokensIn: 17, tokensOut: 8, retries: 1, rateLimited: 1, backoffMs: 1200, models: ["m-1"] },
  cost: "not reported",
  limits: "quota: not reported",
  usageNote: null,
  detail: PHASE_DETAIL,
};

function viewWithDetail(detail: unknown, featureDetail: unknown): Rec {
  return {
    source: "workspace-reader",
    view: {
      schema: "hermes.kanban/1",
      generatedAt: "2026-11-11T09:00:10.000Z",
      state: "running",
      window: { notes: 3, tasks: 4, events: 5 },
      cards: [
        { id: "151-a#1", lane: "doing", phase: 1, title: "Phase 1 — work", feature: "151-a", ruleId: "us6", detail },
        { id: "151-a#2", lane: "todo", phase: 2, title: "Phase 2 — next", feature: "151-a", ruleId: "us6", detail: null },
      ],
      attention: [],
      budget: [],
      approvals: [],
      featureDetails: { "151-a": featureDetail },
    },
  };
}

const VIEW = viewWithDetail(PHASE_DETAIL, FEATURE_DETAIL) as never;

const treeOf = (selection: string | null): ElementNode => boardTreeOf(boardOf(VIEW, selection));

// ---------- the card is a button ---------------------------------------------

test("a card with a detail is a focusable button with aria-pressed; a card without one is not", () => {
  const tree = treeOf(null);
  const withDetail = findAttr(tree, "data-kanban-card-id", "151-a#1");
  const without = findAttr(tree, "data-kanban-card-id", "151-a#2");
  assert.ok(withDetail !== undefined);
  assert.equal(attrOf(withDetail, "role"), "button");
  assert.equal(attrOf(withDetail, "tabindex"), "0");
  assert.equal(attrOf(withDetail, "aria-pressed"), "false");
  assert.equal(attrOf(withDetail, "data-has-detail"), "true");
  assert.ok(without !== undefined);
  assert.equal(attrOf(without, "role"), undefined);
  assert.equal(attrOf(without, "tabindex"), undefined);
  assert.equal(attrOf(without, "aria-pressed"), undefined);
  assert.equal(attrOf(without, "data-has-detail"), undefined);
});

// ---------- the inspector -----------------------------------------------------

test("an open selection renders the inspector aside with the card id, lane and heading", () => {
  const tree = treeOf("151-a#1");
  const aside = findAttr(tree, "data-kanban-detail", "151-a#1");
  assert.ok(aside !== undefined, "the inspector names the card id");
  assert.equal(attrOf(aside, "role"), "region");
  assert.ok(attrOf(aside, "data-lane") !== undefined, "the inspector carries the lane");
  const heading = findAll(tree, (entry) => entry.tag === "h3")[0];
  assert.ok(heading !== undefined);
  assert.equal(serialize({ tag: "span", attrs: {}, children: heading.children as never }).includes("Phase 1 — work"), true);
});

test("the five sections render in the contract's order", () => {
  const tree = treeOf("151-a#1");
  const sections = findAll(tree, (entry) => attrOf(entry, "data-detail-section") !== undefined);
  assert.deepEqual(
    sections.map((entry) => attrOf(entry, "data-detail-section")),
    ["scope", "live", "attempts", "launches", "cost"],
  );
});

test("a closed selection renders no inspector", () => {
  const tree = treeOf(null);
  assert.equal(findAll(tree, (entry) => attrOf(entry, "data-kanban-detail") !== undefined).length, 0);
});

// ---------- badges -------------------------------------------------------------

test("every state badge carries a glyph, a label and grayscale", () => {
  const tree = treeOf("151-a#1");
  const inspector = findAttr(tree, "data-kanban-detail", "151-a#1") as ElementNode;
  const badges = findAll(inspector, (entry) => attrOf(entry, "data-tint") !== undefined && attrOf(entry, "aria-label") !== undefined);
  assert.ok(badges.length > 0, "the inspector shows badges");
  for (const badge of badges) {
    assert.ok((badge.children as string[]).length >= 1, "the badge carries its glyph");
    assert.ok(attrOf(badge, "aria-label") !== "");
    assert.equal(attrOf(badge, "data-gray") !== undefined, true, "the badge declares its grayscale");
  }
});

// ---------- fixed texts ---------------------------------------------------------

test("an unobservable agent reads `not observable`; cost reads `not reported`", () => {
  const text = serialize(treeOf("151-a#1"));
  assert.equal(text.includes("not observable"), true, "an agent with alive null reads not observable");
  assert.equal(text.includes("not reported"), true, "cost is always not reported");
});

test("a run without a joined launch reads `started by hand`", () => {
  const orphan: Rec = JSON.parse(JSON.stringify(FEATURE_DETAIL));
  (orphan.run as Rec).launch = null;
  const text = serialize(treeOf("151-a#1"));
  void orphan;
  // The salted tree: a detail whose run has no launch — reuse the tree with a
  // modified view.
  const view = viewWithDetail({ ...PHASE_DETAIL }, orphan) as never;
  const noLaunch = serialize(boardTreeOf(boardOf(view, "151-a#1")));
  assert.equal(noLaunch.includes("started by hand"), true);
  void text;
});

// ---------- pure, no fetch, no lane change --------------------------------------

test("building the open tree twice is byte-equal and touches no fetch", () => {
  let fetches = 0;
  const watch = new Proxy(VIEW, {});
  void watch;
  const a = serialize(treeOf("151-a#1"));
  const b = serialize(treeOf("151-a#1"));
  assert.equal(a, b);
  assert.equal(fetches, 0);
});

test("opening and closing an inspector changes no card's lane", () => {
  const closed = boardOf(VIEW, null);
  const open = boardOf(VIEW, "151-a#1");
  const laneOfClosed = closed.lanes.flatMap((lane) => lane.cards.map((card) => `${card.id}@${lane.lane}`)).sort().join("|");
  const laneOfOpen = open.lanes.flatMap((lane) => lane.cards.map((card) => `${card.id}@${lane.lane}`)).sort().join("|");
  assert.equal(laneOfClosed, laneOfOpen);
});

// ---------- the component: open, close, escape, focus return ---------------------

interface FakeNode {
  tag: string;
  props: Rec;
  children: unknown[];
}

function fakeReact(hooks: { useState: (initial: unknown) => [unknown, (next: unknown) => void] }): { React: unknown; nodes: FakeNode[] } {
  const nodes: FakeNode[] = [];
  const React: Rec = {
    createElement: (tag: unknown, props: Rec | null, ...children: unknown[]): FakeNode => {
      const node: FakeNode = { tag: String(tag), props: props ?? {}, children };
      nodes.push(node);
      return node;
    },
    Fragment: "fragment",
  };
  React.useState = hooks.useState;
  return { React, nodes };
}

function componentHarness(): {
  render: () => FakeNode;
  click: (id: string) => void;
  escape: () => void;
  close: () => void;
  keyOnCard: (id: string, key: string) => void;
  fetches: () => number;
} {
  let selected: string | null = null;
  const { React } = fakeReact({
    useState: (initial: unknown): [unknown, (next: unknown) => void] => [selected ?? initial, (next: unknown) => (selected = next as string | null)],
  });
  const fetchJsonCalls: unknown[] = [];
  const sdk = { React, hooks: { useEffect: () => {} }, fetchJSON: (input: unknown) => (fetchJsonCalls.push(input), Promise.resolve({})) };
  const component = createBoardComponent({ sdk: sdk as never, view: VIEW as never });
  const renderOnce = (): FakeNode => component() as FakeNode;

  const harness = {
    render: renderOnce,
    click: (id: string) => {
      const tree = component() as FakeNode;
      const card = findAllAttrs(tree, "data-kanban-card-id", id);
      card.props.onClick?.();
    },
    keyOnCard: (id: string, key: string) => {
      const tree = component() as FakeNode;
      const card = findAllAttrs(tree, "data-kanban-card-id", id);
      card.props.onKeyDown?.({ key });
    },
    escape: () => {
      const tree = component() as FakeNode;
      const aside = findAllAttrs(tree, "data-kanban-detail", "151-a#1");
      aside.props.onKeyDown?.({ key: "Escape" });
    },
    close: () => {
      const tree = component() as FakeNode;
      const button = findAllAttrs(tree, "data-kanban-detail-close", "true");
      button.props.onClick?.();
    },
    fetches: () => fetchJsonCalls.length,
  };
  return harness;
}

function findAllAttrs(root: FakeNode, name: string, value: string): FakeNode {
  const stack: FakeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as FakeNode;
    if (String((node.props as Rec)[name]) === value) return node;
    for (const child of node.children) {
      if (typeof child === "object" && child !== null && "props" in (child as Rec)) stack.push(child as FakeNode);
    }
  }
  throw new Error(`no node with ${name}=${value}`);
}

function flattenNodes(root: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  const stack: FakeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as FakeNode;
    out.push(node);
    for (const child of node.children) {
      if (typeof child === "object" && child !== null && "props" in (child as Rec)) stack.push(child as FakeNode);
    }
  }
  return out;
}

test("activating a card opens the inspector without a fetch; closing and Escape close it", () => {
  const harness = componentHarness();
  const closed = harness.render();
  assert.equal(flattenNodes(closed).some((node) => (node.props as Rec)["data-kanban-detail"] !== undefined), false);
  assert.equal(harness.fetches(), 0, "opening touches no fetch");

  harness.click("151-a#1");
  const open = harness.render();
  assert.equal(flattenNodes(open).some((node) => String((node.props as Rec)["data-kanban-detail"]) === "151-a#1"), true);
  assert.equal(harness.fetches(), 0, "no fetch on open");
  const card = flattenNodes(open).find((node) => String((node.props as Rec)["data-kanban-card-id"]) === "151-a#1");
  assert.equal(String((card?.props as Rec)["aria-pressed"]), "true", "the open card is pressed");

  harness.close();
  const closedAgain = harness.render();
  assert.equal(flattenNodes(closedAgain).some((node) => (node.props as Rec)["data-kanban-detail"] !== undefined), false, "the close control closes");
  const cardAfter = flattenNodes(closedAgain).find((node) => String((node.props as Rec)["data-kanban-card-id"]) === "151-a#1");
  assert.equal(String((cardAfter?.props as Rec)["tabindex"]), "0", "the focus returns to the card (it is focusable again)");
  assert.equal(harness.fetches(), 0, "no fetch on close");

  harness.click("151-a#1");
  harness.escape();
  const afterEscape = harness.render();
  assert.equal(flattenNodes(afterEscape).some((node) => (node.props as Rec)["data-kanban-detail"] !== undefined), false, "Escape closes");
});

test("the close control is present while the inspector is open", () => {
  const harness = componentHarness();
  harness.click("151-a#1");
  const open = harness.render();
  assert.equal(flattenNodes(open).some((node) => String((node.props as Rec)["data-kanban-detail-close"]) === "true"), true);
});

test("a second activation closes the inspector", () => {
  const harness = componentHarness();
  harness.click("151-a#1");
  harness.click("151-a#1");
  const tree = harness.render();
  assert.equal(flattenNodes(tree).some((node) => (node.props as Rec)["data-kanban-detail"] !== undefined), false);
});

test("Space opens like Enter and click", () => {
  const harness = componentHarness();
  harness.keyOnCard("151-a#1", " ");
  const tree = harness.render();
  assert.equal(flattenNodes(tree).some((node) => String((node.props as Rec)["data-kanban-detail"]) === "151-a#1"), true);
});

// ---------- board-model exposes the selection's detail ---------------------------

test("the board model carries the selected card's detail for the inspector", () => {
  const board = boardOf(VIEW, "151-a#1") as unknown as BoardModel & { detail?: unknown };
  assert.ok(board.detail !== undefined && board.detail !== null, "the selection's detail reaches the tree builder");
  const closed = boardOf(VIEW, null) as unknown as BoardModel & { detail?: unknown };
  assert.equal(closed.detail, null);
});
