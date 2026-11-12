/**
 * The corpus-42 fixture generator (T006): writes
 * `tests/fixtures/workspaces/corpus-42/` deterministically —
 *
 * - 42 features, each with a `specs/<feature>/tasks.md` and the reader
 *   inputs the closed set allows (run dir, lease, workspace ledger and
 *   approvals);
 * - 250 approved phase cards in total, spread over the features as
 *   approval records (40 features with 6 approved phases, 2 with 5 —
 *   40×6 + 2×5 = 250);
 * - exactly ONE feature (`corpus-f00`) with a live run: a lease held by a
 *   recorded pid and a fresh event, so a reader with a live /proc shows one
 *   live-lane card; every other feature's run is long ended.
 *
 * Run with: node --experimental-strip-types tests/fixtures/workspaces/gen-corpus.ts
 * The output is committed; the generator must stay deterministic (stable
 * ids, no wall clock beyond the fixed CORPUS_TIME).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as pathDirname } from "node:path";

const HERE = pathDirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "corpus-42");

const FEATURES = 42;
const APPROVED_CARDS = 250;
const CORPUS_TIME = "2026-11-11T09:00:00.000Z";
const WORKSPACE_ID = "c0rpus42fix0000a1"; // 16 chars, stable

/** 40 features with 6 approved phases, 2 with 5: 40*6 + 2*5 = 250. */
function approvedPhases(featureIndex: number): number {
  return featureIndex < 40 ? 6 : 5;
}

function tasksMd(feature: string, approved: number): string {
  const lines = [`# ${feature}`, "", "## Phases", ""];
  for (let phase = 1; phase <= approved; phase++) {
    lines.push(`## Phase ${phase}`);
    lines.push(`- [x] T1 ${feature} phase ${phase} step one`);
    lines.push(`- [x] T2 ${feature} phase ${phase} step two`);
    lines.push("");
  }
  lines.push("## Phase 999");
  lines.push("- [ ] T1 not started");
  return lines.join("\n");
}

function approvedFeatureDir(feature: string, approved: number, live: boolean): string {
  const dir = join(OUT, "specs", feature);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tasks.md"), tasksMd(feature, approved));

  // Workspace side: ledger with one approved phase card per approved phase.
  const ws = join(OUT, ".specstride", "workspaces", WORKSPACE_ID, "features", feature);
  mkdirSync(join(ws, "approvals"), { recursive: true });
  const cards = [];
  for (let phase = 1; phase <= approved; phase++) {
    cards.push({
      schema: "specstride.approval/1",
      feature,
      phase,
      outcome: "approved",
      recordedAt: CORPUS_TIME,
    });
    writeFileSync(
      join(ws, "approvals", `phase-${phase}.json`),
      JSON.stringify(cards[cards.length - 1], null, 2) + "\n",
    );
  }
  writeFileSync(
    join(ws, "ledger.json"),
    JSON.stringify({ schema: "specstride.ledger/1", feature, cards, recordedAt: CORPUS_TIME }, null, 2) + "\n",
  );

  // The run: one launch per feature; only the live feature holds a lease.
  const launch = `launch-c${feature.slice(-3)}`;
  const runDir = join(OUT, ".specstride", "features", feature, "runs", `run-${launch}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "lease.json"),
    JSON.stringify(
      live
        ? { schema: "specstride.lease/1", feature, launchId: launch, pid: 4310, starttime: 4_200_000, acquiredAt: CORPUS_TIME }
        : { schema: "specstride.lease/1", feature, launchId: launch, pid: null, starttime: null, acquiredAt: null, releasedAt: CORPUS_TIME },
      null,
      2,
    ) + "\n",
  );
  const launchDir = join(OUT, ".specstride", "launches", launch);
  mkdirSync(launchDir, { recursive: true });
  writeFileSync(
    join(launchDir, "launch.json"),
    JSON.stringify(
      {
        schema: "specstride.launch/1",
        launchId: launch,
        runId: `run-${launch}`,
        workspaceId: WORKSPACE_ID,
        feature,
        createdAt: CORPUS_TIME,
        outcome: live ? "started" : "completed",
      },
      null,
      2,
    ) + "\n",
  );
  const pipeline = join(OUT, ".specstride", "state", "pipeline", feature, "runs", launch);
  mkdirSync(pipeline, { recursive: true });
  writeFileSync(
    join(pipeline, "state.json"),
    JSON.stringify(
      {
        schema: "specstride.pipeline-state/1",
        feature,
        launchId: launch,
        state: live ? "running" : "completed",
        updatedAt: CORPUS_TIME,
      },
      null,
      2,
    ) + "\n",
  );
  return feature;
}

function generate(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, ".specstride"), { recursive: true });
  writeFileSync(
    join(OUT, ".specstride", "workspace.json"),
    JSON.stringify(
      { schema: "specstride.layout/1", workspaceId: WORKSPACE_ID, realPath: OUT, createdAt: CORPUS_TIME },
      null,
      2,
    ) + "\n",
  );
  let approved = 0;
  for (let i = 0; i < FEATURES; i++) {
    const feature = `corpus-f${String(i).padStart(2, "0")}`;
    const phases = approvedPhases(i);
    approvedFeatureDir(feature, phases, i === 0);
    approved += phases;
  }
  if (approved !== APPROVED_CARDS) {
    throw new Error(`gen-corpus produced ${approved} approved phase cards, expected ${APPROVED_CARDS}`);
  }
  writeFileSync(
    join(OUT, ".specstride", "workspaces", WORKSPACE_ID, "procs.json"),
    JSON.stringify(
      {
        schema: "specstride.procs/1",
        recordedAt: CORPUS_TIME,
        processes: [
          { pid: 4310, starttime: 4_200_000, harness: "dsh", role: "proposer", feature: "corpus-f00" },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`corpus-42 written: ${FEATURES} features, ${approved} approved phase cards, 1 live run`);
}

export { generate, APPROVED_CARDS, FEATURES, WORKSPACE_ID, CORPUS_TIME };

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "\u0000");
if (isMain) generate();
