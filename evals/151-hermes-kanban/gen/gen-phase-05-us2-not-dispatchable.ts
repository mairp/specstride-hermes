/**
 * Phase 5 (US2 — Not dispatchable) case generator — model-free. Covers the
 * write-cycle over the real store: F151-FR-003 (the map version in force),
 * FR-009 (idempotence), FR-010/011 (the write guards), FR-012/013 (restore
 * and stale), FR-017 (the closed verb set — nothing dispatchable).
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readerRunView, readerCard, engineView } from "./views.ts";

export interface EvalCase {
  id: string;
  fr: string;
  kind: "positive" | "negative" | "edge";
  call: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  personRun?: boolean;
}

const HEAD = ["hermes", "-p", "specstride", "kanban"];
const STAGE_VIEW = () =>
  readerRunView({
    cards: [
      { ...readerCard("151-x#1", "verifying"), title: "phase 2", rule: "W2" },
      { ...readerCard("151-x#2", "approved"), title: "phase 1", rule: "W-approved" },
    ],
    runs: { "151-x": { id: "run-sync-a", state: "running", phase: 2, lastAt: "2026-11-11T12:00:00.000Z" } },
  });
const ROOT_ONLY_VIEW = () =>
  readerRunView({
    cards: [],
    runs: { "151-x": { id: "run-sync-a", state: "running", phase: 2, lastAt: "2026-11-11T12:30:00.000Z" } },
  });

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 5);
  const timeoutMs = 25 + Math.floor(rand() * 25); // stable per seed; feeds a stub step only

  return [
    {
      id: "p05-c01",
      fr: "F151-FR-009",
      kind: "positive",
      call: "sync.syncOnce",
      input: {
        steps: [
          { reader: STAGE_VIEW(), readBack: true },
          { reader: STAGE_VIEW(), readBack: true, freshMemo: true },
          { reader: { ...STAGE_VIEW(), featureDetails: { "151-x": { run: { id: "run-sync-a", launch: null, state: "running", phase: 2, startedAt: null, lastAt: "2026-11-11T12:30:00.000Z" } } } }, readBack: true, freshMemo: true },
        ],
      },
      expect: {
        steps: [
          { kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "schedule"], ok: true },
          { kind: "view", shortCircuit: true, verbs: [], ok: true },
          { kind: "view", shortCircuit: false, verbs: ["edit"], ok: true },
        ],
      },
    },
    {
      id: "p05-c02",
      fr: "F151-FR-012",
      kind: "edge",
      call: "sync.syncOnce",
      input: {
        steps: [
          { reader: STAGE_VIEW(), readBack: true },
          { reader: ROOT_ONLY_VIEW(), readBack: true, freshMemo: true },
        ],
      },
      expect: {
        steps: [
          { kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "schedule"], ok: true },
          { kind: "no-run", shortCircuit: false, verbs: [], ok: true },
        ],
      },
    },
    {
      id: "p05-c03",
      fr: "F151-FR-013",
      kind: "edge",
      call: "sync.syncOnce",
      input: {
        steps: [
          { reader: STAGE_VIEW(), readBack: true },
          { reader: { ...STAGE_VIEW(), featureDetails: { "151-x": { run: { id: "run-sync-a", launch: null, state: "running", phase: 2, startedAt: null, lastAt: "2026-11-11T12:30:00.000Z" } } } }, readBack: true, freshMemo: true, execExit: 1 },
        ],
      },
      expect: {
        steps: [
          { kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "schedule"], ok: true },
          { kind: "view", shortCircuit: false, verbs: [], ok: false },
        ],
        staleAfter: true,
      },
    },
    {
      id: "p05-c04",
      fr: "F151-FR-003",
      kind: "positive",
      call: "map.resolveMapVersion",
      input: { configured: null, hermesVersion: "0.22.2" },
      expect: { version: "v1" },
    },
    {
      id: "p05-c05",
      fr: "F151-FR-003",
      kind: "edge",
      call: "map.resolveMapVersion",
      input: { configured: "v2", hermesVersion: "0.22.2", record: { passed: true, hermesVersion: "0.22.2" } },
      expect: { version: "v2" },
    },
    {
      id: "p05-c06",
      fr: "F151-FR-003",
      kind: "negative",
      call: "map.resolveMapVersion",
      input: { configured: "v2", hermesVersion: "0.22.2", record: { passed: false, hermesVersion: "0.22.2" } },
      expect: { version: "v1" },
    },
    {
      id: "p05-c07",
      fr: "F151-FR-010",
      kind: "negative",
      call: "register.assertWriteGuards",
      input: {
        call: {
          argv: [...HEAD, "create", "T", "--tenant", "specstride", "--idempotency-key", "specstride:run-sync-a", "--workspace", "scratch", "--body-file", "-", "--json"],
          stdin: "",
          key: "specstride:run-sync-a",
        },
      },
      expect: { threw: true, messageContains: "guard A" },
    },
    {
      id: "p05-c08",
      fr: "F151-FR-011",
      kind: "negative",
      call: "register.assertWriteGuards",
      input: {
        call: {
          argv: [...HEAD, "create", "T", "--assignee", "specstride-projection", "--workspace", "scratch", "--body-file", "-", "--json"],
          stdin: "b",
          key: "specstride:run-sync-a",
        },
      },
      expect: { threw: true, messageContains: "--tenant specstride" },
    },
    {
      id: "p05-c09",
      fr: "F151-FR-017",
      kind: "edge",
      call: "sync.syncOnce",
      input: {
        steps: [
          { reader: STAGE_VIEW(), readBack: false },
          { engine: { kind: "none" }, readBack: false, freshMemo: true },
        ],
      },
      expect: {
        steps: [
          { kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "schedule"], ok: true },
          { kind: "no-run", shortCircuit: false, verbs: [], ok: true },
        ],
        forbiddenVerbsAbsent: ["claim", "heartbeat", "request-review", "link", "delete", "decompose", "specify", "swarm"],
      },
    },
    {
      id: "p05-c10",
      fr: "F151-FR-011",
      kind: "positive",
      call: "kanban.buildVerb",
      input: { verb: "create", inputs: { key: `specstride:run-timeout-${timeoutMs}`, title: "Root", body: "b" } },
      expect: {
        argvGuardOk: true,
        argvHead: ["hermes", "-p", "specstride", "kanban", "create"],
        key: `specstride:run-timeout-${timeoutMs}`,
      },
    },
    {
      id: "p05-c11",
      fr: "F151-FR-013",
      kind: "positive",
      call: "kanban.buildVerb",
      input: { verb: "edit", inputs: { key: "specstride:run-sync-a", id: "h-9", title: "phase 2", body: "engine-state: running" } },
      expect: {
        argv: [...HEAD, "edit", "h-9", "--title", "phase 2", "--body", "engine-state: running"],
        stdin: "",
        key: "specstride:run-sync-a",
      },
    },
    {
      id: "p05-c12",
      fr: "F151-FR-006",
      kind: "edge",
      call: "shimCall.status",
      input: {
        steps: { "status --json": { stdout: "fixture:every-lane.json", exit: 0 } },
        env: {},
      },
      expect: { kind: "view", cardCount: 8, verbs: [["status", "--json"]] },
    },
    {
      id: "p05-c13",
      fr: "F151-FR-007",
      kind: "edge",
      call: "viewRead.acceptView",
      input: { view: { fixture: "empty.json" } },
      expect: { ok: true, source: "engine", cardCount: 0 },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-05-us2-not-dispatchable", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
