/**
 * The deterministic reconciliation of the Spec Kit corpus (T051, F150-FR-033,
 * PT-150-033): a TypeScript port of the original host's
 * `scripts/reconcile-specs.sh` (research R14), exposed as
 * `specstride-host-hermes curate reconcile [--dry-run] [--feature <prefix>]`.
 *
 * The steps are the original script's, in the same order:
 *   1. backup — copy `specs/` to `<project>/.specstride/backups/<stamp>/`
 *      (the run log lives inside the backup directory; the ONLY writes
 *      outside `specs/` are inside it), once per invocation, before any
 *      write to the corpus;
 *   2. cross-artifact checks per feature — (a) test names in spec.md appear
 *      in tasks.md, (b) leftover markers, (c) dangling cross-feature refs,
 *      (d) Status/Created header fields, (e) analyze-report.md presence,
 *      plus the core spec/plan/tasks artifacts;
 *   3. the corpus summary `specs/RECONCILIATION.md` (regenerated, atomic);
 *   4. append-only per-feature logs `specs/<feature>/reconciliation.md`.
 *
 * No model call, no network, no subprocess: pure file reads and writes
 * (Principle VI; the curate skill calls this command, never a script). A
 * `--dry-run` runs every check and writes nothing. Exit 1 when any check
 * failed, 0 otherwise; a usage error exits 3.
 */
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ReconcileResult = { readonly exit: number; readonly stdout: string; readonly stderr: string };

/** The root the corpus lives in: `SPECSTRIDE_PROJECT`, else the git root of the cwd. */
function projectRoot(): string {
  const fromEnv = process.env.SPECSTRIDE_PROJECT;
  if (fromEnv) return resolve(fromEnv);
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export type ParsedReconcile = {
  readonly dryRun: boolean;
  readonly featureFilter: string;
  /** The `--project <dir>` seam of the dispatcher, when given before the command. */
  readonly projectOverride?: string;
  readonly usageError?: string;
};

/** Parse `reconcile [--dry-run] [--feature <prefix>]`; anything else is a usage error. */
export function parseReconcileArgs(argv: readonly string[]): ParsedReconcile {
  const rest = [...argv];
  let projectOverride: string | undefined;
  // The dispatcher's seam (`--project <dir>` BEFORE the command) and the
  // command word itself are both stripped before the flags.
  while (
    rest[0] === "curate" ||
    (rest[0] === "--project" && rest.length > 2 && ["curate", "reconcile"].includes(rest[2] ?? ""))
  ) {
    if (rest[0] === "--project") {
      projectOverride = rest[1];
      rest.splice(0, 2);
    } else rest.splice(0, 1);
  }
  if (rest[0] === "reconcile") rest.shift();
  let dryRun = false;
  let featureFilter = "";
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--dry-run") dryRun = true;
    else if (rest[i] === "--feature") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) return { dryRun, featureFilter, usageError: "--feature needs a prefix" };
      featureFilter = value;
      i += 1;
    } else return { dryRun, featureFilter, usageError: `unknown arg: ${rest[i]}` };
  }
  return { dryRun, featureFilter, projectOverride };
}

/** An atomic write: temp file plus rename in the target directory. */
function atomicWrite(path: string, text: string): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, path);
}

/** Leftover markers, check (b): the original script's exact set. */
const MARKER_PATTERN = /\[NEEDS CLARIFICATION\]|TODO|TKTK|\?\?\?|<placeholder>/;
/** Test names, check (a): `PT-NNN-…` and `FX-NN(N)`, exactly the script's pattern. */
const TEST_NAME_PATTERN = /\b(PT-\d{3}(-[A-Za-z0-9-]+)+|FX-\d{2,3})\b/;
/** Cross-feature references, check (c). */
const FEATURE_REF_PATTERN = /specs\/(\d{3}-[a-z0-9-]+)/g;

type FeatureReport = {
  readonly name: string;
  readonly checks: number;
  readonly fails: number;
  readonly notes: readonly string[];
  readonly logLines: readonly string[];
};

/** The checks of one feature directory — the script's checks in its order. */
function checkFeature(dir: string, specsDir: string, log: (line: string) => void): FeatureReport {
  const name = dir.split("/").pop() ?? dir;
  let checks = 0;
  let fails = 0;
  const notes: string[] = [];
  const logLines: string[] = [];
  const fail = (note: string, detail?: string) => {
    fails += 1;
    notes.push(note);
    if (detail !== undefined) log(detail);
    logLines.push(`- FAIL: ${note}`);
  };

  const spec = join(dir, "spec.md");
  const plan = join(dir, "plan.md");
  const tasks = join(dir, "tasks.md");
  const report = join(dir, "analyze-report.md");

  // Prerequisite: core artifacts exist.
  checks += 1;
  if (!fs.existsSync(spec) || !fs.existsSync(plan) || !fs.existsSync(tasks)) {
    fail("MISSING core artifact (spec/plan/tasks)");
  }

  if (fs.existsSync(spec) && fs.existsSync(tasks)) {
    const specText = fs.readFileSync(spec, "utf8");
    const tasksText = fs.readFileSync(tasks, "utf8");

    // (a) every test name in spec.md appears in tasks.md; table rows of the
    // spec are excluded, FX- names may be defined anywhere in the feature dir.
    checks += 1;
    const nonTable = specText
      .split("\n")
      .filter((line) => !/^\s*\|/.test(line))
      .join("\n");
    const names = [...new Set(nonTable.match(TEST_NAME_PATTERN) ?? [])].sort();
    let missing = 0;
    for (const testName of names) {
      const held =
        tasksText.includes(testName) ||
        (testName.startsWith("FX-") && directoryContains(dir, testName)) ||
        directoryContains(specsDir, testName);
      if (!held) {
        missing += 1;
        log(`    missing task for test: ${testName}`);
      }
    }
    if (missing > 0) fail(`${missing} test name(s) in spec.md lack a tasks.md reference`);

    // (b) leftover markers.
    checks += 1;
    const corpus = [spec, plan, tasks];
    let markers = 0;
    for (const file of corpus) {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (MARKER_PATTERN.test(line)) markers += 1;
      }
    }
    if (markers > 0) fail(`${markers} unresolved marker line(s) (NEEDS CLARIFICATION/TODO/...)`);

    // (c) cross-feature references resolve to real directories.
    checks += 1;
    const refs = new Set<string>();
    for (const file of [spec, plan, tasks]) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(FEATURE_REF_PATTERN)) refs.add(match[1]!);
    }
    let dangling = 0;
    for (const ref of [...refs].sort()) {
      if (!fs.existsSync(join(specsDir, ref))) {
        dangling += 1;
        log(`    dangling feature ref: ${ref}`);
      }
    }
    if (dangling > 0) fail(`${dangling} dangling cross-feature reference(s)`);

    // (d) header fields.
    checks += 1;
    if (!/^\*\*Status\*\*/m.test(specText) || !/^\*\*Created\*\*/m.test(specText)) {
      fail("spec.md missing Status/Created header field");
    }
  }

  // (e) analyze-report exists.
  checks += 1;
  if (!fs.existsSync(report)) fail("no analyze-report.md");

  return { name, checks, fails, notes, logLines };
}

/** True when any file under `dir` contains `needle` (the script's `grep -rqF`). */
function directoryContains(dir: string, needle: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (directoryContains(path, needle)) return true;
    } else {
      try {
        if (fs.readFileSync(path, "utf8").includes(needle)) return true;
      } catch {
        // An unreadable file holds nothing.
      }
    }
  }
  return false;
}

/** List the feature directories of `specs/`, sorted, filtered by the prefix. */
function featureDirs(specsDir: string, filter: string): readonly string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(specsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => filter === "" || name.startsWith(filter))
    .sort()
    .map((name) => join(specsDir, name));
}

/** Run `curate reconcile`: backup → checks → summary → per-feature logs. */
export function run(argv: readonly string[]): ReconcileResult {
  const parsed = parseReconcileArgs(argv);
  if (parsed.usageError !== undefined) {
    return { exit: 3, stdout: "", stderr: `specstride-host-hermes curate: ${parsed.usageError}\n` };
  }
  const root = parsed.projectOverride !== undefined ? resolve(parsed.projectOverride) : projectRoot();
  const specsDir = join(root, "specs");
  if (!fs.existsSync(specsDir)) {
    return { exit: 1, stdout: "", stderr: `specstride-host-hermes curate: no specs/ under ${root}\n` };
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runId = `reconcile-${stamp}`;
  const backupDir = join(root, ".specstride", "backups", stamp);
  const logPath = join(backupDir, "reconcile.log");
  const logLines: string[] = [];
  const log = (line: string) => {
    logLines.push(line);
  };

  // ---------- 1. backup (before any write; dry-run writes nothing) ----------
  if (!parsed.dryRun) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.cpSync(specsDir, join(backupDir, "specs"), { recursive: true });
    log(`backup written: ${join(backupDir, "specs")}`);
  } else {
    log("dry-run: no backup, no writes");
  }

  const dirs = featureDirs(specsDir, parsed.featureFilter);
  const reports: FeatureReport[] = [];
  let totalChecks = 0;
  let totalFails = 0;
  for (const dir of dirs) {
    const report = checkFeature(dir, specsDir, log);
    reports.push(report);
    totalChecks += report.checks;
    totalFails += report.fails;
    log(`${report.name}: ${report.fails === 0 ? "OK" : `FAIL(${report.fails})`} ${report.notes.join(" ")}`.trimEnd());
  }

  if (parsed.dryRun) {
    const summary =
      `dry-run: ${dirs.length} features, ${totalChecks} checks, ${totalFails} failures — no backup, no writes\n`;
    return { exit: totalFails === 0 ? 0 : 1, stdout: summary + logLines.join("\n") + "\n", stderr: "" };
  }

  // ---------- corpus summary (regenerated, atomic) ----------
  const rows = reports.map(
    (r) => `| ${r.name} | ${r.checks} | ${r.fails} | ${r.notes.length > 0 ? r.notes.join(" ") : "- "} |`,
  );
  const summaryText = [
    "# Spec corpus reconciliation",
    "",
    `Run: \`${runId}\` — deterministic checks by \`specstride-host-hermes curate reconcile\`.`,
    "Semantic curation (the retargeting rules of the curate skill) is applied by the curation",
    "agents and logged per feature in `specs/<feature>/reconciliation.md`.",
    "",
    `Corpus: ${reports.length} features, ${totalChecks} checks, ${totalFails} failures.`,
    "",
    "| Feature | Checks | Failures | Notes |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  atomicWrite(join(specsDir, "RECONCILIATION.md"), summaryText);

  // ---------- per-feature append-only logs ----------
  for (const report of reports) {
    const entry = [
      `## ${runId}`,
      `- deterministic reconcile run (${report.checks} checks, ${report.fails} failures)`,
      ...report.logLines.map((line) => `  ${line.trim()}`),
      "- see corpus summary: specs/RECONCILIATION.md",
      "",
    ].join("\n");
    const logFile = join(specsDir, report.name, "reconciliation.md");
    const previous = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    atomicWrite(logFile, previous + (previous.endsWith("\n") || previous === "" ? "" : "\n") + entry);
  }
  fs.appendFileSync(logPath, logLines.join("\n") + "\n");

  const summary = `Reconciliation complete: ${reports.length} features / ${totalChecks} checks / ${totalFails} failures\n` +
    `Summary: ${join(specsDir, "RECONCILIATION.md")}  Backup: ${backupDir}\n`;
  return { exit: totalFails === 0 ? 0 : 1, stdout: summary, stderr: "" };
}
