/*! PORT of portions of specstride-dsh packages/dsh-kanban/src/server/dsh-sessions.ts (summarise, cwdSlug, featureSessions).
 * Provenance: https://github.com/odanado/specstride-dsh (dsh-kanban), file packages/dsh-kanban/src/server/dsh-sessions.ts,
 * copied and adapted for Specstride (hermes) on 2026-11-11 by Specstride US6 (F151-FR-045).
 * SPDX-License-Identifier: MIT
 */

/**
 * The usage the dsh sessions of a workspace record for one feature: call
 * counts, tokens, retries, rate limits, backoff and the models — numbers
 * only; no prompt, no reply, no tool argument ever leaves the reader
 * (F151-FR-045). The reader reads, never writes.
 */
import type { FilePort } from "./ports.ts";
import { dshSessionsPath } from "./ports.ts";
import { capText, MAX_MODELS } from "./redact.ts";

/** One session's numbers (no content). */
export interface SessionSummary {
  role: string | null;
  feature: string | null;
  phase: number | null;
  createdAt: number | null;
  lastAt: number | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  calls: number;
  retries: number;
  rateLimited: number;
  backoffMs: number;
  steps: number;
  lastTool: string | null;
  runDir: string | null;
}

const PROPOSER = /^You are implementing phase (\d+) of the feature `([^`]+)`/;
const ACCELERATOR = /^You are accelerating phase (\d+)/;
const SESSION_CAP = 8 * 1024 * 1024;

/** Feature usage as the detail carries it. */
export interface DetailUsage {
  sessions: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  retries: number;
  rateLimited: number;
  backoffMs: number;
  models: string[];
}

/** dsh's directory name for a working directory: every `/` becomes `-`, then
 * `-` before and `--` after (`/root` → `--root--`). */
export function cwdSlug(cwd: string): string {
  return `-${cwd.replace(/\//g, "-")}--`;
}

/** One session's numbers (no content). */
export function summarise(text: string): SessionSummary {
  const s: SessionSummary = {
    role: null, feature: null, phase: null, createdAt: null, lastAt: null, provider: null, model: null,
    tokensIn: 0, tokensOut: 0, calls: 0, retries: 0, rateLimited: 0, backoffMs: 0, steps: 0, lastTool: null, runDir: null,
  };
  let firstUser = true;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let e: { type?: unknown; time?: unknown; createdAt?: unknown; data?: Record<string, unknown> };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    const data = e.data ?? {};
    if (typeof e.time === "number") s.lastAt = e.time;
    switch (e.type) {
      case "session":
        if (typeof e.createdAt === "number") s.createdAt = e.createdAt;
        break;
      case "user/message": {
        if (!firstUser) break;
        firstUser = false;
        const content = Array.isArray(data.content) ? data.content : [];
        const first = content.find((c): c is { text: string } => typeof c === "object" && c !== null && typeof (c as { text?: unknown }).text === "string");
        const head = (first?.text ?? "").slice(0, 400);
        const p = PROPOSER.exec(head);
        const a = ACCELERATOR.exec(head);
        if (p !== null) {
          s.role = "proposer";
          s.phase = Number.parseInt(p[1] as string, 10);
          s.feature = p[2] as string;
        } else if (a !== null) {
          s.role = "accelerator";
          s.phase = Number.parseInt(a[1] as string, 10);
        }
        break;
      }
      case "request/context":
        if (typeof data.provider === "string") s.provider = data.provider;
        if (typeof data.model === "string") s.model = data.model;
        break;
      case "assistant/message": {
        const usage = data.usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
        if (typeof usage?.inputTokens === "number") s.tokensIn += usage.inputTokens;
        if (typeof usage?.outputTokens === "number") s.tokensOut += usage.outputTokens;
        s.calls += 1;
        break;
      }
      case "llm/retry": {
        s.retries += 1;
        const failure = data.failure as { code?: unknown } | undefined;
        if (failure?.code === "RATE_LIMIT") s.rateLimited += 1;
        if (typeof data.delayMs === "number") s.backoffMs += data.delayMs;
        break;
      }
      case "step/start":
        s.steps += 1;
        break;
      case "tool/call": {
        const name = (data as { name?: unknown; tool?: unknown }).name ?? (data as { tool?: unknown }).tool;
        if (typeof name === "string" && /^[\w.:-]{1,40}$/.test(name)) s.lastTool = name;
        break;
      }
    }
  }
  return s;
}

/** The decoded lines of one session file; a zstd frame set needs the
 * interpreter's zstd (present from Node ≥ 24), else the session is skipped. */
function decode(path: string, bytes: Uint8Array): string | null {
  if (path.endsWith(".zstd")) {
    const zlib = zlibModule();
    if (zlib === null) return null;
    try {
      return new TextDecoder().decode(zlib.zstdDecompressSync(Buffer.from(bytes)));
    } catch {
      return null;
    }
  }
  return new TextDecoder().decode(bytes);
}

function zlibModule(): { zstdDecompressSync?: (input: Buffer) => Buffer } | null {
  try {
    const get = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    const zlib = typeof get === "function" ? (get.call(process, "node:zlib") as { zstdDecompressSync?: (input: Buffer) => Buffer }) : null;
    return zlib ?? null;
  } catch {
    return null;
  }
}

function summaryOf(fs: FilePort, path: string): SessionSummary | null {
  try {
    const size = fs.size(path);
    if (size === 0 || size > SESSION_CAP || !fs.exists(path)) return null;
    const bytes = fs.bytes(path);
    if (bytes === null) return null;
    const text = decode(path, bytes);
    if (text === null) return null;
    return summarise(text);
  } catch {
    return null;
  }
}

/**
 * The Specstride sessions of one feature: proposer and accelerator passes in
 * the workspace's slug. dsh's parallel-worker roots are not ported: they are
 * unnamed in the closed input list of the reader (F151-FR-034 keeps the
 * input closed; U-151-10 stays open).
 */
export function featureSessions(
  fs: FilePort,
  home: string,
  cwd: string,
  feature: string,
  phaseTitles: ReadonlySet<number>,
): SessionSummary[] {
  const out: SessionSummary[] = [];
  const own = dshSessionsPath(home, cwdSlug(cwd));
  for (const dir of safeList(fs, own)) {
    if (!/^session-[\w-]+$/.test(dir)) continue;
    const base = `${own}/${dir}`;
    const file = ["session.jsonl", "session.jsonl.zstd"].map((name) => `${base}/${name}`).find((path) => fs.exists(path));
    if (file === undefined) continue;
    const s = summaryOf(fs, file);
    if (s === null || s.role === null || s.phase === null) continue;
    if (s.role === "proposer" && s.feature !== feature) continue;
    if (!phaseTitles.has(s.phase)) continue;
    out.push({ ...s, feature });
  }
  return out;
}

function safeList(fs: FilePort, path: string): string[] {
  try {
    return fs.list(path);
  } catch {
    return [];
  }
}

/** The usage of one feature across its sessions, models bounded. */
export function usageOf(sessions: readonly SessionSummary[]): DetailUsage {
  const models = new Set<string>();
  const usage: DetailUsage = { sessions: sessions.length, calls: 0, tokensIn: 0, tokensOut: 0, retries: 0, rateLimited: 0, backoffMs: 0, models: [] };
  for (const s of sessions) {
    usage.calls += s.calls;
    usage.tokensIn += s.tokensIn;
    usage.tokensOut += s.tokensOut;
    usage.retries += s.retries;
    usage.rateLimited += s.rateLimited;
    usage.backoffMs += s.backoffMs;
    for (const model of [s.provider, s.model]) {
      if (typeof model === "string" && model !== "") models.add(model);
    }
  }
  usage.models = [...models].slice(0, MAX_MODELS).map((model) => capText(model, 40));
  return usage;
}
