/**
 * The kanban module registration (T039; PT-151-012, PT-151-029;
 * contracts/sync-sidecar.md "Entry points"). When the installer has put the
 * kanban module in place (`--with-kanban`), this file calls 150's
 * `registerKanban` (`src/watch/index.ts`) so the watcher unit runs the sync
 * for every workspace of `watch.json` at the end of each watch cycle.
 *
 * Without the installed module nothing is registered: 150's watcher stays
 * byte for byte what it was, and its gate passes unchanged.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerKanban } from "../watch/index.ts";
import { readWatchList } from "../watch/watch-list.ts";
import { syncOnce, type SyncDeps } from "./sync.ts";

/** The schema id of the marker the installer writes with the module. */
export const KANBAN_MODULE_SCHEMA = "specstride.kanban-module/1";

/** The installed module directory of a Hermes home. */
export function kanbanModuleDir(hermesHome: string): string {
  return join(hermesHome, "specstride-host", "kanban", "module");
}

/** The marker file: the module's schema and the package version it came from. */
export function kanbanModuleMarker(hermesHome: string): string {
  return join(kanbanModuleDir(hermesHome), "kanban.json");
}

export interface KanbanModuleMarkerRecord {
  schema: string;
  version: string;
  files: { path: string; sha256: string }[];
}

/** Whether the installed module is present and of the recorded schema. */
export function kanbanModuleInstalled(hermesHome: string): boolean {
  const path = kanbanModuleMarker(hermesHome);
  if (!existsSync(path)) return false;
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as KanbanModuleMarkerRecord;
    return record.schema === KANBAN_MODULE_SCHEMA && Array.isArray(record.files) && record.files.length > 0;
  } catch {
    return false;
  }
}

/** The default Hermes home, as the watcher resolves it. */
function defaultHome(): string {
  return process.env.HERMES_HOME ?? join(homedir(), ".hermes");
}

/**
 * Register the sync with 150's watcher when (and only when) the module is
 * installed. Returns whether the hook was registered. The hook runs one
 * sync cycle per workspace of `watch.json`; a failing workspace never fails
 * the watch cycle — syncOnce catches its own ordinary failures, and any
 * other error is swallowed here with one log line (the watcher logs the
 * hook failure itself too).
 */
export function registerInstalledKanban(hermesHome: string = defaultHome()): boolean {
  if (!kanbanModuleInstalled(hermesHome)) return false;
  let memo: SyncDeps["memo"] = new Map();
  registerKanban(async () => {
    for (const workspace of readWatchList(hermesHome)) {
      try {
        await syncOnce(workspace, { hermesHome, memo });
      } catch (error) {
        console.warn(`[specstride-watch] kanban sync failed for ${workspace}: ${String(error)}`);
      }
    }
    memo = new Map(); // a new engine memo per cycle, like the standalone loop
  });
  return true;
}
