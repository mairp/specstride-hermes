/**
 * The kanban values generator (T007): reads
 * `contracts/151-hermes-kanban/closed-sets.json` — the one machine-readable
 * file of every closed set of feature 151 — and writes
 * `src/kanban/generated/closed-sets.ts` deterministically: keys in stable
 * (sorted) order, a newline at the end, no other content. The build runs it
 * before the rest of `scripts/build.ts`, and
 * `tests/contract/kanban-closed-sets.test.ts` holds the committed file
 * byte-equal to a fresh generation.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as pathDirname } from "node:path";

const HERE = pathDirname(fileURLToPath(import.meta.url));
export const CLOSED_SETS_JSON = join(HERE, "..", "contracts", "151-hermes-kanban", "closed-sets.json");
export const GENERATED_TS = join(HERE, "..", "src", "kanban", "generated", "closed-sets.ts");

/** JSON text with every object's keys sorted, so the output is stable. */
function canonical(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  const padInner = "  ".repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((item) => padInner + canonical(item, indent + 1)).join(",\n") + "\n" + pad + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return "{}";
    return (
      "{\n" +
      entries.map(([key, item]) => `${padInner}${JSON.stringify(key)}: ${canonical(item, indent + 1)}`).join(",\n") +
      "\n" + pad + "}"
    );
  }
  return JSON.stringify(value);
}

export type ClosedSetsJson = {
  $schema: string;
  feature: string;
  date: string;
  note: string;
  consumedFromEngine: { set: string; members: string[]; [key: string]: unknown }[];
  consumedFromHermes: { set: string; members: string[]; [key: string]: unknown }[];
  proposedByFeature: { id: string; [key: string]: unknown }[];
};

export function readClosedSets(path = CLOSED_SETS_JSON): ClosedSetsJson {
  return JSON.parse(readFileSync(path, "utf8")) as ClosedSetsJson;
}

function setMembers(sets: { set: string; members: unknown }[], name: string): string[] {
  const entry = sets.find((s) => s.set === name);
  if (!entry) throw new Error(`closed-sets.json holds no set "${name}"`);
  return entry.members as string[];
}

function proposed(json: ClosedSetsJson, id: string): Record<string, unknown> {
  const entry = json.proposedByFeature.find((e) => e.id === id);
  if (!entry) throw new Error(`closed-sets.json holds no set "${id}"`);
  return entry as Record<string, unknown>;
}

/** The generated module text, as a pure function of the parsed JSON. */
export function generateClosedSetsModule(json: ClosedSetsJson): string {
  const engine = (name: string) => setMembers(json.consumedFromEngine, name);
  const hermes = (name: string) => setMembers(json.consumedFromHermes, name);

  const lanes = engine("lanes");
  const runStates = engine("run-states");
  const attentionKinds = engine("attention-kinds");
  const budgetLevels = engine("budget-levels");
  const derivedRunConditions = engine("derived-run-conditions");
  const targetColumns = hermes("target-columns");
  const forbiddenColumns = hermes("forbidden-columns");
  const themeTokens = hermes("theme-tokens");
  const sdkMembers = hermes("sdk-members");

  const presentation = [
    "kanban-lane-presentation",
    "kanban-attention-presentation",
    "kanban-budget-presentation",
    "kanban-task-presentation",
    "kanban-alive-presentation",
    "kanban-outcome-presentation",
    "kanban-launch-presentation",
  ].map((id) => proposed(json, id));

  const namedExports: [string, unknown][] = [
    ["closedSetLanes", lanes],
    ["closedSetRunStates", runStates],
    ["closedSetAttentionKinds", attentionKinds],
    ["closedSetBudgetLevels", budgetLevels],
    ["closedSetDerivedRunConditions", derivedRunConditions],
    ["closedSetTargetColumns", targetColumns],
    ["closedSetForbiddenColumns", forbiddenColumns],
    ["closedSetThemeTokens", themeTokens],
    ["closedSetSdkMembers", sdkMembers],
    ["closedSetViewSources", proposed(json, "kanban-view-sources").members],
    ["closedSetApiAnswers", proposed(json, "kanban-api-answers").members],
    ["closedSetReaderInputs", proposed(json, "kanban-reader-inputs")],
    ["closedSetLaneRules", proposed(json, "kanban-reader-lane-rules")],
    ["closedSetLiveLanes", proposed(json, "kanban-reader-live-lanes")],
    ["closedSetEndRules", proposed(json, "kanban-reader-end-rules")],
    ["closedSetLaunchStates", proposed(json, "kanban-launch-states").members],
    ["closedSetSignatureMembers", proposed(json, "kanban-signature-members")],
    ["closedSetEngineMemo", proposed(json, "kanban-engine-memo")],
    ["closedSetInspectorSections", proposed(json, "kanban-inspector-sections")],
    ["closedSetDetailBounds", proposed(json, "kanban-detail-bounds")],
    ["closedSetNeverInAView", proposed(json, "kanban-never-in-a-view").members],
    ["closedSetNotSaidTexts", proposed(json, "kanban-not-said-texts")],
    ["closedSetStrip", proposed(json, "kanban-strip")],
    ["closedSetWindow", proposed(json, "kanban-window")],
    ["closedSetDoctorFacts", proposed(json, "kanban-doctor-facts")],
    ["closedSetScanRules", proposed(json, "kanban-scan-rules")],
    ["lanePresentation", proposed(json, "kanban-lane-presentation")],
    ["attentionPresentation", proposed(json, "kanban-attention-presentation")],
    ["budgetPresentation", proposed(json, "kanban-budget-presentation")],
    ["taskPresentation", proposed(json, "kanban-task-presentation")],
    ["alivePresentation", proposed(json, "kanban-alive-presentation")],
    ["outcomePresentation", proposed(json, "kanban-outcome-presentation")],
    ["launchPresentation", proposed(json, "kanban-launch-presentation")],
  ];

  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(` * Generated by scripts/gen-kanban-values.ts from contracts/151-hermes-kanban/closed-sets.json`);
  lines.push(` * (feature ${json.feature}, recorded ${json.date}). Held byte-equal to a fresh`);
  lines.push(" * generation by tests/contract/kanban-closed-sets.test.ts (PT-151-025).");
  lines.push(" */");
  lines.push("");
  lines.push("/** The closed-sets document itself, keys in stable sorted order. */");
  lines.push("export const closedSets = " + canonical(json, 0) + " as const;");
  lines.push("");
  for (const [name, value] of namedExports) {
    lines.push(`export const ${name} =`);
    lines.push("  " + canonical(value, 0) + ";");
    lines.push("");
  }
  lines.push("export type LaneName = (typeof closedSetLanes)[number];");
  lines.push("export type RunStateName = (typeof closedSetRunStates)[number];");
  lines.push("export type AttentionKind = (typeof closedSetAttentionKinds)[number];");
  lines.push("export type TargetColumn = (typeof closedSetTargetColumns)[number];");
  lines.push("export type ThemeToken = (typeof closedSetThemeTokens)[number];");
  lines.push("export type LaunchState = (typeof closedSetLaunchStates)[number];");
  lines.push("");
  return lines.join("\n") + "\n";
}

/** Generate and write the committed file. Returns the text written. */
export function writeGeneratedClosedSets(): string {
  const text = generateClosedSetsModule(readClosedSets());
  mkdirSync(pathDirname(GENERATED_TS), { recursive: true });
  writeFileSync(GENERATED_TS, text);
  return text;
}

export function main(): void {
  const text = writeGeneratedClosedSets();
  console.log(`gen-kanban-values: wrote src/kanban/generated/closed-sets.ts (${Buffer.byteLength(text)} bytes)`);
}
