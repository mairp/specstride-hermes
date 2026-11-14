/**
 * The foreign-write tests (T072; PT-151-027, PT-151-028; F151-SC-003;
 * contracts/sync-sidecar.md "Foreign writes"). The stub executor reports a
 * projected card in another column (each of `ready`, `review`, `todo`,
 * `running`, `triage`), with another assignee, or with an edited title: the
 * foreign write is found by comparing `kanban show --json` with the stored
 * state; the column and both guards are restored within one cycle (also
 * when the change signature is unchanged — the read-back runs at least
 * every 60 s); a human-edited title or body is never overwritten and gets
 * the one stale comment; every call is a `hermes … kanban …` verb — no
 * engine verb is ever in the log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncOnce, workspaceKey, type SyncDeps } from "../../src/kanban/sync.ts";
import { ProjectionStore } from "../../src/kanban/store.ts";
import type { ShimAnswer } from "../../src/kanban/shim-call.ts";
import type { KanbanCall } from "../../src/kanban/hermes-kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STALE_COMMENT = "stale — edited outside Specstride; column kept in sync";

/** A reader view with one feature's run and its stage card. */
function readerView(opts: { lastAt?: string | null } = {}): Record<string, unknown> {
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: "workspace:w",
    state: "running",
    cards: [{ id: "151-hermes-kanban#1", lane: "proposing", rule: "W1", ruleId: "W-proposing", title: "Projection" }],
    attention: [],
    budget: [],
    phases: [],
    featureDetails: {
      "151-hermes-kanban": { run: { id: "run-r1", state: "running", phase: 1, lastAt: opts.lastAt ?? "2026-11-11T12:00:00.000Z" } },
    },
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: "reader" },
  };
}

interface Call0 {
  verb: string;
  key: string;
  argv: readonly string[];
  stdin: string;
}

/** The harness: the board state the stub `hermes` reports for `show`. */
function harness(initialBoard: { column?: string; assignee?: string; tenant?: string; title?: string; body?: string } = {}) {
  const hermesHome = mkdtempSync(join(tmpdir(), "restore-test-"));
  const executed: Call0[] = [];
  let nextId = 1;
  let board = initialBoard;
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    engine: async (): Promise<ShimAnswer> => ({ kind: "unavailable", reason: "engine exit 70" }),
    reader: () => readerView(),
    exec: async (call: KanbanCall) => {
      executed.push({ verb: call.argv[4] ?? "", key: call.key ?? "", argv: call.argv, stdin: call.stdin });
      if (call.argv[4] === "show") {
        const shown: Record<string, unknown> = {
          id: call.argv[5],
          column: board.column ?? "scheduled",
          assignee: board.assignee ?? "specstride-projection",
          tenant: board.tenant ?? "specstride",
        };
        // The title/body the board reports are omitted unless the test
        // saltes them, so only the salted field is ever foreign.
        if (board.title !== undefined) shown.title = board.title;
        if (board.body !== undefined) shown.body = board.body;
        return { exit: 0, stdout: JSON.stringify(shown), stderr: "" };
      }
      return { exit: 0, stdout: JSON.stringify({ id: `hermes-${nextId++}` }) + "\n", stderr: "" };
    },
    log: () => {},
  };
  return {
    deps,
    executed,
    hermesHome,
    setBoard(next: typeof initialBoard) {
      board = next;
    },
    cleanup: () => rmSync(hermesHome, { recursive: true, force: true }),
  };
}

/** Cycle 1 projects the cards; cycle 2 reads back the foreign board state. */
async function projectThenReadBack(h: ReturnType<typeof harness>, board: Parameters<typeof harness>[0], now = 2_000_000) {
  const first = await syncOnce("/ws", h.deps);
  assert.equal(first.kind, "view");
  h.executed.length = 0;
  h.setBoard(board);
  return syncOnce("/ws", { ...h.deps, reader: () => readerView(), memo: new Map(), now: () => now });
}

test("a card dragged into each foreign column is restored within one cycle (PT-151-027)", async () => {
  for (const column of ["ready", "review", "todo", "running", "triage"]) {
    const h = harness();
    try {
      const second = await projectThenReadBack(h, { column });
      assert.equal(second.kind, "view");
      const restores = h.executed.filter((call) => call.verb === "schedule");
      // The stub reports the drag for every projected card, so both are
      // restored; the stage card's restore must be among them.
      assert.equal(restores.length, 2, `the foreign column ${column} is restored: ${JSON.stringify(h.executed.map((c) => `${c.verb}:${c.key}`))}`);
      assert.ok(restores.some((call) => call.key === "specstride:run-r1:151-hermes-kanban#1"), "the stage card is restored");
      const store = new ProjectionStore(h.hermesHome);
      const record = store.load(workspaceKey("/ws"));
      const card = record.cards.find((card) => card.key === "specstride:run-r1:151-hermes-kanban#1");
      assert.equal(card?.column, "scheduled", "the stored column is the mapped one again");
      assert.equal(card?.humanEdited, false, "a column drag is not a text edit");
      // No engine verb anywhere in the log.
      for (const call of h.executed) {
        assert.equal(call.argv[0], "hermes");
        assert.equal(call.argv[4] === "status", false, `no engine verb in the log: ${call.argv.join(" ")}`);
      }
    } finally {
      h.cleanup();
    }
  }
});

test("a foreign assignee and tenant are restored (guard A, PT-151-027)", async () => {
  const h = harness();
  try {
    const second = await projectThenReadBack(h, { assignee: "alice", tenant: "other" });
    assert.equal(second.kind, "view");
    const restores = h.executed.filter((call) => call.verb === "schedule");
    assert.equal(restores.length, 2, `both cards are restored: ${JSON.stringify(h.executed.map((c) => `${c.verb}:${c.key}`))}`);
    const store = new ProjectionStore(h.hermesHome);
    const record = store.load(workspaceKey("/ws"));
    for (const card of record.cards) {
      assert.equal(card.assignee, "specstride-projection", card.key);
      assert.equal(card.tenant, "specstride", card.key);
    }
  } finally {
    h.cleanup();
  }
});

test("an edited title is never overwritten and gets the one stale comment (PT-151-028)", async () => {
  const h = harness();
  try {
    const second = await projectThenReadBack(h, { title: "my own name for this card" });
    assert.equal(second.kind, "view");
    const comments = h.executed.filter((call) => call.verb === "comment");
    // One comment per projected card whose text the board reports foreign.
    assert.equal(comments.length, 2, `one stale comment per card: ${JSON.stringify(h.executed.map((c) => `${c.verb}:${c.key}`))}`);
    for (const comment of comments) {
      assert.ok(comment.argv.includes(STALE_COMMENT), "the comment carries the contract text verbatim");
    }
    assert.ok(comments.some((call) => call.key === "specstride:run-r1:151-hermes-kanban#1"), "the stage card got its comment");
    assert.ok(h.executed.every((call) => call.verb !== "edit"), "the human title is not overwritten by an edit");
    const store = new ProjectionStore(h.hermesHome);
    const record = store.load(workspaceKey("/ws"));
    const card = record.cards.find((card) => card.key === "specstride:run-r1:151-hermes-kanban#1");
    assert.equal(card?.humanEdited, true, "the card is marked human-edited in the store");

    // A later live-fact change must NOT edit that card's text any more.
    h.executed.length = 0;
    const third = await syncOnce("/ws", {
      ...h.deps,
      reader: () => readerView({ lastAt: "2026-11-11T13:00:00.000Z" }),
      memo: new Map(),
      now: () => 3_000_000,
    });
    assert.equal(third.kind, "view");
    assert.ok(
      h.executed.every((call) => call.key !== "specstride:run-r1:151-hermes-kanban#1" || call.verb === "show"),
      `no write to the human-edited card: ${JSON.stringify(h.executed.map((c) => `${c.verb}:${c.key}`))}`,
    );
    const record3 = new ProjectionStore(h.hermesHome).load(workspaceKey("/ws"));
    assert.equal(record3.cards.find((card) => card.key === "specstride:run-r1:151-hermes-kanban#1")?.humanEdited, true);
  } finally {
    h.cleanup();
  }
});

test("the foreign write is restored even when the change signature is unchanged (PT-151-028)", async () => {
  const h = harness();
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    // The identical view one hour later: the signature is equal, the
    // read-back is due (the 60 s window has passed) and finds the drag.
    h.setBoard({ column: "running" });
    const second = await syncOnce("/ws", { ...h.deps, reader: () => readerView(), memo: new Map(), now: () => 1_000_000 + 3_600_000 });
    assert.equal(second.kind, "view");
    assert.ok(h.executed.some((call) => call.verb === "schedule" && call.key === "specstride:run-r1:151-hermes-kanban#1"), JSON.stringify(h.executed.map((c) => c.verb)));
  } finally {
    h.cleanup();
  }
});

test("an unchanged signature inside the 60 s read-back window makes no call at all", async () => {
  const h = harness();
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    const second = await syncOnce("/ws", { ...h.deps, reader: () => readerView(), memo: new Map() });
    assert.equal(second.shortCircuit, true, "the unchanged view inside the window short-circuits");
    assert.deepEqual(h.executed, [], "0 hermes calls inside the read-back window");
  } finally {
    h.cleanup();
  }
});

test("no engine verb ever reaches the executor over the whole restore story", async () => {
  const h = harness();
  try {
    await projectThenReadBack(h, { column: "triage" });
    for (const call of h.executed) {
      assert.equal(call.argv[0], "hermes");
      assert.equal(call.argv[1], "-p");
      assert.equal(call.argv[2], "specstride");
      assert.equal(call.argv[3], "kanban");
      assert.ok(
        ["show", "create", "schedule", "edit", "complete", "archive", "promote", "block", "comment", "list"].includes(call.verb),
        `a kanban verb only: ${call.argv.join(" ")}`,
      );
    }
    assert.equal(h.executed.some((call) => ["stop", "resume", "status", "wait"].includes(call.verb)), false, "no engine verb");
  } finally {
    h.cleanup();
  }
});
