/**
 * The trigger-suite tests (T065, PT-150-047, PT-150-048): every suite under
 * `evals/suites/` holds at least 6 positive and 6 negative cases, the
 * confusable run/reverse pair is present, the tools are restricted to
 * `skills` (no case can launch), no suite file holds a model id, and the
 * local lane is tagged `audience: personal` and is never referenced by a
 * release check. All checks read files; none calls a model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  staticCheckOf,
  containsModelId,
  staticCheckPasses,
} from "@specstride/host-kit/evals";
import type { TriggerSuiteFile, FreeGraderFile } from "@specstride/host-kit/evals";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SUITES = join(ROOT, "evals", "suites");

const MODEL_INVOCABLE = ["specstride-run", "specstride-status", "specstride-curate", "specstride-reverse"];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function suiteFiles(): Map<string, TriggerSuiteFile> {
  const files = new Map<string, TriggerSuiteFile>();
  for (const name of readdirSync(SUITES)) {
    if (name.endsWith(".suite.json")) {
      files.set(name.replace(/\.suite\.json$/, ""), readJson(join(SUITES, name)) as TriggerSuiteFile);
    }
  }
  return files;
}

// The host's static rules (F150-FR-047): the minimums, the confusable pair,
// what marks a suite-runner start in a build job, and the requirement ids.
const rules = {
  positiveCasesPerSkill: 6,
  negativeCasesPerSkill: 6,
  confusablePair: "run/reverse",
  suiteRunnerMarkers: [/specstride-host-hermes\s+eval/, /--lane\s+(?:paid|local)/],
  requirementIds: {
    suiteCases: "F150-FR-047",
    noModelId: "F150-FR-047",
    buildNoSuiteRunner: "F150-FR-043",
  },
} as const;

test("every model-invocable skill has a suite with at least 6 positive and 6 negative cases", () => {
  const suites = suiteFiles();
  for (const skill of MODEL_INVOCABLE) {
    const suite = suites.get(skill);
    assert.ok(suite, `missing suite for ${skill}`);
    const positive = suite.cases.filter((c) => c.kind === "positive");
    const negative = suite.cases.filter((c) => c.kind === "negative" || c.kind === "cross-skill");
    assert.ok(positive.length >= 6, `${skill}: ${positive.length} positive cases`);
    assert.ok(negative.length >= 6, `${skill}: ${negative.length} negative cases`);
    for (const c of positive) assert.equal(c.expected, skill, `${c.id} expects the suite's skill`);
    for (const c of negative) assert.equal(c.expected, null, `${c.id} expects no skill`);
  }
});

test("the confusable run/reverse pair is present in both suites", () => {
  const suites = suiteFiles();
  const runCase = suites.get("specstride-run")!.cases.find((c) => c.confusablePair === "run/reverse");
  const reverseCase = suites
    .get("specstride-reverse")!
    .cases.find((c) => c.confusablePair === "run/reverse");
  assert.ok(runCase, "the run suite lacks the confusable pair");
  assert.ok(reverseCase, "the reverse suite lacks the confusable pair");
  assert.match(runCase.prompt, /reverse/i);
  assert.match(reverseCase.prompt, /\brun/i);
});

test("the tools of every suite are restricted to skills, so no case can launch", () => {
  const graders = readJson(join(SUITES, "graders.json")) as FreeGraderFile & {
    toolsets?: readonly string[];
  };
  // The driver runs every case with `hermes chat -t skills` (F150-FR-046).
  assert.deepEqual(graders.toolsets, ["skills"]);
  // The kit's restriction: no tool at all is allowed, launch is impossible.
  assert.deepEqual(graders.toolRestriction?.allowedTools, []);
  assert.ok(graders.toolRestriction?.deniedTools?.includes("terminal"));
  assert.equal(graders.toolRestriction?.launchImpossible, true);
  for (const [name, grader] of Object.entries(graders.graders ?? {})) {
    assert.equal(grader.kind, "free", `${name}`);
    assert.equal(grader.modelJudge, false, `${name}`);
  }
});

test("no suite file holds a model id (the model comes from the run configuration)", () => {
  const suites = suiteFiles();
  const graders = readJson(join(SUITES, "graders.json"));
  for (const [name, suite] of suites) {
    assert.equal(containsModelId(suite), false, `${name} hides a model id`);
  }
  assert.equal(containsModelId(graders), false, "graders.json hides a model id");
  const pattern =
    /\b(gpt-|claude-|gemini-|deepseek|llama|qwen|mistral|anthropic|openai|o[13]-)/i;
  for (const name of readdirSync(SUITES)) {
    const text = readFileSync(join(SUITES, name), "utf8");
    assert.doesNotMatch(text, pattern, `${name} names a model`);
  }
});

test("the kit static check passes over the suite files, the graders and the build jobs", () => {
  const check = staticCheckOf(rules);
  const suites = [...suiteFiles().values()];
  const graders = readJson(join(SUITES, "graders.json")) as FreeGraderFile;
  const findings = check.checkSuiteFiles(suites, graders);
  const failures = findings.filter((f) => !f.ok);
  assert.deepEqual(failures, [], failures.map((f) => `${f.check}: ${f.detail}`).join("\n"));
  const jobs = [
    ...Object.entries(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts).map(
      ([script, command]) => ({
        declaredIn: `package.json script "${script}"`,
        command: command as string,
      }),
    ),
    ...readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
      .split("\n")
      .filter((line) => line.includes("run:"))
      .map((line, i) => ({ declaredIn: `.github/workflows/ci.yml step ${i + 1}`, command: line })),
  ];
  assert.deepEqual(check.jobsThatStartTheSuiteRunner(jobs), []);
});

test("the local lane is tagged audience personal and is never a release check", () => {
  const lanes = readJson(join(SUITES, "lanes.json")) as {
    local: { audience: string; releaseCheck: boolean };
    paid: { audience: string; releaseCheck: boolean };
  };
  assert.equal(lanes.local.audience, "personal");
  assert.equal(lanes.local.releaseCheck, false);
  assert.equal(lanes.paid.releaseCheck, true);
});

test("no release check references the local lane", () => {
  const packageJson = readFileSync(join(ROOT, "package.json"), "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  for (const [name, text] of [["package.json", packageJson], [".github/workflows/ci.yml", ci]]) {
    assert.doesNotMatch(text, /--lane\s+local/, `${name} starts the local lane`);
  }
});
