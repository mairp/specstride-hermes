/**
 * Phase 4 (US1 — Projection) case generator — model-free. Covers the pure
 * core: F151-FR-001/002/004 (root and stage cards), FR-005 (backoff and
 * flags), FR-006/007/033/039/042 (the view source), FR-008/041 (signature and
 * card volume), FR-012/029 (the diff verbs and an unknown state), FR-040
 * (the change signature).
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineView, engineCard, readerRunView, readerCard, wantedCard } from "./views.ts";

export interface EvalCase {
  id: string;
  fr: string;
  kind: "positive" | "negative" | "edge";
  call: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  personRun?: boolean;
}

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 4);
  const noise = Math.floor(rand() * 1000); // stable across seeds' runs; feeds an inert input field
  const failures = [1, 2, 4, 12];
  const backoff = failures.map((n) => Math.min(5000 * 2 ** (n - 1), 300000));

  const wantedStage = wantedCard({
    key: "specstride:run-p4:151-x#1",
    role: "stage",
    column: "scheduled",
    title: "phase 1",
    body: "rule: W2 (W-verifying)\nprojected-by: specstride-host-hermes 0.0.0",
    label: "verifying",
  });

  const wantedAttn = wantedCard({
    key: "specstride:run-p4:attn:i9",
    role: "attention",
    column: "blocked",
    title: "needs input",
    label: "needs_input",
    attentionText: "needs_input: the checkpoint asks a question",
  });

  return [
    {
      id: "p04-c01",
      fr: "F151-FR-001",
      kind: "positive",
      call: "project.rootCardsOf",
      input: { fixture: "every-lane.json", hostVersion: "0.0.0", noise },
      expect: {
        count: 1,
        key: "specstride:run-launch-recorded",
        role: "root",
        source: "engine",
        rule: null,
        column: "scheduled",
        label: "running",
        unknown: false,
        title: "[running] 151-hermes-kanban · run-launch-recorded",
        body: [
          "engine-state: running",
          "display: running",
          "phase: 1/9 pass 0 rejects 0",
          "conditions: dead=false stale=false launch-abandoned=false",
          "status: /specstride status",
          "projected-by: specstride-host-hermes 0.0.0",
        ].join("\n"),
        attentionText: null,
        tenant: "specstride",
        assignee: "specstride-projection",
      },
    },
    {
      id: "p04-c02",
      fr: "F151-FR-029",
      kind: "edge",
      call: "project.rootCardsOf",
      input: {
        view: { ...(engineView("running", [engineCard("c1", "queued")]) as Record<string, unknown>), state: "crashed-hard", source: "workspace-reader", laneTable: { id: "workspace-reader", version: "1" }, featureDetails: { "151-hermes-kanban": { run: { id: "run-reader-crash", launch: null, state: "crashed-hard", phase: 1, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" } } } },
        hostVersion: "0.0.0",
      },
      expect: { count: 1, column: "scheduled", label: "?crashed-hard", unknown: true, title: "[?crashed-hard] 151-hermes-kanban · run-reader-crash" },
    },
    {
      id: "p04-c03",
      fr: "F151-FR-002",
      kind: "positive",
      call: "project.projectAll",
      input: {
        view: readerRunView({
          cards: [
            { ...readerCard("151-x#1", "verifying"), title: "phase 2", rule: "W2" },
            { ...readerCard("151-x#2", "approved"), title: "phase 1", rule: "W-approved" },
          ],
          runs: { "151-x": { id: "run-all-x", state: "running", phase: 2, lastAt: "2026-11-11T12:00:00.000Z" } },
        }),
        hostVersion: "0.0.0",
      },
      expect: {
        rootKeys: ["specstride:run-all-x"],
        stageKeys: ["specstride:run-all-x:151-x#1", "specstride:run-all-x:151-x#2"],
        attentionKeys: [],
        columns: ["scheduled", "scheduled", "done"],
      },
    },
    {
      id: "p04-c04",
      fr: "F151-FR-041",
      kind: "edge",
      call: "project.stageCardsOf",
      input: {
        view: readerRunView({
          cards: [{ ...readerCard("151-z#0", "queued"), title: "never ran", rule: "W0" }],
          runs: { "151-z": null },
        }),
        hostVersion: "0.0.0",
      },
      expect: { count: 0, noCardForNeverRun: true },
    },
    {
      id: "p04-c05",
      fr: "F151-FR-005",
      kind: "positive",
      call: "sync.backoffMs",
      input: { failures },
      expect: { backoff },
    },
    {
      id: "p04-c06",
      fr: "F151-FR-005",
      kind: "negative",
      call: "sync.parseFlags",
      input: { argv: ["--bogus"] },
      expect: { usageError: "unknown flag: --bogus" },
    },
    {
      id: "p04-c07",
      fr: "F151-FR-005",
      kind: "edge",
      call: "sync.parseFlags",
      input: { argv: ["--workspace"] },
      expect: { usageError: "--workspace needs a directory" },
    },
    {
      id: "p04-c08",
      fr: "F151-FR-012",
      kind: "positive",
      call: "diff.planVerbs",
      input: {
        wanted: [wantedStage],
        stored: [],
        actual: null,
        foreignText: true,
      },
      expect: {
        verbs: [
          { verb: "create", key: "specstride:run-p4:151-x#1", id: null },
          { verb: "schedule", key: "specstride:run-p4:151-x#1", id: null },
        ],
      },
    },
    {
      id: "p04-c09",
      fr: "F151-FR-033",
      kind: "positive",
      call: "diff.planVerbs",
      input: {
        wanted: [wantedStage],
        stored: [{ key: "specstride:run-p4:151-x#1", hermesId: "h-stg-1", column: "todo", title: "phase 1", body: "old", assignee: "specstride-projection", tenant: "specstride", humanEdited: false }],
        actual: { "specstride:run-p4:151-x#1": { hermesId: "h-stg-1", column: "todo", assignee: "someone-else", tenant: "other" } },
        foreignText: true,
      },
      expect: {
        verbs: [
          { verb: "schedule", key: "specstride:run-p4:151-x#1", id: "h-stg-1" },
          { verb: "edit", key: "specstride:run-p4:151-x#1", id: "h-stg-1" },
        ],
        blockText: null,
        commentText: null,
      },
    },
    {
      id: "p04-c10",
      fr: "F151-FR-033",
      kind: "edge",
      call: "diff.planVerbs",
      input: {
        wanted: [],
        stored: [{ key: "specstride:run-p4:151-x#1", hermesId: "h-stg-1", column: "scheduled", title: "phase 1", body: "old", assignee: "specstride-projection", tenant: "specstride", humanEdited: true }],
        actual: null,
        foreignText: true,
      },
      expect: {
        verbs: [{ verb: "archive", key: "specstride:run-p4:151-x#1", id: "h-stg-1" }],
        blockText: null,
        commentText: null,
      },
    },
    {
      id: "p04-c11",
      fr: "F151-FR-029",
      kind: "positive",
      call: "diff.planVerbs",
      input: {
        wanted: [wantedAttn],
        stored: [],
        actual: null,
        foreignText: true,
      },
      expect: {
        verbs: [
          { verb: "create", key: "specstride:run-p4:attn:i9", id: null },
          { verb: "promote", key: "specstride:run-p4:attn:i9", id: null },
          { verb: "block", key: "specstride:run-p4:attn:i9", id: null },
        ],
        blockText: null,
        commentText: null,
      },
    },
    {
      id: "p04-c12",
      fr: "F151-FR-040",
      kind: "positive",
      call: "signature.changeSignature",
      input: { view: engineView("stopped", []) },
      expect: { engineToken: "00000000", engineVerbatim: true, readerRecomputes: true },
    },
    {
      id: "p04-c13",
      fr: "F151-FR-008",
      kind: "positive",
      call: "signature.computeSignature",
      input: {
        views: [
          readerRunView({ cards: [{ ...readerCard("a#1", "queued") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerRunView({ cards: [{ ...readerCard("a#1", "queued") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerRunView({ cards: [{ ...readerCard("a#1", "approved") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
        ],
      },
      expect: { same: true, differ: true, hex: true },
    },
    {
      id: "p04-c14",
      fr: "F151-FR-006",
      kind: "positive",
      call: "viewSource.viewOf",
      input: {
        depsSpec: {
          engine: { kind: "view", view: engineView("running", [engineCard("c1", "queued")]) },
          reader: readerRunView({ cards: [{ ...readerCard("a#1", "queued") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerOn: true,
        },
      },
      expect: { kind: "view", source: "engine", engineCalls: 1, readerCalls: 0, memoHolds: false },
    },
    {
      id: "p04-c15",
      fr: "F151-FR-033",
      kind: "edge",
      call: "viewSource.viewOf",
      input: {
        depsSpec: {
          engine: { kind: "unavailable", reason: "no stub" },
          reader: readerRunView({ cards: [{ ...readerCard("a#1", "approved") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerOn: true,
        },
      },
      expect: { kind: "view", source: "workspace-reader", engineCalls: 1, readerCalls: 1, memoHolds: false },
    },
    {
      id: "p04-c16",
      fr: "F151-FR-042",
      kind: "negative",
      call: "viewSource.viewOf",
      input: {
        depsSpec: {
          engine: { kind: "unavailable", reason: "no stub" },
          reader: readerRunView({ cards: [{ ...readerCard("a#1", "approved") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerOn: false,
        },
      },
      expect: { kind: "absent", readerCalls: 0 },
    },
    {
      id: "p04-c17",
      fr: "F151-FR-039",
      kind: "edge",
      call: "viewSource.viewOf",
      input: {
        depsSpec: {
          engine: { kind: "unavailable", reason: "no stub" },
          reader: readerRunView({ cards: [{ ...readerCard("a#1", "approved") }], runs: { a: { id: "r-a", state: "idle", phase: null, lastAt: null } } }),
          readerOn: true,
          preserveMemo: true,
          callTwice: true,
        },
      },
      expect: { kind: "view", source: "workspace-reader", engineCalls: 1, readerCalls: 1, memoHolds: true },
    },
    {
      id: "p04-c18",
      fr: "F151-FR-007",
      kind: "positive",
      call: "store.roundtrip",
      input: {
        runId: "run-p4-store",
        record: {
          cards: [{ key: "specstride:run-p4-store", hermesId: "h-1", column: "scheduled", title: "t", body: "b", assignee: "specstride-projection", tenant: "specstride", humanEdited: false }],
          source: "workspace-reader",
          signature: "sig-p4-0001",
          lastGoodAt: "2026-11-11T12:00:00.000Z",
          stale: false,
          lastReadBackAt: 1000,
        },
        torn: "{ not json",
      },
      expect: {
        roundtrip: true,
        signature: "sig-p4-0001",
        tornRecord: { cards: [], source: "engine", signature: "", lastGoodAt: null, stale: true },
        warns: 1,
      },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-04-us1-projection", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
