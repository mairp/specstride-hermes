/**
 * Phase 8 (US6 — Inspector) case generator — model-free. Covers F151-FR-043
 * (the card detail built over a workspace tree), FR-044 (the redaction of
 * the detail's strings) and FR-045/047 (bounded lists, liveness answers and
 * safe paths). The runner writes the case's tree into a temp dir and injects
 * the reader ports, exactly like tests/helpers/reader-harness.ts.
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface EvalCase {
  id: string;
  fr: string;
  kind: "positive" | "negative" | "edge";
  call: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  personRun?: boolean;
}

const TASKS_MD = `# Tasks for 151-demo

## Phase 1: Setup
- [x] T001 first task
- [ ] T002 second task

## Phase 2: Build
- [x] T003 third task
`;

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 8);
  const cap = 40 + Math.floor(rand() * 40); // stable per seed; feeds a redaction cap

  return [
    {
      id: "p08-c01",
      fr: "F151-FR-043",
      kind: "positive",
      call: "reader.buildDetails",
      input: {
        tree: {
          ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsdet0000000001" }),
          "specs/151-demo/tasks.md": TASKS_MD,
        },
        now: "2026-11-11T09:00:10Z",
        feature: "151-demo",
        picks: ["phase1.tasksTotal", "phase1.tasksDone", "phase1.tasks.0.text", "phase2.tasksTotal"],
      },
      expect: {
        values: {
          "phase1.tasksTotal": 2,
          "phase1.tasksDone": 1,
          "phase1.tasks.0.text": "first task",
          "phase2.tasksTotal": 1,
        },
      },
    },
    {
      id: "p08-c02",
      fr: "F151-FR-045",
      kind: "edge",
      call: "reader.buildDetails",
      input: {
        tree: {
          ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsdet0000000001" }),
          "specs/151-demo/tasks.md": TASKS_MD,
        },
        now: "2026-11-11T09:00:10Z",
        feature: "151-demo",
        picks: ["feature.run", "feature.agents", "feature.agentsNote"],
      },
      expect: {
        values: {
          "feature.run": null,
          "feature.agents": [],
          "feature.agentsNote": "critic and verifier calls leave no live record in this engine; they show as the lane only",
        },
      },
    },
    {
      id: "p08-c03",
      fr: "F151-FR-043",
      kind: "edge",
      call: "reader.buildDetails",
      input: {
        tree: {
          ".specstride/workspace.json": JSON.stringify({ workspaceId: "wsdet0000000001" }),
          "specs/151-demo/tasks.md": "not a tasks file at all",
        },
        now: "2026-11-11T09:00:10Z",
        feature: "151-demo",
        picks: ["phase1"],
      },
      expect: { values: { phase1: null }, noThrow: true },
    },
    {
      id: "p08-c04",
      fr: "F151-FR-044",
      kind: "positive",
      call: "redact.freeText",
      input: { text: `hold this pk-demo-1234567890 for the run`, capBytes: 200 },
      expect: { out: "hold this [key] for the run" },
    },
    {
      id: "p08-c05",
      fr: "F151-FR-044",
      kind: "edge",
      call: "redact.freeText",
      input: { text: `the prompt said "do the whole feature alone" twice`, capBytes: 200 },
      expect: { out: "the prompt said twice" },
    },
    {
      id: "p08-c06",
      fr: "F151-FR-047",
      kind: "positive",
      call: "redact.safePath",
      input: { path: "specs/151-demo/tasks.md", cwdMarker: "cwd", homeMarker: "home" },
      expect: { out: "specs/151-demo/tasks.md" },
    },
    {
      id: "p08-c07",
      fr: "F151-FR-047",
      kind: "negative",
      call: "redact.safePath",
      input: { path: "marker:absolute/etc/host.conf", cwdMarker: "cwd", homeMarker: "home" },
      expect: { out: "marker:absolute/etc/host.conf" },
    },
    {
      id: "p08-c08",
      fr: "F151-FR-044",
      kind: "edge",
      call: "redact.capText",
      input: { text: "https://example.invalid/a/very/long/path/that/keeps/going", capBytes: cap },
      expect: { length: cap, capped: true, prefix: "https://example.invalid/" },
    },
    {
      id: "p08-c09",
      fr: "F151-FR-045",
      kind: "positive",
      call: "redact.describeProcess",
      input: { argv: ["hermes", "--profile", "specstride", "--model", "none-local", "kanban", "list"] },
      expect: {
        harness: "hermes",
        profile: "specstride",
        model: "none-local",
        role: null,
      },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-08-us6-inspector", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
