/**
 * The session-log eval driver of the Hermes host (T068, research R11,
 * F150-FR-046): per case it makes a temporary `HERMES_HOME` holding only the
 * skill under test, runs
 *
 *     hermes chat --query-file - --format stream-json -t skills
 *
 * with the case prompt on stdin, stops at the first `skill_view` result, and
 * grades the recorded log with `src/evals/grader.ts`. The baseline of a case
 * is the same prompt against an empty skill root: a prompt that loads the
 * skill without it installed is not a trigger case, so the case is refused.
 *
 * The driver calls a model and is therefore a PAID task of the host, started
 * by a person (F150-FR-047): it refuses under `CI`, takes the model ids from
 * the run configuration (never from the suite file), prints the
 * person-started line that names what is logged, and appends one
 * `PaidRunRecord` of the kit to the run log.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RunRefusedError,
  appendRunRecord,
  modelIdsFromConfiguration,
  skillTextsHashOf,
} from "@specstride/host-kit/evals";
import type { PaidRunRecord, SkillResult } from "@specstride/host-kit/evals";
import type { TriggerSuiteFile } from "@specstride/host-kit/evals";
import { gradeSessionLog } from "./grader.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, "..", "..");

/** The paid task names of this host: the model-invocable skills. */
export const PAID_TASK_NAMES: readonly string[] = [
  "specstride-run",
  "specstride-reverse",
  "specstride-status",
  "specstride-curate",
];

/** The chat invocation of a case, fixed by the contract (F150-FR-046). */
export const CHAT_ARGV: readonly string[] = [
  "chat",
  "--query-file",
  "-",
  "--format",
  "stream-json",
  "-t",
  "skills",
];

/** The line the driver prints: what a run logs, so a person can file it. */
export const PERSON_STARTED_LINE =
  "person-started task: logs date, model ids, calls, cost, skill-text hash";

/** One case of a run: the recorded grade, plus the baseline outcome. */
export type CaseOutcome = {
  readonly id: string;
  readonly expected: string | null;
  readonly baselineLoaded: string | null;
  readonly grade: ReturnType<typeof gradeSessionLog>;
};

/** Run one case: hermes chat in a temp HERMES_HOME, stopped at the first skill_view. */
export async function runCaseSession(
  prompt: string,
  options: {
    readonly hermesBin: string;
    readonly home: string;
    readonly cwd: string;
    readonly timeoutMs?: number;
  },
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(options.hermesBin, [...CHAT_ARGV], {
      cwd: options.cwd,
      env: { ...process.env, HERMES_HOME: options.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let log = "";
    let settled = false;
    const timer = setTimeout(
      () => {
        child.kill("SIGTERM");
      },
      options.timeoutMs ?? 120_000,
    );
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // Stop at the first skill_view result: nothing after it is graded.
      if (/"name"\s*:\s*"skill_view"/.test(buffer)) {
        log += buffer;
        child.kill("SIGTERM");
        finish(log);
        return;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      log += lines.length > 0 ? lines.join("\n") + "\n" : "";
    });
    child.on("close", () => finish(log + buffer));
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.end(prompt + "\n");
  });
}

/** The sha256 of the skill texts a run measured, in the order of the suites. */
export function skillTextsHashOfPackage(root: string = PACKAGE_ROOT): string {
  const directory = join(root, "skills", "specstride");
  const names = readdirSync(directory).sort();
  return skillTextsHashOf(names.map((name) => readFileSync(join(directory, name, "SKILL.md"), "utf8")));
}

/** Make a temporary HERMES_HOME holding only the given skills (or none). */
export function makeTempHome(
  root: string,
  skills: readonly string[],
): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "specstride-eval-home-"));
  const target = join(home, "skills", "specstride");
  mkdirSync(target, { recursive: true });
  for (const skill of skills) {
    const source = join(root, "skills", "specstride", skill);
    if (!existsSync(source)) {
      rmSync(home, { recursive: true, force: true });
      throw new RunRefusedError(`the built tree holds no skill ${skill}; run npm run build first`);
    }
    cpSync(source, join(target, skill), { recursive: true });
  }
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** One run of one suite: the options a person gives on the command line. */
export type SuiteRunOptions = {
  readonly lane: "paid" | "local";
  readonly modelIds: readonly string[];
  readonly hermesBin?: string;
  readonly calls?: number;
  readonly cost?: string;
};

/** Run one suite file: per case a session and its baseline, then the record. */
export async function runSuite(
  suitePath: string,
  options: SuiteRunOptions,
  root: string = PACKAGE_ROOT,
): Promise<{ reports: readonly string[]; record: PaidRunRecord }> {
  // A run under CI is refused before any call (F150-FR-047): a person starts it.
  if (process.env.CI !== undefined && process.env.CI !== "") {
    throw new RunRefusedError("the eval driver is a paid task: it refuses under CI");
  }
  // The model comes from the run configuration, never from the suite file.
  const modelIds = modelIdsFromConfiguration({ modelIds: options.modelIds });
  const suite = JSON.parse(readFileSync(suitePath, "utf8")) as TriggerSuiteFile;
  const hermesBin = options.hermesBin ?? "hermes";
  const hash = skillTextsHashOfPackage(root);

  const withSkill = makeTempHome(root, [suite.skill]);
  const empty = makeTempHome(root, []);
  const reports: string[] = [];
  const scores: number[] = [];
  const runsNotScored: { skill: string; reason: "interrupted" | "usage-limit" | "not-started" }[] = [];
  let matched = 0;
  let scored = 0;
  try {
    for (const entry of suite.cases) {
      const expected = entry.expected;
      // The baseline: the same prompt against an empty skill root.
      const baselineLog = await runCaseSession(entry.prompt, {
        hermesBin,
        home: empty.home,
        cwd: empty.home,
      });
      const baselineLoaded =
        gradeSessionLog(baselineLog, null).outcome === "matched"
          ? null
          : gradeSessionLog(baselineLog, suite.skill).outcome === "matched"
            ? suite.skill
            : null;
      const log = await runCaseSession(entry.prompt, {
        hermesBin,
        home: withSkill.home,
        cwd: withSkill.home,
      });
      const grade = gradeSessionLog(log, expected);
      const outcome: CaseOutcome = {
        id: entry.id,
        expected,
        baselineLoaded,
        grade,
      };
      reports.push(
        `${entry.id} expected=${String(expected)} loaded=${String(outcome.grade.outcome === "not-scored" ? "(run not scored)" : outcome.grade.loaded)} baseline=${String(baselineLoaded)} -> ${outcome.grade.outcome}${outcome.grade.outcome === "not-scored" ? ` (${outcome.grade.reason})` : ""}`,
      );
      const loaded = outcome.grade.outcome === "not-scored" ? null : outcome.grade.loaded;
      const ok = outcome.grade.outcome === "matched" && baselineLoaded === null;
      if (outcome.grade.outcome === "not-scored") {
        const reason = outcome.grade.reason.includes("interrupted")
          ? "interrupted"
          : outcome.grade.reason.includes("usage limit")
            ? "usage-limit"
            : "not-started";
        runsNotScored.push({ skill: suite.skill, reason });
        continue;
      }
      scored += 1;
      if (ok) matched += 1;
    }
  } finally {
    withSkill.cleanup();
    empty.cleanup();
  }
  const score = scored === 0 ? 0 : matched / scored;
  const resultPerSkill: SkillResult[] = [
    { skill: suite.skill, scores: [score], scored: runsNotScored.length === 0 },
  ];
  const record: PaidRunRecord = {
    date: new Date().toISOString().slice(0, 10),
    task: suite.skill,
    modelIds: [...modelIds],
    calls: options.calls ?? suite.cases.length,
    cost: options.cost ?? "not recorded",
    skillTextsHash: hash,
    resultPerSkill,
    runsNotScored,
  };
  return { reports, record };
}

/**
 * The port's `evalDriver.run` (annex H §H.1, T021/T068): the same session
 * runner over the port's own case shape (`{id, prompt, expected}`). Like the
 * paid lane it calls a model, so it refuses under CI and without a model in
 * the run configuration — never pretending to have run.
 */
export async function runPortCases(
  suite: readonly { readonly id: string; readonly prompt: string; readonly expected: string }[],
  options: SuiteRunOptions,
  root: string = PACKAGE_ROOT,
): Promise<readonly { readonly id: string; readonly matched: boolean; readonly detail: string }[]> {
  if (process.env.CI !== undefined && process.env.CI !== "") {
    throw new RunRefusedError("the eval driver is a paid task: it refuses under CI");
  }
  modelIdsFromConfiguration({ modelIds: options.modelIds });
  const hermesBin = options.hermesBin ?? "hermes";
  const results: { id: string; matched: boolean; detail: string }[] = [];
  for (const entry of suite) {
    const skills =
      entry.expected !== "" && PAID_TASK_NAMES.includes(entry.expected) ? [entry.expected] : [];
    const temp = makeTempHome(root, skills);
    try {
      const log = await runCaseSession(entry.prompt, {
        hermesBin,
        home: temp.home,
        cwd: temp.home,
      });
      const grade = gradeSessionLog(log, entry.expected === "" ? null : entry.expected);
      results.push({
        id: entry.id,
        matched: grade.outcome === "matched",
        detail:
          grade.outcome === "not-scored" ? `not scored: ${grade.reason}` : `loaded ${String(grade.loaded)}`,
      });
    } finally {
      temp.cleanup();
    }
  }
  return results;
}

/** The result the control CLI prints and exits with. */
export type CliResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exit: number;
};

function usage(): string {
  return (
    "usage: specstride-host-hermes eval <suite.json> --lane paid|local --model <id[,id…]> " +
    "[--hermes <bin>] [--calls <n>] [--cost <c>] [--project <dir>]\n" +
    "       the driver is a paid task: a person starts it, never the build (F150-FR-047)\n"
  );
}

/** The `eval` command of the control CLI (T068). */
export async function runEval(argv: readonly string[]): Promise<CliResult> {
  let suitePath: string | undefined;
  let lane: string | undefined;
  let model: string | undefined;
  let hermesBin: string | undefined;
  let calls: number | undefined;
  let cost: string | undefined;
  let root = PACKAGE_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--lane") lane = argv[++i];
    else if (a === "--model") model = argv[++i];
    else if (a === "--hermes") hermesBin = argv[++i];
    else if (a === "--calls") calls = Number.parseInt(argv[++i] ?? "", 10);
    else if (a === "--cost") cost = argv[++i];
    else if (a === "--project") root = argv[++i];
    else if (!a.startsWith("--") && suitePath === undefined) suitePath = a;
    else return { stdout: "", stderr: usage(), exit: 3 };
  }
  if (process.env.CI !== undefined && process.env.CI !== "") {
    return {
      stdout: "",
      stderr: "specstride-host-hermes: eval is a paid task and refuses under CI (F150-FR-047)\n",
      exit: 3,
    };
  }
  if (suitePath === undefined || (lane !== "paid" && lane !== "local")) {
    return { stdout: "", stderr: usage(), exit: 3 };
  }
  const lanesFile = join(root, "evals", "suites", "lanes.json");
  if (existsSync(lanesFile)) {
    const lanes = JSON.parse(readFileSync(lanesFile, "utf8")) as {
      paid: { releaseCheck: boolean };
      local: { audience: string; releaseCheck: boolean };
    };
    if (lane === "local" && lanes.local.audience !== "personal") {
      return { stdout: "", stderr: "specstride-host-hermes: the local lane is not the personal lane\n", exit: 3 };
    }
  }
  const modelIds = (model ?? "").split(",").map((id) => id.trim()).filter((id) => id !== "");
  try {
    modelIdsFromConfiguration({ modelIds });
  } catch (error) {
    return {
      stdout: "",
      stderr: `specstride-host-hermes: ${(error as Error).message}\n`,
      exit: 3,
    };
  }
  if (!existsSync(suitePath)) {
    return { stdout: "", stderr: `specstride-host-hermes: no suite at ${suitePath}\n`, exit: 3 };
  }
  let run;
  try {
    run = await runSuite(suitePath, { lane, modelIds, hermesBin, calls, cost }, root);
  } catch (error) {
    return { stdout: "", stderr: `specstride-host-hermes: ${(error as Error).message}\n`, exit: 3 };
  }
  const logPath = join(root, "evals", "probe-results", "run-log.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  const written = appendRunRecord(logPath, run.record);
  const hashShort = run.record.skillTextsHash.slice(0, 12);
  const stdout =
    `${PERSON_STARTED_LINE}\n` +
    run.reports.join("\n") +
    `\nskill-text hash ${hashShort}\nrecord appended to ${written}\n`;
  return { stdout, stderr: "", exit: 0 };
}
