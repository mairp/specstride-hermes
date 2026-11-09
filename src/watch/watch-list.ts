/**
 * The watch list (T055, F150-FR-014, contracts/150-host-hermes/notice-line.md):
 * `$HERMES_HOME/specstride-host/watch.json`, the array of absolute workspace
 * directories the shim appends to on a successful `launch` (src/shim.ts,
 * T014). The watcher reads it each cycle. Reads keep set semantics (a
 * foreign or duplicated entry never duplicates a `wait`), and every write of
 * this module is atomic (tmp + rename, constitution I).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The path of the watch list under a Hermes home. */
export function watchListPath(home: string): string {
  return join(home, "specstride-host", "watch.json");
}

/**
 * Read the watched workspaces: a JSON array of absolute paths, deduplicated,
 * in first-seen order. A missing, unreadable or non-array file yields `[]`
 * (the watcher fails open, H5); relative entries are resolved against `home`
 * so a hand-edited file cannot point outside the host's own semantics.
 */
export function readWatchList(home: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(watchListPath(home), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry === "") continue;
    const absolute = entry.startsWith("/") ? entry : resolve(home, entry);
    if (!seen.includes(absolute)) seen.push(absolute);
  }
  return seen;
}

/** Write the watch list atomically, preserving set semantics (T055). */
export function writeWatchList(home: string, workspaces: readonly string[]): void {
  const file = watchListPath(home);
  const seen: string[] = [];
  for (const entry of workspaces) {
    if (typeof entry !== "string" || entry === "") continue;
    const absolute = entry.startsWith("/") ? entry : resolve(home, entry);
    if (!seen.includes(absolute)) seen.push(absolute);
  }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(seen, null, 2) + "\n");
  renameSync(temporary, file);
}

/** Append one workspace to the watch list atomically (set semantics). */
export function addWatchEntry(home: string, workspace: string): string[] {
  const known = readWatchList(home);
  const absolute = workspace.startsWith("/") ? workspace : resolve(home, workspace);
  if (!known.includes(absolute)) known.push(absolute);
  writeWatchList(home, known);
  return known;
}
