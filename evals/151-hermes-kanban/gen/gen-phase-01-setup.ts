/**
 * Phase 1 (Setup) case generator — model-free. Covers F151-FR-025 (the
 * generated closed sets / presentation sets), F151-FR-031 (the language
 * ledger row for the dashboard plugin), F151-FR-051 (the shim's `--protocol`
 * probe) and F151-FR-054 (the moved engine pin, behind the real shim).
 * Runs against the real shim (`bin/specstride-hermes.mjs`) pointed at
 * `tests/stubs/specstride`, exactly like tests/contract/stub-cli.test.ts.
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

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const verbs = [
    ["status", "--json"],
    ["wait", "--until-change", "--cursor", "0", "--timeout", "25"],
  ];

  const cases: EvalCase[] = [
    {
      id: "p01-c01",
      fr: "F151-FR-051",
      kind: "positive",
      call: "shim.protocolProbe",
      input: {
        args: pick(verbs),
        steps: { "status --json": { stdout: '{"schema":"specstride.view/1","state":"none","runId":null,"cards":[],"attention":[]}', exit: 0 } },
        env: {},
      },
      expect: {
        exit: 0,
        stdoutContains: '"state":"none"',
        logLines: [
          { probe: true, argv: ["--protocol"] },
          { probe: false, argv: ["status", "--json"] },
        ],
      },
    },
    {
      id: "p01-c02",
      fr: "F151-FR-051",
      kind: "negative",
      call: "shim.protocolProbe",
      input: {
        args: ["status", "--json"],
        steps: { "status --json": { stdout: '{"schema":"specstride.view/1","state":"none","runId":null,"cards":[],"attention":[]}', exit: 0 } },
        env: { STUB_PROTOCOL: "2" },
      },
      expect: {
        exit: 4,
        stdoutContains: "[SPECSTRIDE-REFUSE]",
        logLines: [{ probe: true, argv: ["--protocol"] }],
      },
    },
    {
      id: "p01-c03",
      fr: "F151-FR-054",
      kind: "edge",
      call: "shim.verb",
      input: {
        args: ["status", "--json"],
        steps: { "status --json": { stdout: "", stderr: '[SPECSTRIDE-ERR] reason="internal"', exit: 70 } },
        env: {},
      },
      expect: { exit: 70, logVerbs: [["status", "--json"]] },
    },
    {
      id: "p01-c04",
      fr: "F151-FR-054",
      kind: "edge",
      call: "shim.verb",
      input: {
        args: ["wait", "--until-change", "--cursor", "0", "--timeout", "25"],
        steps: { "wait --until-change --cursor 0 --timeout 25": { stdout: '{"error":"no-feature","feature":null}', exit: 1 } },
        env: {},
      },
      expect: { exit: 1, stdoutContains: "no-feature", logVerbs: [["wait", "--until-change", "--cursor", "0", "--timeout", "25"]] },
    },
    {
      id: "p01-c05",
      fr: "F151-FR-025",
      kind: "positive",
      call: "values.closedSets",
      input: { sets: ["lanes", "run-states", "lane-presentation", "attention-kinds", "api-answers"] },
      expect: {
        lanes: ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"],
        runStates: ["created", "starting", "running", "paused-quota", "relaunching", "stopping", "blocked-on-human", "finished", "stopped", "failed"],
        laneGlyphs: ["·", "▶", "◇", "◎", "✓", "⏸", "‖", "✗"],
        attentionKinds: ["blocked-on-human", "source-changed", "dead-run", "launch-abandoned", "quota-pause", "budget-alert", "stale-run", "orphan-processes", "unknown-state"],
        apiAnswers: ["view", "unchanged", "no-run", "absent", "refused-schema", "unavailable", "run-changed"],
      },
    },
    {
      id: "p01-c06",
      fr: "F151-FR-031",
      kind: "positive",
      call: "docs.ledger",
      input: { ledger: "docs/language-ledger.md", pyFile: "hermes-plugin/specstride/dashboard/plugin_api.py" },
      expect: { rowFound: true, kanbanPythonFiles: 1 },
    },
    {
      id: "p01-c07",
      fr: "F151-FR-054",
      kind: "positive",
      call: "pin.check",
      input: { pin: "core-pin.json", minCommitPrefix: "27e7d71b" },
      expect: { commitPrefixOk: true, tarballCount: 4, hashesMatchPin: true, depCount: 4 },
    },
  ];
  return cases;
}

/** The generator main: writes the committed cases.jsonl byte for byte. */
export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-01-setup", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
