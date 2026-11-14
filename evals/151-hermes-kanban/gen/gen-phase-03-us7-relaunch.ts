/**
 * Phase 3 (US7 — relaunch and ended runs) case generator — model-free.
 * Covers F151-FR-034/035/038 (the guarded verb builders and view acceptance),
 * FR-036 (the speaking run of a feature) and FR-037 (the reader lane rules
 * carried on stage cards).
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineView, engineCard, readerRunView, readerCard } from "./views.ts";

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
  const rand = mulberry32(SEED + 3);
  const relaunchStates = ["relaunching", "finished", "failed"];
  const state = relaunchStates[Math.floor(rand() * relaunchStates.length)] as string;

  return [
    {
      id: "p03-c01",
      fr: "F151-FR-036",
      kind: "positive",
      call: "project.speakingRunIdOf",
      input: {
        feature: "151-hermes-kanban",
        view: readerRunView({
          runs: {
            "151-hermes-kanban": { id: "run-relaunch-a", state, phase: 2, lastAt: "2026-11-11T12:00:00.000Z" },
            "151-other": { id: "run-idle-b", state: "idle", phase: null, lastAt: "2026-11-11T11:00:00.000Z" },
          },
        }),
      },
      expect: { runId: "run-relaunch-a" },
    },
    {
      id: "p03-c02",
      fr: "F151-FR-036",
      kind: "edge",
      call: "project.speakingRunIdOf",
      input: {
        view: readerRunView({
          runs: {
            "151-idle-only": { id: "run-idle-c", state: "idle", phase: null, lastAt: "2026-11-11T11:00:00.000Z" },
          },
        }),
      },
      expect: { runId: null },
    },
    {
      id: "p03-c03",
      fr: "F151-FR-037",
      kind: "positive",
      call: "project.stageCardsOf",
      input: {
        view: readerRunView({
          cards: [
            { ...readerCard("151-x#1", "verifying"), title: "phase 2", rule: "W2" },
            { ...readerCard("151-x#2", "approved"), title: "phase 1", rule: "W-approved" },
            { ...readerCard("151-y#0", "queued"), title: "never ran", rule: "W0" },
          ],
          runs: { "151-x": { id: "run-live-x", state: "running", phase: 2, lastAt: "2026-11-11T12:00:00.000Z" } },
        }),
      },
      expect: {
        count: 2,
        keys: ["specstride:run-live-x:151-x#1", "specstride:run-live-x:151-x#2"],
        rules: ["W2", "W-approved"],
        columns: ["scheduled", "done"],
        noCardForNeverRun: true,
      },
    },
    {
      id: "p03-c04",
      fr: "F151-FR-034",
      kind: "negative",
      call: "register.assertWriteGuards",
      input: {
        call: {
          argv: [...HEAD, "create", "T", "--tenant", "specstride", "--workspace", "scratch", "--body-file", "-", "--json"],
          stdin: "b",
          key: "specstride:run-relaunch-a",
        },
      },
      expect: { threw: true, messageContains: "guard A" },
    },
    {
      id: "p03-c05",
      fr: "F151-FR-035",
      kind: "edge",
      call: "viewRead.acceptView",
      input: {
        view: { fixture: "every-lane.json" },
        patch: { extraUnknownMember: { note: "additive members are kept" } },
      },
      expect: { ok: true, source: "engine", firstCardExtras: { ruleId: "L-01" } },
    },
    {
      id: "p03-c06",
      fr: "F151-FR-038",
      kind: "positive",
      call: "kanban.buildVerb",
      input: { verb: "complete", inputs: { key: "specstride:run-relaunch-a", id: "h-root-1", result: "finished (engine)" } },
      expect: {
        argv: [...HEAD, "complete", "h-root-1", "--result", "finished (engine)"],
        stdin: "",
        key: "specstride:run-relaunch-a",
      },
    },
    {
      id: "p03-c07",
      fr: "F151-FR-038",
      kind: "edge",
      call: "kanban.buildVerb",
      input: { verb: "archive", inputs: { key: "specstride:run-relaunch-a", id: "h-root-1" } },
      expect: {
        argv: [...HEAD, "archive", "h-root-1"],
        stdin: "",
        key: "specstride:run-relaunch-a",
      },
    },
    {
      id: "p03-c08",
      fr: "F151-FR-037",
      kind: "edge",
      call: "map.columnForLane",
      input: { lane: "reviewing", version: "v1" },
      expect: { column: "scheduled", label: "reviewing", unknown: false },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-03-us7-relaunch", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
