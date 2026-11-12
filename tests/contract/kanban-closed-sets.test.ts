/**
 * PT-151-025 (T007): the kanban closed-set code tables. The committed
 * `src/kanban/generated/closed-sets.ts` is byte-equal to a fresh generation
 * from `contracts/151-hermes-kanban/closed-sets.json`; the JSON's "lanes",
 * "run-states" and "attention-kinds" equal the pinned `@specstride/contracts`
 * constants; every presentation set (unknown included) has pairwise distinct
 * glyphs and labels and grayscale values at least 24 apart; and every
 * `token` and `mix.with` is a member of the theme tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateClosedSetsModule, readClosedSets, GENERATED_TS } from "../../scripts/gen-kanban-values.ts";
import { LANES, ATTENTION_KINDS } from "@specstride/contracts/records/run-view";
import { RUN_STATES } from "@specstride/contracts/state/run-state";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

test("PT-151-025: the committed generated file is byte-equal to a fresh generation", () => {
  const fresh = generateClosedSetsModule(readClosedSets());
  const committed = readFileSync(GENERATED_TS, "utf8");
  assert.equal(committed, fresh);
  assert.ok(committed.endsWith("\n"), "the generated file ends with a newline");
});

test("PT-151-025: lanes, run-states and attention-kinds equal the pinned contracts constants", async () => {
  const generated = await import(GENERATED_TS.replace(/\.ts$/, ".ts"));
  assert.deepEqual([...generated.closedSetLanes], LANES);
  assert.deepEqual([...generated.closedSetRunStates], RUN_STATES);
  assert.deepEqual([...generated.closedSetAttentionKinds], ATTENTION_KINDS);
  assert.deepEqual([...generated.closedSetBudgetLevels], ["unknown", "ok", "info", "warn", "loud", "over"]);
});

type PresentationEntry = { glyph?: string; label?: string; grayscale?: number; token?: string; mix?: { with?: string } };

const PRESENTATION_EXPORTS = [
  "lanePresentation",
  "attentionPresentation",
  "budgetPresentation",
  "taskPresentation",
  "alivePresentation",
  "outcomePresentation",
  "launchPresentation",
] as const;

function entriesOf(set: Record<string, unknown>): { members: PresentationEntry[]; unknown: PresentationEntry } {
  return {
    members: set.members as PresentationEntry[],
    unknown: set.unknown as PresentationEntry,
  };
}

test("PT-151-025: every presentation set has distinct glyphs and labels and grayscale at least 24 apart", async () => {
  const generated = await import(GENERATED_TS);
  for (const name of PRESENTATION_EXPORTS) {
    const { members, unknown } = entriesOf(generated[name] as Record<string, unknown>);
    const all = [...members, unknown];
    const glyphs = all.map((e) => e.glyph);
    const labels = all.map((e) => e.label);
    assert.equal(new Set(glyphs).size, glyphs.length, `${name}: glyphs are pairwise distinct`);
    assert.equal(new Set(labels).size, labels.length, `${name}: labels are pairwise distinct`);
    const grays = all.map((e) => e.grayscale as number).sort((a, b) => a - b);
    for (let i = 1; i < grays.length; i++) {
      assert.ok(
        grays[i] - grays[i - 1] >= 24,
        `${name}: grayscale values at least 24 apart (${grays[i - 1]} and ${grays[i]})`,
      );
    }
  }
});

test("PT-151-025: every presentation set is total over its source set, unknown included", async () => {
  const generated = await import(GENERATED_TS);
  const totals: [string, string[], string[]][] = [
    ["lanePresentation", generated.closedSetLanes, (generated.lanePresentation.members as { lane: string }[]).map((m) => m.lane)],
    ["attentionPresentation", generated.closedSetAttentionKinds, (generated.attentionPresentation.members as { kind: string }[]).map((m) => m.kind)],
    ["budgetPresentation", generated.closedSetBudgetLevels, (generated.budgetPresentation.members as { level: string }[]).map((m) => m.level)],
    ["launchPresentation", generated.closedSetLaunchStates, (generated.launchPresentation.members as { state: string }[]).map((m) => m.state)],
  ];
  for (const [name, set, keys] of totals) {
    assert.deepEqual([...keys].sort(), [...set].sort(), `${name} is total over ${name.replace("Presentation", "")}`);
    assert.ok(generated[name].unknown, `${name} carries an unknown presentation`);
  }
});

test("PT-151-025: every token and mix.with of the presentation sets is a theme token", async () => {
  const generated = await import(GENERATED_TS);
  const tokens = new Set(generated.closedSetThemeTokens as string[]);
  for (const name of PRESENTATION_EXPORTS) {
    const { members, unknown } = entriesOf(generated[name] as Record<string, unknown>);
    for (const entry of [...members, unknown]) {
      assert.ok(tokens.has(entry.token as string), `${name}: ${entry.token} is a theme token`);
      if (entry.mix?.with) assert.ok(tokens.has(entry.mix.with), `${name}: mix.with ${entry.mix.with} is a theme token`);
    }
  }
});

test("PT-151-025: the forbidden columns are disjoint from the target columns", async () => {
  const generated = await import(GENERATED_TS);
  const targets = new Set(generated.closedSetTargetColumns as string[]);
  for (const forbidden of generated.closedSetForbiddenColumns as string[]) {
    assert.ok(!targets.has(forbidden), `${forbidden} is both target and forbidden`);
  }
});

test("PT-151-025: the reader inputs carry their bounds and read-only rule", () => {
  const inputs = readClosedSets().proposedByFeature.find((e) => e.id === "kanban-reader-inputs") as {
    bounds: Record<string, number>;
    rule: string;
  };
  assert.deepEqual(inputs.bounds, { eventTailBytes: 8388608, jsonRecordBytes: 262144, tasksMdBytes: 2097152 });
  assert.match(inputs.rule, /read-only/);
});
