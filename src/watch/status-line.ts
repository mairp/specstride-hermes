/**
 * The precomputed status line (T056, F150-FR-038 to F150-FR-042,
 * contracts/150-host-hermes/plugin-manifest.md): for each watched workspace
 * the watcher writes the last terse line of the CLI as
 * `$HERMES_HOME/specstride-host/status/<sha256(workspace)[:16]>.line` next to
 * its counter `<same>.seq`. The hooks of phase 8 read these two files only —
 * they never call the CLI (H5, H3). Every write is atomic; the counter is
 * incremented exactly when the terse line changed, so a prompt-submission
 * hook can compare it (F150-FR-039).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STATUS_DIRECTORY = "status";

/** The 16-hex-character workspace key of the precomputed line files. */
export function workspaceKey(workspace: string): string {
  return createHash("sha256").update(workspace, "utf8").digest("hex").slice(0, 16);
}

/** The paths of the precomputed line and its counter for one workspace. */
export function statusPaths(
  home: string,
  workspace: string,
): { readonly lineFile: string; readonly seqFile: string } {
  const key = workspaceKey(workspace);
  const directory = join(home, "specstride-host", STATUS_DIRECTORY);
  return { lineFile: join(directory, key + ".line"), seqFile: join(directory, key + ".seq") };
}

/** An atomic single-file write: tmp in the same directory, then rename. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

/** The precomputed state of one workspace: the line and its counter. */
export type PrecomputedStatus = {
  readonly line: string;
  readonly seq: number;
};

/** Read the precomputed line and counter; absent files yield `"no run"` / 0. */
export function readStatus(home: string, workspace: string): PrecomputedStatus {
  const { lineFile, seqFile } = statusPaths(home, workspace);
  let line = "";
  try {
    line = readFileSync(lineFile, "utf8").replace(/\n$/, "");
  } catch {
    line = "";
  }
  let seq = 0;
  try {
    const parsed = Number.parseInt(readFileSync(seqFile, "utf8").trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) seq = parsed;
  } catch {
    seq = 0;
  }
  return { line, seq };
}

/**
 * Precompute the status line of one workspace from a `wait` output (T056).
 * `line` is the CLI's terse line, relayed verbatim. When it differs from the
 * one already stored, the counter is incremented; the line and counter files
 * are written atomically. Returns the new state.
 */
export function writeStatus(home: string, workspace: string, line: string): PrecomputedStatus {
  const { lineFile, seqFile } = statusPaths(home, workspace);
  const previous = readStatus(home, workspace);
  const changed = previous.line !== line;
  const seq = changed ? previous.seq + 1 : previous.seq;
  const trimmed = line.replace(/\n$/, "");
  writeAtomic(lineFile, trimmed + "\n");
  writeAtomic(seqFile, String(seq) + "\n");
  return { line: trimmed, seq };
}
