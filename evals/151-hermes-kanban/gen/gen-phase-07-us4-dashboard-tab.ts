/**
 * Phase 7 (US4 — Dashboard tab) case generator — model-free. Covers
 * F151-FR-006 (the view answer), FR-018 (session), FR-019 (view), FR-020
 * (board tree), FR-021 (wait), FR-022/023 (token gate), FR-024 (workspaces),
 * FR-025 (presentation tables and badges), FR-031/039/046/047/048/049/050/052
 * (strip chips, lane counts, the window threshold, the tree's markers, the
 * SDK/manifest surface and the bundle).
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

const NOW = 1_000_000;
const TOKEN_TTL = 3_600_000;

export function buildCases(): EvalCase[] {
  const rand = mulberry32(SEED + 7);
  const lanes = ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"];
  const threshold = 100 + Math.floor(rand() * 200); // stable per seed; feeds the profile config

  const boardView = () => {
    const raw = engineView("running", [engineCard("c1", "approved"), engineCard("c2", "verifying")]) as Record<string, unknown>;
    raw.source = "workspace-reader";
    raw.laneTable = { id: "workspace-reader", version: "1" };
    raw.featureDetails = {
      "151-hermes-kanban": { run: { id: "run-board-a", launch: null, state: "ended", phase: 1, startedAt: null, lastAt: "2026-11-11T12:00:00.000Z" } },
    };
    return raw;
  };

  return [
    {
      id: "p07-c01",
      fr: "F151-FR-022",
      kind: "positive",
      call: "token.issueToken",
      input: { bound: "run-151-a", now: NOW, ttlMs: TOKEN_TTL },
      expect: { bound: "run-151-a", expiresAt: NOW + TOKEN_TTL, tokenIsString: true },
    },
    {
      id: "p07-c02",
      fr: "F151-FR-022",
      kind: "positive",
      call: "token.checkToken",
      input: { issue: { bound: "run-151-a", now: NOW, ttlMs: TOKEN_TTL }, expected: "run-151-a", checkNow: NOW + 1000 },
      expect: { ok: true },
    },
    {
      id: "p07-c03",
      fr: "F151-FR-022",
      kind: "edge",
      call: "token.checkToken",
      input: { issue: { bound: "run-151-a", now: NOW, ttlMs: 5000 }, expected: "run-151-a", checkNow: NOW + 6000 },
      expect: { ok: false, status: 401 },
    },
    {
      id: "p07-c04",
      fr: "F151-FR-022",
      kind: "negative",
      call: "token.checkToken",
      input: { issue: { bound: "run-151-a", now: NOW, ttlMs: TOKEN_TTL }, expected: "run-other", checkNow: NOW + 1000 },
      expect: { ok: false, status: 409, answer: "run-changed" },
    },
    {
      id: "p07-c05",
      fr: "F151-FR-018",
      kind: "positive",
      call: "handler.tabSession",
      input: { profile: { actions: true, laneThreshold: threshold }, now: NOW },
      expect: {
        status: 200,
        answer: "view",
        actions: true,
        laneThreshold: threshold,
        expiresAt: NOW + TOKEN_TTL,
        tokenIsString: true,
        logs: 0,
      },
    },
    {
      id: "p07-c06",
      fr: "F151-FR-018",
      kind: "edge",
      call: "handler.tabSession",
      input: { profile: { laneThreshold: 0 }, now: NOW },
      expect: { status: 200, answer: "view", laneThreshold: 100, logs: 1 },
    },
    {
      id: "p07-c07",
      fr: "F151-FR-019",
      kind: "positive",
      call: "handler.tabView",
      input: {
        ws: "ws-demo",
        issue: { bound: "workspace:ws-demo" },
        viewScript: { kind: "view", source: "engine", runId: "run-151-a", view: engineView("running", [engineCard("c1", "queued")]) },
        now: NOW,
      },
      expect: { status: 200, answer: "view", source: "engine", cursorIsString: true },
    },
    {
      id: "p07-c08",
      fr: "F151-FR-023",
      kind: "negative",
      call: "handler.tabView",
      input: {
        ws: "ws-demo",
        issue: null,
        viewScript: { kind: "view", source: "engine", runId: "run-151-a", view: engineView("running", []) },
        now: NOW,
      },
      expect: { status: 401, answer: "unavailable" },
    },
    {
      id: "p07-c09",
      fr: "F151-FR-023",
      kind: "negative",
      call: "handler.tabView",
      input: {
        ws: "ws-demo",
        issue: { bound: "run-other" },
        viewScript: { kind: "view", source: "engine", runId: "run-151-a", view: engineView("running", []) },
        now: NOW,
      },
      expect: { status: 409, answer: "run-changed" },
    },
    {
      id: "p07-c10",
      fr: "F151-FR-021",
      kind: "positive",
      call: "handler.tabWait",
      input: {
        ws: "ws-demo",
        issue: { bound: "workspace:run-151-a" },
        readerView: readerRunView({ cards: [{ ...readerCard("a#1", "queued") }], runs: { a: { id: "run-151-a", state: "idle", phase: null, lastAt: null } } }),
        cursor: "reader-token",
        now: NOW,
      },
      expect: { status: 200, answer: "unchanged", cursor: "reader-token" },
    },
    {
      id: "p07-c11",
      fr: "F151-FR-021",
      kind: "edge",
      call: "handler.tabWait",
      input: {
        ws: "ws-demo",
        issue: { bound: "workspace:run-151-a" },
        readerView: readerRunView({ cards: [{ ...readerCard("a#1", "queued") }], runs: { a: { id: "run-151-a", state: "idle", phase: null, lastAt: null } } }),
        cursor: "stale-cursor",
        now: NOW,
      },
      expect: { status: 200, answer: "view", source: "workspace-reader", cursor: "reader-token" },
    },
    {
      id: "p07-c12",
      fr: "F151-FR-024",
      kind: "positive",
      call: "handler.tabWorkspaces",
      input: {},
      expect: { status: 200, answer: "view", workspaces: [] },
    },
    {
      id: "p07-c13",
      fr: "F151-FR-020",
      kind: "positive",
      call: "client.boardTree",
      input: { viewBuilder: "p07-board", selection: null, ui: {} },
      expect: {
        laneCount: 8,
        emptyLaneCount: 6,
        viewSource: "workspace-reader",
        bannerContains: true,
        quotaNotReported: true,
        stripPresent: true,
        serializedContains: ["sskh-root", "sskh-strip", "sskh-lanes"],
      },
    },
    {
      id: "p07-c14",
      fr: "F151-FR-046",
      kind: "edge",
      call: "client.boardTree",
      input: { viewBuilder: "p07-extra", extraCard: { id: "c3", feature: "151-hermes-kanban", phase: 1, lane: "mystery-lane", ruleId: "L-01", flags: { dead: false, stale: false, yielded: false } }, selection: null, ui: {} },
      expect: {
        laneCount: 9,
        lastLane: "mystery-lane",
        serializedContains: ["sskh-lane"],
      },
    },
    {
      id: "p07-c15",
      fr: "F151-FR-047",
      kind: "positive",
      call: "client.presentation",
      input: { set: "lane", value: "approved" },
      expect: { glyph: "✓", label: "Approved", grayscale: 88, token: "--color-success" },
    },
    {
      id: "p07-c16",
      fr: "F151-FR-025",
      kind: "edge",
      call: "client.presentation",
      input: { set: "lane", value: "mystery-lane" },
      expect: { glyph: "?", label: "mystery-lane", grayscale: 112, token: "--color-border" },
    },
    {
      id: "p07-c17",
      fr: "F151-FR-049",
      kind: "positive",
      call: "client.badge",
      input: { set: "lane", value: "queued" },
      expect: { tag: "span", cls: "sskh-badge", glyph: "·", label: "Queued", gray: 232, dataLane: "queued" },
    },
    {
      id: "p07-c18",
      fr: "F151-FR-048",
      kind: "positive",
      call: "client.windowThreshold",
      input: { profile: { laneThreshold: 250 } },
      expect: { threshold: 250, logs: 0 },
    },
    {
      id: "p07-c19",
      fr: "F151-FR-048",
      kind: "edge",
      call: "client.windowThreshold",
      input: { profile: { laneThreshold: -5 } },
      expect: { threshold: 100, logs: 1 },
    },
    {
      id: "p07-c20",
      fr: "F151-FR-052",
      kind: "positive",
      call: "build.manifest",
      input: { manifest: "hermes-plugin/specstride/dashboard/manifest.json" },
      expect: {
        tabPath: "/specstride",
        registerCall: true,
        sdkMemberCount: 11,
        lanesInManifest: lanes.length,
      },
    },
    {
      id: "p07-c21",
      fr: "F151-FR-050",
      kind: "positive",
      call: "build.manifest",
      input: { manifest: "hermes-plugin/specstride/dashboard/manifest.json", sdkProbe: true },
      expect: { sdkMembers: ["sdkVersion", "React", "hooks", "api", "fetchJSON", "authedFetch", "buildWsUrl", "buildWsAuthParam", "components", "utils", "useI18n"] },
    },
    {
      id: "p07-c22",
      fr: "F151-FR-031",
      kind: "edge",
      call: "client.presentation",
      input: { set: "attention", value: "budget-alert" },
      expect: { glyph: "$", label: "Budget alert", grayscale: 112, token: "--color-warning" },
    },
    {
      id: "p07-c23",
      fr: "F151-FR-039",
      kind: "edge",
      call: "handler.tabView",
      input: {
        ws: "ws-demo",
        issue: { bound: "workspace:ws-demo" },
        viewScript: { kind: "absent" },
        now: NOW,
      },
      expect: { status: 200, answer: "absent" },
    },
  ];
}

export function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(dirname(here), "phase-07-us4-dashboard-tab", "cases.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const body = buildCases().map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(out, body);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
