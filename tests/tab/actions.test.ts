/**
 * The consented-action tests (T071; PT-151-026; spec.md US5, F151-FR-026,
 * F151-SC-004). With `specstride.kanban.actions` off there is no button in
 * the board tree and the POST `action` route answers 404 (which reads as
 * unavailable to a caller) with 0 CLI calls; with it on, a click without
 * confirmation sends nothing, a confirmed click sends exactly one of
 * `stop`, `stop --now`, `resume` through 150's shim to the stub CLI and its
 * output is shown verbatim as text, and an unknown verb gets 400 with no
 * CLI call. Every verb goes through the real shim (`bin/specstride-hermes.mjs`),
 * whose `--protocol` probe the stub tags `probe: true` — never counted as a
 * verb (F151-FR-051).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tabAction, type HandlerDeps } from "../../src/tab/handler.ts";
import { boardOf, type BoardUi } from "../../src/tab/client/board-model.ts";
import { boardTreeOf } from "../../src/tab/client/board-tree.ts";
import type { ElementNode, VNode } from "../../src/tab/client/tree.ts";
import type { AcceptedView } from "../../src/kanban/view-read.ts";
import { issueToken } from "../../src/tab/token.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const STUB_CLI = join(ROOT, "tests", "stubs", "specstride");
const STOP_OUTPUT = "run stop requested (signal sent)\n";
const RESUME_OUTPUT = "run resumed\n";

/** One accepted view: one engine card on `proposing`. */
function view(): AcceptedView {
  return {
    source: "engine",
    view: {
      schema: "specstride.view/1",
      runId: "run-stop-1",
      state: "running",
      cards: [{ id: "c1", lane: "proposing", feature: "151-x", phase: 1 }],
      attention: [],
      budget: [],
      phases: [],
      featureDetails: {},
    },
  } as unknown as AcceptedView;
}

/** The element-tree walker: every node carrying `name` as an attribute. */
function nodesNamed(node: VNode, name: string): ElementNode[] {
  if (typeof node === "string") return [];
  const out: ElementNode[] = [];
  if (node.attrs[name] !== undefined) out.push(node);
  for (const child of node.children) out.push(...nodesNamed(child, name));
  return out;
}

function texts(node: VNode): string[] {
  if (typeof node === "string") return [node];
  return node.children.flatMap(texts);
}

/** The fixture: stub CLI + a token bound to the run. */
function fixture(options: { profile?: HandlerDeps["profile"]; script?: Record<string, unknown> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tab-actions-151-"));
  const log = join(root, "stub-log.jsonl");
  const script = join(root, "stub-script.json");
  writeFileSync(log, "");
  writeFileSync(script, JSON.stringify(options.script ?? { stop: { stdout: STOP_OUTPUT.trim(), exit: 0 }, resume: { stdout: "run resumed", exit: 0 } }));
  const previous = { SPECSTRIDE_BIN: process.env.SPECSTRIDE_BIN, STUB_LOG: process.env.STUB_LOG, STUB_SCRIPT: process.env.STUB_SCRIPT };
  process.env.SPECSTRIDE_BIN = STUB_CLI;
  process.env.STUB_LOG = log;
  process.env.STUB_SCRIPT = script;
  const deps: HandlerDeps = {
    profile: options.profile ?? { actions: false },
    memo: new Map<string, number>(),
    views: new Map<string, unknown>(),
    log: () => {},
  };
  const token = issueToken("run-stop-1", { now: () => Date.parse("2026-11-11T12:00:00.000Z") }).value;
  return {
    deps,
    token,
    read(): { probe: boolean; argv: string[] }[] {
      const text = readFileSync(log, "utf8").trim();
      return text === "" ? [] : (JSON.parse(`[${text.split("\n").join(",")}]`) as { probe: boolean; argv: string[] }[]);
    },
    verbs(): string[][] {
      return this.read().filter((line) => !line.probe).map((line) => line.argv);
    },
    cleanup() {
      Object.assign(process.env, previous);
      for (const key of ["SPECSTRIDE_BIN", "STUB_LOG", "STUB_SCRIPT"] as const) {
        if (previous[key] === undefined) delete process.env[key];
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("with actions off there is no button in the tree and the POST route answers 404 with 0 CLI calls", async () => {
  const fx = fixture({ profile: { actions: false } });
  try {
    const tree = boardTreeOf(boardOf(view(), null, { actions: false }));
    assert.equal(nodesNamed(tree, "data-kanban-action").length, 0, "no action button when the switch is off");
    const res = await tabAction({ token: fx.token, verb: "stop", confirm: true }, fx.deps);
    assert.equal(res.status, 404, `the route is not registered with the switch off, got ${String(res.status)}`);
    assert.equal((res.json as { answer?: string }).answer, "action-refused", "a 404 JSON reads as refused/unavailable to a caller");
    assert.equal(fx.read().length, 0, "no CLI call at all (probes included)");
  } finally {
    fx.cleanup();
  }
});

test("with actions on, a click without confirmation sends nothing", async () => {
  const fx = fixture({ profile: { actions: true } });
  try {
    const tree = boardTreeOf(boardOf(view(), null, { actions: true }));
    const buttons = nodesNamed(tree, "data-kanban-action");
    assert.equal(buttons.length, 3, "stop, stop-now and resume exist with the switch on");
    // The click only opens the confirm dialog (client state); the verb is
    // sent only when the dialog's confirm control is activated.
    const pending = boardTreeOf(boardOf(view(), null, { actions: true, pendingVerb: "stop" }));
    assert.equal(nodesNamed(pending, "data-kanban-confirm").length, 1, "the confirm dialog is rendered while pending");
    const res = await tabAction({ token: fx.token, verb: "stop" }, fx.deps);
    assert.equal(res.status, 400, "a click without confirmation is refused");
    assert.equal(fx.read().length, 0, "nothing reached the CLI without confirmation (probes included)");
  } finally {
    fx.cleanup();
  }
});

for (const [verb, argv] of [
  ["stop", ["stop"]],
  ["stop-now", ["stop", "--now"]],
  ["resume", ["resume"]],
] as const) {
  test(`a confirmed ${verb} sends exactly one verb through the shim and shows its output verbatim as text`, async () => {
    const fx = fixture({ profile: { actions: true } });
    try {
      const res = await tabAction({ token: fx.token, verb, confirm: true }, fx.deps);
      assert.equal(res.status, 200, `the confirmed ${verb} is accepted`);
      const logged = fx.verbs();
      assert.equal(logged.length, 1, `exactly one CLI call for ${verb}, got ${JSON.stringify(logged)}`);
      assert.deepEqual(logged[0], argv as unknown as string[], `the argv of ${verb} reaches the stub CLI`);
      const body = res.json as { output?: string };
      assert.equal(body.output, verb === "resume" ? RESUME_OUTPUT : STOP_OUTPUT, "the output is carried verbatim");
      // The output is shown verbatim as a text node of the tree.
      const tree = boardTreeOf(boardOf(view(), null, { actions: true, pendingVerb: null, actionOutput: body.output }));
      assert.ok(texts(tree).includes(body.output ?? ""), "the output appears verbatim as text in the tree");
    } finally {
      fx.cleanup();
    }
  });
}

test("an unknown verb gets 400 and no CLI call", async () => {
  const fx = fixture({ profile: { actions: true } });
  try {
    const res = await tabAction({ token: fx.token, verb: "delete-run", confirm: true }, fx.deps);
    assert.equal(res.status, 400, "a verb outside the closed set is refused");
    assert.equal(fx.read().length, 0, "no CLI call for an unknown verb (probes included)");
  } finally {
    fx.cleanup();
  }
});

test("a request without the run-bound token is 401 before any CLI call", async () => {
  const fx = fixture({ profile: { actions: true } });
  try {
    const res = await tabAction({ verb: "stop", confirm: true }, fx.deps);
    assert.equal(res.status, 401);
    assert.equal(fx.read().length, 0);
  } finally {
    fx.cleanup();
  }
});
