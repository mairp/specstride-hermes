/**
 * Phase 10 (Polish) case generator — model-free. Covers F151-FR-030 (the
 * doctor facts, findings and host facts), FR-016/022/023/032 (the spawn scan
 * gate and the contract mirror), FR-050/053 (the quickstart metrics doc and
 * the pin). Pure reads only; the runner may read repo files.
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

const KANBAN_FACT_IDS = [
  "HF-DASH-TOKENS",
  "HF-DASH-THEME-SWITCH",
  "HF-DASH-SDK",
  "HF-DASH-API-404",
  "HF-DASH-CSS",
  "HF-SESSION-USAGE",
  "HF-KANBAN-CLI",
  "HF-KANBAN-NONSPAWN",
  "HF-KANBAN-BLOCK",
  "HF-KANBAN-PROMOTE",
  "HF-KANBAN-RUNNING",
  "HF-KANBAN-TRIAGE",
  "HF-KANBAN-SCHEDULED",
  "HF-KANBAN-HOOK",
  "HF-KANBAN-NOTIFY",
];

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 10);
  const pick = Math.floor(rand() * KANBAN_FACT_IDS.length);
  const picked = KANBAN_FACT_IDS[pick] as string;

  return [
    {
      id: "p10-c01",
      fr: "F151-FR-030",
      kind: "positive",
      call: "doctor.kanbanFacts",
      input: {
        facts: {
          "kanban-enabled": "yes",
          "projector-alive": "yes",
          "tab-enabled": "yes",
          "map-version": "v1",
          "shim-on-unit-path": "yes",
          "engine-answers-protocol": "yes",
          "engine-path": "in unit path",
          "engine-matches-pin": "yes",
          "host-cli-runs-installed": "yes",
          "engine-view-has-cards": "yes",
          "view-source": "engine",
        },
      },
      expect: {
        count: 11,
        keys: ["kanban-enabled", "projector-alive", "tab-enabled", "map-version", "shim-on-unit-path", "engine-answers-protocol", "engine-path", "engine-matches-pin", "host-cli-runs-installed", "engine-view-has-cards", "view-source"],
        allStrings: true,
      },
    },
    {
      id: "p10-c02",
      fr: "F151-FR-030",
      kind: "edge",
      call: "doctor.kanbanFacts",
      input: { facts: {} },
      expect: { count: 11, keys: ["kanban-enabled", "projector-alive", "tab-enabled", "map-version", "shim-on-unit-path", "engine-answers-protocol", "engine-path", "engine-matches-pin", "host-cli-runs-installed", "engine-view-has-cards", "view-source"], allUnknown: false },
    },
    {
      id: "p10-c03",
      fr: "F151-FR-016",
      kind: "positive",
      call: "doctor.findingLine",
      input: { finding: { id: "SV-151-2", severity: "warn", message: "the detail table is capped" } },
      expect: { line: "warn SV-151-2 — the detail table is capped" },
    },
    {
      id: "p10-c04",
      fr: "F151-FR-032",
      kind: "positive",
      call: "doctor.hostFacts",
      input: { kanbanIdsOnly: true },
      expect: {
        kanbanIds: [
          "HF-VERSION", "HF-SKILL-FM", "HF-NO-INVOKE-FIELD", "HF-BUNDLED", "HF-ROOTS",
          "HF-ENABLE", "HF-VALIDATE", "HF-CMD", "HF-PRE-LLM", "HF-HOOK-TIMEOUT",
          "HF-SOURCE-ENV", "HF-GW-UNIT", "HF-GW-SURVIVAL", "HF-SEND", "HF-HEADLESS",
          "HF-SKILL-LOAD", "HF-STREAM-JSON", "HF-BACKEND", "HF-CONFIG-GET",
          "HF-PLUGINS-LIST", "HF-PLUGINS-DISABLE", "HF-SKILLS-LIST", "HF-PROFILE-CREATE",
          "HF-VERSION-FMT", "HF-DASH-TOKENS", "HF-DASH-THEME-SWITCH", "HF-DASH-SDK",
          "HF-DASH-API-404", "HF-DASH-CSS", "HF-SESSION-USAGE", "HF-KANBAN-CLI",
          "HF-KANBAN-NONSPAWN", "HF-KANBAN-BLOCK", "HF-KANBAN-PROMOTE", "HF-KANBAN-RUNNING",
          "HF-KANBAN-TRIAGE", "HF-KANBAN-SCHEDULED", "HF-KANBAN-HOOK", "HF-KANBAN-NOTIFY",
        ],
        kanbanCount: 39,
        totalRows: 39,
        pinnedVersion: "hermes-agent@0.22.2+d923a5eb48",
      },
    },
    {
      id: "p10-c05",
      fr: "F151-FR-030",
      kind: "positive",
      call: "doctor.hostFacts",
      input: { idContains: picked.slice(0, 8) },
      expect: { includes: ["HF-DASH-TOKENS", "HF-DASH-THEME-SWITCH", "HF-DASH-SDK", "HF-DASH-API-404", "HF-DASH-CSS"], allFromKanbanSet: true },
    },
    {
      id: "p10-c06",
      fr: "F151-FR-023",
      kind: "positive",
      call: "gates.spawnScan",
      input: { mode: "clean" },
      expect: { findings: [], ok: true },
    },
    {
      id: "p10-c07",
      fr: "F151-FR-023",
      kind: "negative",
      call: "gates.spawnScan",
      input: {
        mode: "violation",
        extraFile: { path: "src/kanban/reader/extra-probe.ts", content: "export const probe = (): void => { spawn(\"sh\", []); };\n" },
      },
      expect: { ok: false, messageContains: "starts a process", fileContains: "src/kanban/reader/extra-probe.ts" },
    },
    {
      id: "p10-c08",
      fr: "F151-FR-032",
      kind: "positive",
      call: "contract.mirror",
      input: { campaign: "151" },
      expect: { files: 9, byteEqual: true },
    },
    {
      id: "p10-c09",
      fr: "F151-FR-053",
      kind: "positive",
      call: "contract.mirror",
      input: { campaign: "150" },
      expect: { files: 2, byteEqual: true },
    },
    {
      id: "p10-c10",
      fr: "F151-FR-050",
      kind: "positive",
      call: "docs.readme",
      input: { anchor: "## Kanban and dashboard tab" },
      expect: { present: true, mentionsTab: true, mentionsActionsConsent: true },
    },
    {
      id: "p10-c11",
      fr: "F151-FR-050",
      kind: "edge",
      call: "docs.quickstart",
      input: { file: "evals/quickstart-151-metrics.md" },
      expect: {
        present: true,
        sections: ["F151-SC-001..F151-SC-010", "Quickstart steps 4 to 9 and the live probe — person-run, NOT run by this task"],
        zeroModelCalls: true,
      },
    },
    {
      id: "p10-c12",
      fr: "F151-FR-022",
      kind: "positive",
      call: "pin.check",
      input: {},
      expect: { pinFilePresent: true, minCommitPrefix: "27e7d71b", tarballCount: 4, hashesMatchPin: true, commitPrefixOk: true, depCount: 4 },
    },
    {
      id: "p10-c13",
      fr: "F151-FR-016",
      kind: "positive",
      call: "person.filePresence",
      input: { files: ["evals/151-hermes-kanban/phase-index.json"] },
      expect: { allPresent: true },
      personRun: true,
    },
    {
      id: "p10-c14",
      fr: "F151-FR-050",
      kind: "positive",
      call: "person.filePresence",
      input: { files: ["evals/quickstart-151-metrics.md"] },
      expect: { allPresent: true },
      personRun: true,
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-10-polish", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
