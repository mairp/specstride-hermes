/**
 * Phase 2 (Foundational) case generator — model-free. Covers F151-FR-003/005
 * (the lane map), FR-006/051 (the shim call and its probe), FR-007/035 (view
 * acceptance), FR-008/010/013/034/038 (the guarded kanban argv builders) and
 * FR-040 (the change signature).
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineView, engineCard } from "./views.ts";

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

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 2);
  const lanes = ["queued", "verifying", "approved", "paused"];
  const card = engineCard("c1", lanes[Math.floor(rand() * lanes.length)] as string);

  return [
    {
      id: "p02-c01",
      fr: "F151-FR-006",
      kind: "positive",
      call: "shimCall.status",
      input: {
        steps: { "status --json": { stdout: "fixture:empty.json", exit: 0 } },
        env: {},
      },
      expect: { kind: "none", verbs: [["status", "--json"]], probeFirst: true },
    },
    {
      id: "p02-c02",
      fr: "F151-FR-006",
      kind: "edge",
      call: "shimCall.status",
      input: {
        steps: { "status --json": { stdout: "fixture:empty.json", exit: 0 } },
        env: { STUB_PROTOCOL: "2" },
      },
      expect: { kind: "unavailable", reason: "protocol" },
    },
    {
      id: "p02-c03",
      fr: "F151-FR-006",
      kind: "negative",
      call: "shimCall.status",
      input: {
        steps: { "status --json": { stdout: "not-json at all", exit: 0 } },
        env: {},
      },
      expect: { kind: "unavailable", reason: "body" },
    },
    {
      id: "p02-c04",
      fr: "F151-FR-007",
      kind: "positive",
      call: "viewRead.acceptView",
      input: { view: { fixture: "every-lane.json" } },
      expect: {
        ok: true,
        source: "engine",
        cardCount: 8,
        firstCardId: "f151-p1-queued",
        firstCardExtras: { ruleId: "L-01" },
        state: "running",
      },
    },
    {
      id: "p02-c05",
      fr: "F151-FR-035",
      kind: "negative",
      call: "viewRead.acceptView",
      input: { view: { fixture: "every-lane.json" }, patch: { source: "mystery-source" } },
      expect: {
        ok: false,
        reason: 'the view source "mystery-source" is outside the closed set "View sources" (engine, workspace-reader)',
      },
    },
    {
      id: "p02-c06",
      fr: "F151-FR-003",
      kind: "positive",
      call: "map.columnForLane",
      input: { lane: "approved", version: "v1" },
      expect: { column: "done", label: "approved", unknown: false },
    },
    {
      id: "p02-c07",
      fr: "F151-FR-005",
      kind: "edge",
      call: "map.columnForLane",
      input: { lane: "crash", version: "v1" },
      expect: { column: "scheduled", label: "?crash", unknown: true },
    },
    {
      id: "p02-c08",
      fr: "F151-FR-008",
      kind: "positive",
      call: "kanban.buildVerb",
      input: { verb: "create", inputs: { key: "specstride:run-151-a", title: "Root · run-151-a", body: "engine-state: running" } },
      expect: {
        argv: [...HEAD, "create", "Root · run-151-a", "--tenant", "specstride", "--assignee", "specstride-projection", "--idempotency-key", "specstride:run-151-a", "--workspace", "scratch", "--body-file", "-", "--json"],
        stdin: "engine-state: running",
        key: "specstride:run-151-a",
      },
    },
    {
      id: "p02-c09",
      fr: "F151-FR-034",
      kind: "negative",
      call: "kanban.guardThrows",
      input: {
        call: {
          argv: [...HEAD, "create", "T", "--tenant", "specstride", "--idempotency-key", "specstride:run-151-a", "--workspace", "scratch", "--body-file", "-", "--json"],
          stdin: "b",
          key: "specstride:run-151-a",
        },
      },
      expect: { threw: true, messageContains: "does not carry the non-profile assignee --assignee specstride-projection (guard A, F151-FR-010)" },
    },
    {
      id: "p02-c10",
      fr: "F151-FR-013",
      kind: "negative",
      call: "kanban.guardThrows",
      input: {
        call: {
          argv: [...HEAD, "claim", "h-1", "--json"],
          stdin: "",
          key: "specstride:run-151-a",
        },
      },
      expect: { threw: true, messageContains: '"claim" is not a verb of the projection' },
    },
    {
      id: "p02-c11",
      fr: "F151-FR-040",
      kind: "positive",
      call: "signature.changeSignature",
      input: { view: engineView("running", []) },
      expect: { engineToken: "00000000", engineVerbatim: true, readerRecomputes: true },
    },
    {
      id: "p02-c12",
      fr: "F151-FR-038",
      kind: "edge",
      call: "kanban.buildVerb",
      input: { verb: "block", inputs: { key: "specstride:run-151-a:attn:i1", id: "h-attn-1", text: "needs_input: answer the question" } },
      expect: {
        argv: [...HEAD, "block", "h-attn-1", "--kind", "needs_input", "needs_input: answer the question"],
        stdin: "",
        key: "specstride:run-151-a:attn:i1",
      },
    },
    {
      id: "p02-c13",
      fr: "F151-FR-010",
      kind: "edge",
      call: "kanban.guardThrows",
      input: {
        call: {
          argv: [...HEAD, "create", "T", "--tenant", "specstride", "--idempotency-key", "specstride:run-151-a", "--workspace", "scratch", "--body-file", "-", "--json"],
          stdin: "",
          key: "specstride:run-151-a",
        },
      },
      expect: { threw: true, messageContains: "guard A" },
    },
    {
      id: "p02-c14",
      fr: "F151-FR-051",
      kind: "edge",
      call: "shim.protocolProbe",
      input: {
        args: ["--protocol"],
        steps: {},
        env: { STUB_PROTOCOL: "1" },
      },
      expect: {
        exit: 0,
        stdout: "1\n",
        logLines: [
          { probe: true, argv: ["--protocol"] },
          { probe: true, argv: ["--protocol"] },
        ],
      },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-02-foundational", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
