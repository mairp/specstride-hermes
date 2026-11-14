/**
 * The attention tests (T044, T045, T046; PT-151-014, PT-151-015, PT-151-016,
 * PT-151-017, PT-151-037; spec.md US3; contracts/card-projection.md
 * "Attention card"). One `blocked` card per attention item, keyed
 * `specstride:<run-id>:attn:<item-id>`, written through the real verb
 * surface `create` → `promote` → `block --kind needs_input <text verbatim>`;
 * blocked exactly once, never unblocked; archived when the item clears; a
 * recurring item is a new card. The reader's one item for an ended run is
 * projected the same way (F151-FR-037). The projector sends no Telegram
 * message itself (F151-FR-017) and the doctor's `host.kanban-plugin` line
 * says whether `notify-subscribe` can deliver for the non-profile assignee —
 * `unknown` until U-151-05 settles — pointing at 150's notifier (F151-FR-016).
 *
 * No model call: the engine seam is a stub answer, the verb executor is a
 * recording stub, the reader views come from the committed fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptView, acceptKnownView, type AcceptedView } from "../../src/kanban/view-read.ts";
import { attentionCardsOf, projectAll } from "../../src/kanban/project.ts";
import { planVerbs, type StoredCard } from "../../src/kanban/diff.ts";
import { syncOnce, workspaceKey, type SyncDeps } from "../../src/kanban/sync.ts";
import { ProjectionStore } from "../../src/kanban/store.ts";
import { readFixture } from "../helpers/reader-harness.ts";
import { tempHome, withStubs } from "../helpers/env.ts";
import { collectFindings } from "../../src/doctor.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/run-views");
const HOST_VERSION = "0.0.0";

/** An engine view (the every-lane fixture) with the given attention items. */
function engineView(attention: unknown[]): AcceptedView {
  const raw = JSON.parse(readFileSync(join(FIXTURES, "every-lane.json"), "utf8")) as Record<string, unknown>;
  raw.attention = attention;
  const accepted = acceptView(raw);
  if (!accepted.ok) throw new Error(`the engine fixture was refused: ${accepted.reason}`);
  return accepted;
}

/** A valid engine attention item (schema `specstride.view/1`, attentionItem). */
function engineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "blocked-on-human",
    key: "gate-1",
    since: "2026-11-11T12:00:00.000Z",
    oneLine: VERBATIM,
    need: "approve the phase gate",
    next: "specstride status",
    fields: {},
    ...overrides,
  };
}

/** A reader raw view (the sync seam's shape) with cards, a run and attention items. */
function readerRaw(opts: {
  runId: string;
  state?: string;
  attention?: Record<string, unknown>[];
  feature?: string;
}): Record<string, unknown> {
  const feature = opts.feature ?? "151-hermes-kanban";
  return {
    schema: "specstride.view/1",
    source: "workspace-reader",
    laneTable: { id: "workspace-reader", version: "1" },
    runId: "workspace:w",
    state: "running",
    cards: [{ id: `${feature}#1`, lane: "proposing", rule: "W1", ruleId: "W-proposing", title: "Phase 1" }],
    attention: opts.attention ?? [],
    budget: [],
    phases: [],
    featureDetails: { [feature]: { run: { id: opts.runId, launch: null, state: opts.state ?? "running", phase: 1, lastAt: null } } },
    cursor: { offset: 0, lastSeq: 0 },
    signature: { token: `reader-${opts.runId}` },
  };
}

/** The exact text `block` must carry, verbatim (F151-FR-014). */
const VERBATIM = "151-hermes-kanban: run ended failed in phase 2 — the launch vanished";

const ITEM: Record<string, unknown> = {
  kind: "blocked-on-human",
  key: "151-hermes-kanban#run",
  since: "2026-11-11T12:00:00.000Z",
  oneLine: "151-hermes-kanban: run ended failed in phase 2 — the launch vanished",
  need: "read the run log, fix the cause, then relaunch",
  next: "relaunch",
  fields: {},
};

interface Executed {
  readonly verb: string;
  readonly key: string;
  readonly argv: readonly string[];
}

/** The sync harness: a temporary HERMES_HOME, a recording executor, a stub engine. */
function harness(reader: () => Record<string, unknown> | null) {
  const hermesHome = mkdtempSync(join(tmpdir(), "attn-test-"));
  const executed: Executed[] = [];
  let nextId = 1;
  const deps: SyncDeps = {
    hermesHome,
    now: () => 1_000_000,
    engine: async () => ({ kind: "unavailable", reason: "engine exit 70 (stub)" }),
    reader,
    readBack: false,
    exec: async (call) => {
      executed.push({ verb: call.argv[4] ?? "", key: call.key ?? "", argv: call.argv });
      return { exit: 0, stdout: JSON.stringify({ id: `hermes-${nextId++}` }) + "\n", stderr: "" };
    },
    log: () => {},
  };
  return {
    deps,
    executed,
    hermesHome,
    record: () => new ProjectionStore(hermesHome).load(workspaceKey("/ws")),
    cleanup: () => rmSync(hermesHome, { recursive: true, force: true }),
  };
}

const verbsOf = (executed: readonly Executed[]) => executed.map((call) => call.verb);
const ATTN_KEY = "specstride:run-attn:attn:151-hermes-kanban#run";

/* ---- T044: PT-151-014, PT-151-015 — the sequence, once-only block, archive, recurrence ---- */

test("a new attention card is create → promote → block --kind needs_input <text verbatim> (engine view, PT-151-014)", () => {
  const view = engineView([engineItem()]);
  const attn = attentionCardsOf(view, { hostVersion: HOST_VERSION });
  assert.equal(attn.length, 1);
  assert.equal(attn[0].key, "specstride:run-launch-recorded:attn:gate-1");
  assert.equal(attn[0].role, "attention");
  assert.equal(attn[0].column, "blocked");
  assert.equal(attn[0].engineValue, "blocked-on-human", "the kind is carried verbatim");

  const verbs = planVerbs({ wanted: projectAll(view, { hostVersion: HOST_VERSION }), stored: [] });
  const attnVerbs = verbs.filter((verb) => verb.key === "specstride:run-launch-recorded:attn:gate-1");
  assert.deepEqual(attnVerbs.map((verb) => verb.verb), ["create", "promote", "block"]);
  const block = attnVerbs[2];
  assert.deepEqual(block.blockText, VERBATIM);
  // The argv shape is asserted on the real builder, not re-derived here.
  const blockArgv = attnVerbs.map((verb) => verb.verb);
  assert.ok(!blockArgv.includes("schedule"), "an attention card is never scheduled: it belongs in blocked");
});

test("a full cycle writes create → promote → block with the verbatim argv (PT-151-014)", async () => {
  const h = harness(() => readerRaw({ runId: "run-attn", attention: [ITEM] }));
  try {
    const result = await syncOnce("/ws", h.deps);
    assert.equal(result.kind, "view");
    assert.equal(result.ok, true);
    assert.deepEqual(
      h.executed.filter((call) => call.key === ATTN_KEY).map((call) => call.verb),
      ["create", "promote", "block"],
      JSON.stringify(h.executed.map((call) => `${call.verb}:${call.key}`)),
    );
    const block = h.executed.find((call) => call.verb === "block");
    assert.ok(block);
    const at = block.argv.indexOf("--kind");
    assert.notEqual(at, -1, "the block argv carries --kind");
    assert.equal(block.argv[at + 1], "needs_input", "block kind needs_input");
    assert.equal(block.argv[at + 2], VERBATIM, "the engine's text travels verbatim");
  } finally {
    h.cleanup();
  }
});

test("an unchanged view, then a live-fact change: the block happens exactly once (PT-151-014, PT-151-040)", async () => {
  const view = readerRaw({ runId: "run-attn", attention: [ITEM] });
  const h = harness(() => view);
  try {
    await syncOnce("/ws", h.deps);
    // An unchanged signature → no verbs at all.
    h.executed.length = 0;
    const same = await syncOnce("/ws", { ...h.deps, memo: new Map() });
    assert.equal(same.shortCircuit, true);
    assert.deepEqual(h.executed, []);
    // A live fact changed with no attention change → an edit of the root only,
    // never a second block or a promote (P00 P2-2: a re-block routes to triage).
    h.executed.length = 0;
    const changed = readerRaw({ runId: "run-attn", state: "running" });
    (changed.featureDetails as Record<string, unknown>)["151-hermes-kanban"] = {
      run: { id: "run-attn", launch: null, state: "running", phase: 1, lastAt: "2026-11-11T13:00:00.000Z" },
    };
    await syncOnce("/ws", { ...h.deps, reader: () => changed, memo: new Map() });
    assert.ok(!verbsOf(h.executed).includes("block"), JSON.stringify(verbsOf(h.executed)));
    assert.ok(!verbsOf(h.executed).includes("promote"));
    assert.ok(!verbsOf(h.executed).includes("create"));
  } finally {
    h.cleanup();
  }
});

test("the stored attention card is never blocked again, even after a foreign-column restore (PT-151-014)", () => {
  const view = engineView([engineItem()]);
  const wanted = projectAll(view, { hostVersion: HOST_VERSION });
  const attn = wanted.find((card) => card.role === "attention");
  assert.ok(attn);
  const stored: StoredCard[] = [
    { key: attn.key, hermesId: "hermes-7", column: "blocked", title: attn.title, body: attn.body, assignee: attn.assignee, tenant: attn.tenant, humanEdited: false },
  ];
  // Same view again (as after a restart with the store): no block verb.
  const verbs = planVerbs({ wanted, stored });
  const attnVerbs = verbs.filter((verb) => verb.key === attn.key);
  assert.deepEqual(attnVerbs.map((verb) => verb.verb), [], JSON.stringify(attnVerbs.map((v) => v.verb)));
  assert.ok(!verbs.some((verb) => verb.verb === "block" || verb.verb === "promote"));
  // The projector never unblocks: no such verb exists anywhere in the plan.
  for (const verb of verbs) assert.ok(!/unblock/i.test(verb.verb), verb.verb);
});

test("when the item clears, the attention card is archived — never deleted, never unblocked (PT-151-015)", async () => {
  const h = harness(() => readerRaw({ runId: "run-attn", attention: [ITEM] }));
  try {
    await syncOnce("/ws", h.deps);
    h.executed.length = 0;
    const cleared = await syncOnce("/ws", { ...h.deps, reader: () => readerRaw({ runId: "run-attn" }), memo: new Map() });
    assert.equal(cleared.kind, "view");
    assert.deepEqual(
      h.executed.filter((call) => call.key === ATTN_KEY).map((call) => call.verb),
      ["archive"],
      JSON.stringify(h.executed.map((call) => `${call.verb}:${call.key}`)),
    );
    assert.ok(!verbsOf(h.executed).includes("delete"));
    for (const call of h.executed) assert.ok(!/unblock/i.test(call.verb));
    assert.ok(h.record().cards.every((card) => card.key !== ATTN_KEY), "the store no longer holds the cleared card");
  } finally {
    h.cleanup();
  }
});

test("a recurring item is a new card: create → promote → block again (PT-151-015)", async () => {
  const h = harness(() => readerRaw({ runId: "run-attn", attention: [ITEM] }));
  try {
    await syncOnce("/ws", h.deps);
    await syncOnce("/ws", { ...h.deps, reader: () => readerRaw({ runId: "run-attn" }), memo: new Map() });
    h.executed.length = 0;
    const again = await syncOnce("/ws", { ...h.deps, reader: () => readerRaw({ runId: "run-attn", attention: [ITEM] }), memo: new Map() });
    assert.equal(again.kind, "view");
    assert.deepEqual(
      h.executed.filter((call) => call.key === ATTN_KEY).map((call) => call.verb),
      ["create", "promote", "block"],
    );
  } finally {
    h.cleanup();
  }
});

/* ---- T045: the reader's own attention items (PT-151-014, PT-151-037) ---- */

test("over the vanished fixture: exactly one attention card, the reader's line verbatim, marked reader-sourced", () => {
  const { view } = readFixture("vanished", { now: "2026-11-11T09:00:10Z", processes: [] });
  assert.equal(view.attention.length, 1);
  const accepted = acceptKnownView(view as unknown as Record<string, unknown>);
  assert.ok(accepted.ok);
  const runId = (accepted.featureDetails?.["151-vanish"] as { run?: { id?: string } } | undefined)?.run?.id ?? "";
  assert.notEqual(runId, "");
  const attn = attentionCardsOf(accepted, { hostVersion: HOST_VERSION });
  assert.equal(attn.length, 1);
  const [card] = attn;
  assert.equal(card.key, `specstride:${runId}:attn:151-vanish#run`);
  assert.equal(card.column, "blocked");
  assert.equal(card.source, "workspace-reader");
  assert.ok(card.body.includes(`text: ${view.attention[0].oneLine}`), card.body);
  assert.ok(card.body.includes("source: workspace-reader"), card.body);
  assert.equal(card.attentionText, view.attention[0].oneLine, "the block text is the reader's line verbatim");
});

test("over the signalled fixture: no attention card (paused is not blocked-on-human)", () => {
  const { view } = readFixture("signalled", { now: "2026-11-11T09:00:10Z" });
  assert.equal(view.attention.length, 0);
  const accepted = acceptKnownView(view as unknown as Record<string, unknown>);
  assert.ok(accepted.ok);
  assert.equal(attentionCardsOf(accepted, { hostVersion: HOST_VERSION }).length, 0);
});

test("after a relaunch that clears the item, the attention card is archived in one cycle", async () => {
  const vanished = readFixture("vanished", { now: "2026-11-11T09:00:10Z", processes: [] }).view as unknown as Record<string, unknown>;
  const relaunched = readFixture("relaunch", { now: "2026-11-11T09:00:10Z" }).view as unknown as Record<string, unknown>;
  const h = harness(() => vanished);
  try {
    const first = await syncOnce("/ws", h.deps);
    assert.equal(first.kind, "view");
    const attnKey = h.record().cards.find((card) => card.role === "attention")?.key ?? "";
    assert.match(attnKey, /:attn:/);
    h.executed.length = 0;
    const second = await syncOnce("/ws", { ...h.deps, reader: () => relaunched, memo: new Map() });
    assert.equal(second.kind, "view");
    assert.deepEqual(
      h.executed.filter((call) => call.key === attnKey).map((call) => call.verb),
      ["archive"],
    );
    assert.ok(h.record().cards.every((card) => card.role !== "attention"));
  } finally {
    h.cleanup();
  }
});

/* ---- T046: delivery (PT-151-016, PT-151-017) ---- */

test("the projector sends no Telegram message itself: no send/notify verb in the stub log (PT-151-017)", async () => {
  const h = harness(() => readerRaw({ runId: "run-attn", attention: [ITEM] }));
  try {
    await syncOnce("/ws", h.deps);
    await syncOnce("/ws", { ...h.deps, reader: () => readerRaw({ runId: "run-attn" }), memo: new Map() });
    await syncOnce("/ws", { ...h.deps, reader: () => readerRaw({ runId: "run-attn", attention: [ITEM] }), memo: new Map() });
    const allowed = new Set(["create", "show", "list", "schedule", "edit", "complete", "archive", "promote", "block", "comment"]);
    for (const call of h.executed) {
      assert.ok(allowed.has(call.verb), `a verb outside the projection's closed set: ${call.verb}`);
      assert.ok(!/send|telegram|notify/i.test(call.verb), call.verb);
      for (const arg of call.argv) assert.ok(!/^specstride\.notify\./.test(arg), `a notify target in an argv: ${String(arg)}`);
    }
  } finally {
    h.cleanup();
  }
});

test("the doctor's host.kanban-plugin line says whether notify-subscribe delivers for a non-profile assignee (PT-151-016)", async () => {
  const fx = tempHome();
  try {
    await withStubs(fx, async () => {
      process.env.STUB_PLUGINS = JSON.stringify({ plugins: [{ name: "specstride", enabled: true }, { name: "kanban", enabled: true }] });
      try {
        const finding = collectFindings().find((f) => f.id === "host.kanban-plugin");
        assert.ok(finding);
        assert.notEqual(finding.severity, "fail");
        assert.match(finding.message, /notify-subscribe/);
        assert.match(finding.message, /unknown/, "U-151-05 is unsettled: the fact reads unknown, never ok");
        assert.match(finding.message, /U-151-05/);
        assert.match(finding.message, /150/, "the line points to 150's notifier for delivery");
        assert.match(finding.message, /notifier|specstride\.notify\.telegram/);
      } finally {
        delete process.env.STUB_PLUGINS;
      }
    });
  } finally {
    fx.cleanup();
  }
});
