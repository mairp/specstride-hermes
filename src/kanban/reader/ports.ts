/**
 * The read-only ports and path builders of the workspace reader (T014;
 * PT-151-034; contracts/workspace-reader.md §7, F151-FR-034).
 *
 * The reader touches NOTHING else: the file port exposes the five read-only
 * operations (`list`, `read`, `exists`, `size`, `bytes`), the `/proc` port
 * the three reads liveness needs, and the path builders are the pure,
 * centralized spelling of the ten input rows of §7 — the allowlist lives
 * here and nowhere else. This file never imports a spawn, a worker or a
 * write API (the static check of tests/kanban/reader/inputs.test.ts holds
 * that).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The read-only file port of the reader. */
export interface FilePort {
  /** Directory entries, names only, sorted. */
  list(path: string): string[];
  /** A text file, UTF-8. */
  read(path: string): string;
  exists(path: string): boolean;
  size(path: string): number;
  /** Raw bytes, up to `limit` (default the whole file). */
  bytes(path: string, limit?: number): Uint8Array;
}

/** The `/proc` reads the reader needs — never a write, never a signal. */
export interface ProcPort {
  /** The full text of `/proc/<pid>/stat`, or null when it is gone. */
  stat(pid: number): string | null;
  /** The full text of `/proc/<pid>/cmdline`, or null when it is gone. */
  cmdline(pid: number): string | null;
  /** The boot time in ms since the epoch, from `/proc/stat` (`btime`). */
  bootTimeMs(): number | null;
}

export function nodeFilePort(): FilePort {
  return {
    list(path) {
      return readdirSync(path).sort();
    },
    read(path) {
      return readFileSync(path, "utf8");
    },
    exists(path) {
      return existsSync(path);
    },
    size(path) {
      return statSync(path).size;
    },
    bytes(path, limit) {
      const buffer = readFileSync(path);
      return limit === undefined ? buffer : buffer.subarray(0, limit);
    },
  };
}

export function nodeProcPort(): ProcPort {
  return {
    stat(pid) {
      try {
        return readFileSync(`/proc/${String(pid)}/stat`, "utf8");
      } catch {
        return null;
      }
    },
    cmdline(pid) {
      try {
        return readFileSync(`/proc/${String(pid)}/cmdline`, "utf8");
      } catch {
        return null;
      }
    },
    bootTimeMs() {
      try {
        for (const field of readFileSync("/proc/stat", "utf8").split("\n")) {
          if (field.startsWith("btime ")) return Number(field.slice(6)) * 1000;
        }
      } catch {
        /* no /proc/stat: not observable */
      }
      return null;
    },
  };
}

// --- The path builders of the ten input rows (§7). Pure; no reads here. ---

/** Row 1: `specs/<f>/tasks.md`. */
export function tasksMdPath(workspace: string, feature: string): string {
  return join(workspace, "specs", feature, "tasks.md");
}

/** Row 2: `.specstride/workspace.json`. */
export function workspaceJsonPath(workspace: string): string {
  return join(workspace, ".specstride", "workspace.json");
}

/** Row 3: `.specstride/events.jsonl` (the bash engine's stream). */
export function bashEventsPath(workspace: string): string {
  return join(workspace, ".specstride", "events.jsonl");
}

/** Row 4: `.specstride/features/<f>/gates/` and `…/evidence/` (names only). */
export function featureDirPath(workspace: string, feature: string, kind: "gates" | "evidence"): string {
  return join(workspace, ".specstride", "features", feature, kind);
}

// Row 5: `.specstride/launches/launch-<id>/` — launch, supervision and runtime.status JSON.
export function launchFilePath(workspace: string, launchId: string, kind: "launch" | "supervision" | "runtime.status"): string {
  return join(workspace, ".specstride", "launches", launchId, `${kind}.json`);
}

export function launchesDirPath(workspace: string): string {
  return join(workspace, ".specstride", "launches");
}

/** Row 6: `.specstride/active` and the lease of a feature's run. */
export function activePath(workspace: string): string {
  return join(workspace, ".specstride", "active");
}

export function leasePath(workspace: string, feature: string, runName: string): string {
  return join(workspace, ".specstride", "features", feature, "runs", runName, "lease.json");
}

/** Row 7: the pipeline's end record. */
export function pipelineStatePath(workspace: string, feature: string, launch: string): string {
  return join(workspace, ".specstride", "state", "pipeline", feature, "runs", launch, "state.json");
}

/** Row 8: the control roots — `<id16>` and the full id, both under the
 * state home's `.specstride/workspaces/` (the spelling of the closed set
 * and of every recorded fixture; US7 aligned the builder to it). */
export function controlRoot(stateHome: string, workspaceId: string): string {
  return join(stateHome, ".specstride", "workspaces", workspaceId);
}

export function controlRunEventsPath(root: string, runId: string): string {
  return join(root, "runs", runId, "events.jsonl");
}

export function controlRunsPath(root: string): string {
  return join(root, "runs");
}

export function controlProcsPath(root: string): string {
  return join(root, "procs.json");
}

export function controlFeatureDirPath(root: string, feature: string, kind: "approvals" | "bound" | "micro" | "feedback" | "set-aside"): string {
  return join(root, "features", feature, kind);
}

export function controlFeatureFilePath(root: string, feature: string, kind: "ledger" | "loop"): string {
  return join(root, "features", feature, `${kind}.json`);
}

/** Row 9: `/proc/<pid>/{stat,cmdline}` and `/proc/stat`. */
export function procPidPath(pid: number, kind: "stat" | "cmdline"): string {
  return `/proc/${String(pid)}/${kind}`;
}

export const PROC_STAT_PATH = "/proc/stat";

/** Row 10: the dsh session root of a working directory slug. */
export function dshSessionsPath(home: string, cwdSlug: string): string {
  return join(home, ".dsh", "sessions", cwdSlug);
}

// --- Bounded, tolerant read helpers over the port. ---

/**
 * The complete JSONL lines of a stream within `limit` bytes of its tail; a
 * torn trailing line is skipped, an unreadable stream yields nothing. The
 * reader continues: no throw reaches its caller.
 */
export function readEventTail(file: FilePort, path: string, limit: number): { lines: string[]; offset: number; lastSeq: number } {
  let text: string;
  let start = 0;
  try {
    const size = file.size(path);
    start = Math.max(0, size - limit);
    const buffer = file.bytes(path, undefined);
    text = Buffer.from(buffer.subarray(start)).toString("utf8");
  } catch {
    return { lines: [], offset: 0, lastSeq: 0 };
  }
  const rawLines = text.split("\n");
  // A trailing fragment without its newline is a torn line: skipped.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
  const lines: string[] = [];
  let offset = start;
  let lastSeq = 0;
  for (const line of rawLines) {
    offset += Buffer.byteLength(line, "utf8") + 1;
    if (line === "") continue;
    try {
      const seq = (JSON.parse(line) as Record<string, unknown>).seq;
      if (typeof seq === "number") lastSeq = seq;
    } catch {
      continue; // torn or malformed line: skipped
    }
    lines.push(line);
  }
  return { lines, offset, lastSeq };
}

/**
 * One JSON record within a bound. Oversized (over `limit`) or unparseable
 * records give null — skipped, never a throw.
 */
export function readJsonRecord(file: FilePort, path: string, limit: number): unknown | null {
  try {
    if (file.size(path) > limit) return null;
    return JSON.parse(file.read(path)) as unknown;
  } catch {
    return null;
  }
}

/** Directory entries; an unreadable directory gives none — skipped. */
export function listSafe(file: FilePort, path: string): string[] {
  try {
    return file.list(path);
  } catch {
    return [];
  }
}
