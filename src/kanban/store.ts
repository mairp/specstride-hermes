/**
 * The projection store (T011; PT-151-007; data-model.md "ProjectedCard",
 * F151-FR-007). The only place the projection writes to disk.
 *
 * One file per run: `$HERMES_HOME/specstride-host/kanban/<run-id>.json`
 * holding the projected cards, the view source, the last projected signature
 * and `lastGoodAt`. Writes are atomic: a temporary file in the same
 * directory, then a rename into place. A torn or unreadable file reads as an
 * empty dataset and warns ONCE per file path — a later read of the same torn
 * file is silent (F151-FR-007).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

/** One projected card, as last written by the projector (data-model.md). */
export interface ProjectedCard {
  /** `specstride:<run-id>`, `specstride:<run-id>:<card-id>` or `…:attn:<item-id>`. */
  key: string;
  role: "root" | "stage" | "attention";
  /** The Hermes id from `kanban create --json`; null until created. */
  hermesId: string | null;
  /** Run state, lane or attention kind, verbatim. */
  engineValue: string;
  source: "engine" | "workspace-reader";
  /** `W0` … `W4`; reader cards only. */
  rule: string | null;
  /** From the lane map; never `triage`, `todo`, `running`, `review`. */
  column: string;
  title: string;
  body: string;
  assignee: "specstride-projection";
  tenant: "specstride";
  humanEdited: boolean;
  lastWrittenAt: string;
}

/** What one store file holds. */
export interface ProjectionRecord {
  cards: ProjectedCard[];
  /** The source of the view the cards were last projected from. */
  source: "engine" | "workspace-reader";
  /** The last projected change signature token. */
  signature: string;
  /** ISO 8601, when the last complete cycle ended. */
  lastGoodAt: string | null;
  /** Set by a failed cycle, cleared by the next completed one. */
  stale: boolean;
}

/** The empty dataset a torn file reads as. */
export function emptyRecord(): ProjectionRecord {
  return { cards: [], source: "engine", signature: "", lastGoodAt: null, stale: true };
}

/** The directory of the store, under `$HERMES_HOME`. */
export function storeDir(hermesHome: string): string {
  return join(hermesHome, "specstride-host", "kanban");
}

export interface ProjectionStoreOptions {
  /** Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

export class ProjectionStore {
  private readonly hermesHome: string;
  private readonly warn: (message: string) => void;
  /** The torn file paths already warned about, for the once-per-path rule. */
  private readonly warned = new Set<string>();

  constructor(hermesHome: string, options: ProjectionStoreOptions = {}) {
    this.hermesHome = hermesHome;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /** `$HERMES_HOME/specstride-host/kanban/<run-id>.json`. */
  pathOf(runId: string): string {
    return join(storeDir(this.hermesHome), `${runId}.json`);
  }

  /**
   * Save the record atomically: write `<path>.tmp` in the same directory and
   * rename it into place, so a reader never sees a half-written file.
   */
  save(runId: string, record: ProjectionRecord): void {
    const path = this.pathOf(runId);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    renameSync(tmp, path);
    // A good write clears the once-per-path torn warning for this file.
    this.warned.delete(path);
  }

  /**
   * Load the record of a run. An unreadable or torn file gives the empty
   * dataset and warns once per file path; a later read of the same torn file
   * stays silent. A good read clears the warning so a later tear warns again.
   */
  load(runId: string): ProjectionRecord {
    const path = this.pathOf(runId);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return this.torn(path, "unreadable");
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      return this.torn(path, "torn (not JSON)");
    }
    if (typeof record !== "object" || record === null || !Array.isArray((record as ProjectionRecord).cards)) {
      return this.torn(path, "torn (no cards array)");
    }
    const ok = record as ProjectionRecord;
    this.warned.delete(path);
    return {
      cards: ok.cards,
      source: ok.source === "workspace-reader" ? "workspace-reader" : "engine",
      signature: typeof ok.signature === "string" ? ok.signature : "",
      lastGoodAt: typeof ok.lastGoodAt === "string" ? ok.lastGoodAt : null,
      stale: ok.stale === true,
    };
  }

  private torn(path: string, why: string): ProjectionRecord {
    if (!this.warned.has(path)) {
      this.warned.add(path);
      this.warn(`kanban store: ${path} is ${why}; reading it as an empty dataset`);
    }
    return emptyRecord();
  }
}
