/**
 * The lane-to-column map (T009; F151-FR-003, F151-FR-005, F151-FR-009 to
 * F151-FR-011; contracts/lane-map.md; research R2, R3).
 *
 * Total over the eight engine lanes and the ten run states of
 * `@specstride/contracts` 0.1.0 — a missing member is a type error here and a
 * test failure in tests/kanban/map.test.ts (PT-151-003). The map is
 * deterministic and never assigns a lane (lesson L1): it only takes the lane a
 * card already carries to a Hermes column. An unknown value — an engine lane
 * or run state outside the pinned enums, or a reader run state recorded as
 * free text such as `crash` — goes to `scheduled` with the label `?<raw>`
 * (F151-FR-005; OD-151-10's conservative default).
 *
 * v1 (default): every lane → `scheduled` except `approved` → `done`; every
 * run state → `scheduled` except `finished` → `done`. v2 (`proposing`,
 * `verifying` → `ready`) is refused unless `specstride.kanban.map: v2` AND
 * `$HERMES_HOME/specstride-host/kanban/dispatcher-test.json` records a pass
 * of `dispatcher.live.test.ts` for the installed Hermes version.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANES } from "@specstride/contracts/records/run-view";
import { RUN_STATES } from "@specstride/contracts/state/run-state";
import {
  closedSetLanes,
  closedSetRunStates,
  closedSetForbiddenColumns,
  type LaneName,
  type RunStateName,
  type TargetColumn,
} from "./generated/closed-sets.ts";

/** The columns Hermes moves a guarded card out of; never a target (H6). */
export const FORBIDDEN_COLUMNS: readonly string[] = closedSetForbiddenColumns;

/** `blocked` holds attention cards only; never a root or stage target. */
const ATTENTION_ONLY_COLUMN: TargetColumn = "blocked";
/** `ready` exists only under map v2, and only behind the dispatcher test. */
const V2_ONLY_COLUMN: TargetColumn = "ready";

/** The stage-card map v1 (default): one row per lane of the pinned enum. */
const LANE_MAP_V1: Readonly<Record<LaneName, TargetColumn>> = {
  queued: "scheduled",
  proposing: "scheduled",
  verifying: "scheduled",
  reviewing: "scheduled",
  approved: "done",
  blocked: "scheduled",
  paused: "scheduled",
  failed: "scheduled",
};

/** The root-card map v1 (default): one row per run state of the pinned enum. */
const RUN_STATE_MAP_V1: Readonly<Record<RunStateName, TargetColumn>> = {
  created: "scheduled",
  starting: "scheduled",
  running: "scheduled",
  "paused-quota": "scheduled",
  relaunching: "scheduled",
  stopping: "scheduled",
  "blocked-on-human": "scheduled",
  finished: "done",
  stopped: "scheduled",
  failed: "scheduled",
};

/** The stage-card map v2 (opt-in, gated): `proposing` and `verifying` → `ready`. */
const LANE_MAP_V2: Readonly<Record<LaneName, TargetColumn>> = {
  ...LANE_MAP_V1,
  proposing: "ready",
  verifying: "ready",
};

/** The root-card map v2 is v1: no run state reaches a `ready` column. */
const RUN_STATE_MAP_V2 = RUN_STATE_MAP_V1;

export type MapVersion = "v1" | "v2";

export interface MappedCard {
  /** The Hermes column the card is written into. */
  column: TargetColumn;
  /** The verbatim lane or run state; `?<raw>` for a value the map does not know. */
  label: string;
  /** True when the raw value was not a member of the pinned enum. */
  unknown: boolean;
}

/**
 * The pinned engine enums and the generated closed sets must agree, so that a
 * member added upstream without a regeneration of `closed-sets.ts` fails here
 * instead of silently narrowing the map (F151-FR-003, totality).
 * @throws when the two lists differ.
 */
export function assertEnumsAgree(): void {
  const pairs: [readonly string[], readonly string[], string][] = [
    [LANES, closedSetLanes, "lanes"],
    [RUN_STATES, closedSetRunStates, "run-states"],
  ];
  for (const [fromContracts, generated, name] of pairs) {
    const same =
      fromContracts.length === generated.length &&
      fromContracts.every((member, i) => member === generated[i]);
    if (!same) {
      throw new Error(
        `lane map: the ${name} of @specstride/contracts (${fromContracts.join(", ")}) ` +
          `differ from src/kanban/generated/closed-sets.ts (${generated.join(", ")}) — ` +
          `regenerate with scripts/gen-kanban-values.ts`,
      );
    }
  }
}

assertEnumsAgree();

/**
 * Check a map table against the guards: total over the pinned enum, only
 * target columns, none forbidden, `blocked` nowhere, `ready` only in v2.
 * @throws when a row breaks a guard (the build fails, per the closed sets).
 */
function assertTableGuards(
  table: Readonly<Record<string, TargetColumn>>,
  members: readonly string[],
  version: MapVersion,
  kind: string,
): void {
  for (const member of members) {
    const column = table[member];
    if (column === undefined) {
      throw new Error(`lane map ${version}: ${kind} ${member} has no row (the map is total)`);
    }
    if (FORBIDDEN_COLUMNS.includes(column)) {
      throw new Error(`lane map ${version}: ${kind} ${member} targets the forbidden column ${column}`);
    }
    if (column === ATTENTION_ONLY_COLUMN) {
      throw new Error(`lane map ${version}: ${kind} ${member} targets ${column}, which holds attention cards only`);
    }
    if (column === V2_ONLY_COLUMN && version !== "v2") {
      throw new Error(`lane map ${version}: ${kind} ${member} targets ${column}, which only map v2 may use`);
    }
  }
}

assertTableGuards(LANE_MAP_V1, closedSetLanes, "v1", "lane");
assertTableGuards(RUN_STATE_MAP_V1, closedSetRunStates, "v1", "run state");
assertTableGuards(LANE_MAP_V2, closedSetLanes, "v2", "lane");
assertTableGuards(RUN_STATE_MAP_V2, closedSetRunStates, "v2", "run state");

/** A row of `$HERMES_HOME/specstride-host/kanban/dispatcher-test.json`. */
export interface DispatcherTestRecord {
  passed: boolean;
  /** The Hermes version the live dispatcher test ran against. */
  hermesVersion: string;
  /** When the test ran (informational; the version match is what gates v2). */
  at?: string;
}

/** The file that records the live dispatcher test pass, under the store dir. */
export const DISPATCHER_TEST_FILE = "dispatcher-test.json";

function readDispatcherTest(
  hermesHome: string,
  hermesVersion: string,
  readFile?: (path: string) => string,
): boolean {
  const path = join(hermesHome, "specstride-host", "kanban", DISPATCHER_TEST_FILE);
  let text: string;
  try {
    text = (readFile ?? ((p: string) => readFileSync(p, "utf8")))(path);
  } catch {
    return false;
  }
  try {
    const record = JSON.parse(text) as Partial<DispatcherTestRecord>;
    return record.passed === true && record.hermesVersion === hermesVersion;
  } catch {
    return false;
  }
}

export interface MapSelection {
  /** `specstride.kanban.map` (default `v1`). */
  configured?: string;
  /** The Hermes home; `dispatcher-test.json` is read under it for v2. */
  hermesHome: string;
  /** The installed Hermes version the live test must have passed against. */
  hermesVersion: string;
  /** Test seam; defaults to a UTF-8 file read. */
  readFile?: (path: string) => string;
}

/**
 * Resolve the map version (F151-FR-003): v2 only when configured AND the
 * dispatcher test recorded a pass for this Hermes version; otherwise v1.
 */
export function resolveMapVersion(selection: MapSelection): MapVersion {
  if (selection.configured !== "v2") return "v1";
  return readDispatcherTest(selection.hermesHome, selection.hermesVersion, selection.readFile)
    ? "v2"
    : "v1";
}

/**
 * The map for a resolved version. Deterministic: the same version gives the
 * same frozen table every time.
 */
export function laneMapFor(version: MapVersion): {
  lanes: Readonly<Record<LaneName, TargetColumn>>;
  runStates: Readonly<Record<RunStateName, TargetColumn>>;
} {
  const lanes = version === "v2" ? LANE_MAP_V2 : LANE_MAP_V1;
  const runStates = version === "v2" ? RUN_STATE_MAP_V2 : RUN_STATE_MAP_V1;
  return { lanes: Object.freeze({ ...lanes }), runStates: Object.freeze({ ...runStates }) };
}

/** Map a stage card's lane (F151-FR-003, F151-FR-005). */
export function columnForLane(lane: string, version: MapVersion = "v1"): MappedCard {
  const { lanes } = laneMapFor(version);
  const column = (lanes as Readonly<Record<string, TargetColumn>>)[lane];
  if (column !== undefined) return { column, label: lane, unknown: false };
  return { column: "scheduled", label: `?${lane}`, unknown: true };
}

/** Map a root card's run state (F151-FR-003; reader states → `?<raw>`, `scheduled`). */
export function columnForRunState(state: string, version: MapVersion = "v1"): MappedCard {
  const { runStates } = laneMapFor(version);
  const column = (runStates as Readonly<Record<string, TargetColumn>>)[state];
  if (column !== undefined) return { column, label: state, unknown: false };
  return { column: "scheduled", label: `?${state}`, unknown: true };
}
