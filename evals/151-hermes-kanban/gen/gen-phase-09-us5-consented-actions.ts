/**
 * Phase 9 (US5 — Consented actions) case generator — model-free. Covers
 * F151-FR-026 (actions off: no route, 401 without a token), FR-027 (the
 * confirmed verb, its verbatim output, exactly one CLI call) and FR-028
 * (the unknown verb refusal and the confirm gate).
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

const NOW = 2_000_000;

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 9);
  const verbs = ["stop", "stop-now", "resume"];
  const verb = verbs[Math.floor(rand() * verbs.length)] as string;

  return [
    {
      id: "p09-c01",
      fr: "F151-FR-026",
      kind: "positive",
      call: "token.issueToken",
      input: { bound: "workspace:ws-demo", now: NOW, ttlMs: 60_000 },
      expect: { bound: "workspace:ws-demo", expiresAt: NOW + 60_000, tokenIsString: true },
    },
    {
      id: "p09-c02",
      fr: "F151-FR-026",
      kind: "negative",
      call: "handler.tabAction",
      input: {
        actionsOn: false,
        verb,
        confirm: true,
        issue: { bound: "workspace:ws-demo" },
        stub: { "stop": { stdout: "unused\n", exit: 0 }, "resume": { stdout: "unused\n", exit: 0 } },
      },
      expect: { status: 404, answer: "action-refused", cliCalls: 0 },
    },
    {
      id: "p09-c03",
      fr: "F151-FR-026",
      kind: "negative",
      call: "handler.tabAction",
      input: {
        actionsOn: true,
        verb,
        confirm: true,
        issue: null,
        stub: {},
      },
      expect: { status: 401, answer: "unavailable", cliCalls: 0 },
    },
    {
      id: "p09-c04",
      fr: "F151-FR-027",
      kind: "positive",
      call: "handler.tabAction",
      input: {
        actionsOn: true,
        verb: "stop",
        confirm: true,
        issue: { bound: "workspace:ws-demo" },
        stub: { "stop": { stdout: "stopping the run\n", exit: 0 } },
      },
      expect: { status: 200, answer: "action-accepted", verb: "stop", output: "stopping the run\n\n", cliVerbs: [["stop"]] },
    },
    {
      id: "p09-c05",
      fr: "F151-FR-027",
      kind: "positive",
      call: "handler.tabAction",
      input: {
        actionsOn: true,
        verb: "stop-now",
        confirm: true,
        issue: { bound: "workspace:ws-demo" },
        stub: { "stop": { stdout: "stopping now\n", exit: 0 } },
      },
      expect: { status: 200, answer: "action-accepted", verb: "stop-now", output: "stopping now\n\n", cliVerbs: [["stop", "--now"]] },
    },
    {
      id: "p09-c06",
      fr: "F151-FR-028",
      kind: "negative",
      call: "handler.tabAction",
      input: {
        actionsOn: true,
        verb: "resume",
        confirm: false,
        issue: { bound: "workspace:ws-demo" },
        stub: { "resume": { stdout: "never\n", exit: 0 } },
      },
      expect: { status: 400, answer: "action-refused", cliCalls: 0 },
    },
    {
      id: "p09-c07",
      fr: "F151-FR-028",
      kind: "negative",
      call: "handler.tabAction",
      input: {
        actionsOn: true,
        verb: "reboot-host",
        confirm: true,
        issue: { bound: "workspace:ws-demo" },
        stub: {},
      },
      expect: { status: 400, answer: "action-refused", cliCalls: 0 },
    },
    {
      id: "p09-c08",
      fr: "F151-FR-028",
      kind: "edge",
      call: "client.boardTree",
      input: {
        viewBuilder: "p07-board",
        selection: null,
        ui: { actions: true, pendingVerb: "stop", actionOutput: "stopping the run\n" },
      },
      expect: {
        actionsPresent: false,
        serializedContains: ["stopping the run"],
      },
    },
    {
      id: "p09-c09",
      fr: "F151-FR-026",
      kind: "edge",
      call: "token.checkToken",
      input: { issue: { bound: "workspace:ws-demo", now: NOW, ttlMs: 60_000 }, expected: "workspace:ws-demo", checkNow: NOW },
      expect: { ok: true },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-09-us5-consented-actions", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
