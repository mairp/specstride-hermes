/**
 * Phase 6 (US3 — Attention) case generator — model-free. Covers F151-FR-014
 * (attention cards of the view), FR-015 (the reader's vanished/live facts),
 * FR-016 (nothing is ever sent to a card), FR-017 (archive on clear, block
 * once) and FR-037 (a never-run feature gets no attention card).
 */
import { mulberry32, SEED } from "./prng.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readerRunView, readerCard, attentionItem, wantedCard } from "./views.ts";

export interface EvalCase {
  id: string;
  fr: string;
  kind: "positive" | "negative" | "edge";
  call: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
  personRun?: boolean;
}

const ATTN_VIEW = () =>
  readerRunView({
    cards: [{ ...readerCard("151-x#1", "verifying") }],
    attention: [attentionItem("151-x#i1", "budget-alert", "budget-alert: the reader recorded a hold")],
    runs: { "151-x": { id: "run-attn-a", state: "running", phase: 3, lastAt: "2026-11-11T12:00:00.000Z" } },
  });
const CLEARED_VIEW = () =>
  readerRunView({
    cards: [{ ...readerCard("151-x#1", "verifying") }],
    attention: [],
    runs: { "151-x": { id: "run-attn-a", state: "running", phase: 3, lastAt: "2026-11-11T12:30:00.000Z" } },
  });

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 6);
  const kinds = ["budget-alert", "stale-run", "quota-pause"];
  const kind = kinds[Math.floor(rand() * kinds.length)] as string;

  const attnWanted = wantedCard({
    key: "specstride:run-attn-b:attn:151-x#i2",
    role: "attention",
    column: "blocked",
    title: "needs input",
    label: kind,
    attentionText: `${kind}: the reader recorded a hold`,
  });

  return [
    {
      id: "p06-c01",
      fr: "F151-FR-014",
      kind: "positive",
      call: "project.attentionCardsOf",
      input: {
        view: ATTN_VIEW(),
        hostVersion: "0.0.0",
      },
      expect: {
        count: 1,
        key: "specstride:run-attn-a:attn:151-x#i1",
        role: "attention",
        column: "blocked",
        attentionText: "budget-alert: the reader recorded a hold",
        titleContains: "",
        tenant: "specstride",
        assignee: "specstride-projection",
      },
    },
    {
      id: "p06-c02",
      fr: "F151-FR-014",
      kind: "edge",
      call: "project.attentionCardsOf",
      input: {
        view: readerRunView({
          cards: [],
          attention: [attentionItem("151-never#i9", kind, `${kind}: unknown feature`)],
          runs: { "151-x": { id: "run-attn-c", state: "running", phase: 1, lastAt: "2026-11-11T12:00:00.000Z" } },
        }),
        hostVersion: "0.0.0",
      },
      expect: { count: 0, noCardForUnknownFeature: true },
    },
    {
      id: "p06-c03",
      fr: "F151-FR-017",
      kind: "positive",
      call: "diff.planVerbs",
      input: {
        wanted: [attnWanted],
        stored: [],
        actual: null,
        foreignText: true,
      },
      expect: {
        verbs: [
          { verb: "create", key: "specstride:run-attn-b:attn:151-x#i2", id: null },
          { verb: "promote", key: "specstride:run-attn-b:attn:151-x#i2", id: null },
          { verb: "block", key: "specstride:run-attn-b:attn:151-x#i2", id: null },
        ],
        blockText: null,
        commentText: null,
      },
    },
    {
      id: "p06-c04",
      fr: "F151-FR-017",
      kind: "edge",
      call: "diff.planVerbs",
      input: {
        wanted: [attnWanted],
        stored: [{ key: "specstride:run-attn-b:attn:151-x#i2", hermesId: "h-attn-b", column: "blocked", title: "needs input", body: "", assignee: "specstride-projection", tenant: "specstride", humanEdited: false }],
        actual: { "specstride:run-attn-b:attn:i2": { hermesId: "h-attn-b", column: "blocked", assignee: "specstride-projection", tenant: "specstride" } },
        foreignText: true,
      },
      expect: { verbs: [], blockedOnce: false, neverUnblocked: true },
    },
    {
      id: "p06-c05",
      fr: "F151-FR-017",
      kind: "positive",
      call: "sync.syncOnce",
      input: {
        steps: [
          { reader: ATTN_VIEW(), readBack: false },
          { reader: CLEARED_VIEW(), readBack: false, freshMemo: true },
        ],
      },
      expect: {
        steps: [
          { kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "promote", "block"], ok: true },
          { kind: "view", shortCircuit: false, verbs: ["edit", "archive"], ok: true },
        ],
      },
    },
    {
      id: "p06-c06",
      fr: "F151-FR-016",
      kind: "negative",
      call: "sync.syncOnce",
      input: {
        steps: [{ reader: ATTN_VIEW(), readBack: true }],
      },
      expect: {
        steps: [{ kind: "view", shortCircuit: false, verbs: ["create", "schedule", "create", "schedule", "create", "promote", "block"], ok: true }],
        forbiddenVerbsAbsent: ["comment", "send", "notify", "dispatch", "claim"],
      },
    },
    {
      id: "p06-c07",
      fr: "F151-FR-015",
      kind: "edge",
      call: "project.attentionCardsOf",
      input: {
        view: readerRunView({
          cards: [{ ...readerCard("151-v#1", "queued"), title: "gone soon", rule: "W0" }],
          attention: [attentionItem("151-v#i3", "stale-run", "stale-run: the view is stale")],
          runs: { "151-v": null },
        }),
        hostVersion: "0.0.0",
      },
      expect: { count: 0, noRunMeansNoCard: true },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-06-us3-attention", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
