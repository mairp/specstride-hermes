/**
 * The installer of the Hermes host (T029, contracts/150-host-hermes/
 * installer-cli.md, F150-FR-021 to F150-FR-024, F150-FR-031): the `install`
 * and `uninstall` commands of `specstride-host-hermes`, their three scopes,
 * the roots each scope writes, the per-root install record with sha256 per
 * file, the outcome table (fresh write, `already installed, unchanged`,
 * `refuse <path> — changed since install`, `refuse <dir> — no install record
 * describes it`), the reverse gating through the shim's resolution steps
 * (F150-FR-031), and the plugin enable/disable that only the `profile` scope
 * runs — every other scope prints the Hermes command (F150-FR-022,
 * F150-FR-023).
 *
 * The installer writes ONLY inside the roots its scope names, never touches
 * `config.yaml`, never installs or updates the CLI or Hermes, and always
 * evaluates every root before it writes any of them, so a refusal leaves the
 * previous install byte for byte in place. Each root gets its own record,
 * written last and atomically; `uninstall` removes recorded files whose hash
 * still matches, keeps and names the changed ones, prunes the emptied
 * directories and removes the record last — the last filesystem removal of an
 * uninstall is always the record file itself.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { MISSING_CLI_COMMAND } from "@specstride/host-kit";

export type CliResult = { readonly exit: number; readonly stdout: string; readonly stderr: string };

/** The record file, one per installed root (dsh's schema, renamed). */
export const RECORD_NAME = ".specstride-host-hermes-install.json";

/** The schema id of the install record. */
const RECORD_SCHEMA = "specstride.install-record/1";

/** The directory of this package: the source of the built skills and plugin. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The built directories the installer copies from. */
const SKILLS_SOURCE = join(PACKAGE_ROOT, "skills", "specstride");
const PLUGIN_SOURCE = join(PACKAGE_ROOT, "hermes-plugin", "specstride");

/** The control commands of `specstride-host-hermes`. */
const COMMANDS: ReadonlySet<string> = new Set(["install", "uninstall", "doctor", "watch", "eval"]);

type Scope =
  | { readonly kind: "profile"; readonly profile: string }
  | { readonly kind: "user" }
  | { readonly kind: "project"; readonly root: string };

/** One file an install writes: its path under the root and its source bytes. */
type PlannedFile = { readonly rel: string; readonly bytes: Buffer };

type Parsed =
  | { command: "install" | "uninstall"; scope: Scope }
  | { usageError: string };

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The project root: the explicit override, else `SPECSTRIDE_PROJECT`, else the git root of the cwd. */
function projectRoot(override?: string): string {
  if (override !== undefined) return resolve(override);
  const fromEnv = process.env.SPECSTRIDE_PROJECT;
  if (fromEnv) return resolve(fromEnv);
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd(); // no git root found: the cwd itself
    dir = parent;
  }
}

/** Parse the command line of `install`/`uninstall`. */
export function parseInstallArgs(argv: readonly string[]): Parsed {
  const args = [...argv];
  let projectOverride: string | undefined;
  // The seam `--project <dir>` BEFORE the command fixes the project root and
  // skips git detection; the scope flag `--project` AFTER the command is the
  // install scope itself.
  while (args[0] === "--project" && args.length > 2 && (COMMANDS.has(args[2] ?? "") || COMMANDS.has(args[4] ?? ""))) {
    projectOverride = args[1];
    args.splice(0, 2);
  }
  const command = args[0] ?? "";
  if (command !== "install" && command !== "uninstall") {
    return { usageError: `unknown command: ${command || "(none)"}` };
  }
  const rest = args.slice(1);
  let scope: Scope | undefined;
  let scopeFlags = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--profile") {
      const profile = rest[i + 1];
      if (profile === undefined || profile.startsWith("--")) return { usageError: "--profile needs a name" };
      scope = { kind: "profile", profile };
      scopeFlags += 1;
      i += 1;
    } else if (flag === "--user") {
      scope = { kind: "user" };
      scopeFlags += 1;
    } else if (flag === "--project") {
      scope = { kind: "project", root: projectRoot(projectOverride) };
      scopeFlags += 1;
    } else if (flag === "--with-kanban") {
      // 151's projection (out of scope here): accepted, adds nothing yet.
    } else {
      return { usageError: `unknown flag: ${flag}` };
    }
  }
  if (scopeFlags > 1) return { usageError: "give exactly one of --profile <p>, --user, --project" };
  if (scope === undefined) scope = { kind: "profile", profile: "specstride" };
  return { command, scope };
}

/** The roots a scope installs into: plain skills, bundled plugin (null for project). */
export function rootsOf(scope: Scope): { skills: string; plugin: string | null } {
  const home = process.env.HERMES_HOME ?? join(homedir(), ".hermes");
  if (scope.kind === "profile") {
    const base = join(home, "profiles", scope.profile);
    return { skills: join(base, "skills", "specstride"), plugin: join(base, "plugins", "specstride") };
  }
  if (scope.kind === "user") {
    return { skills: join(home, "skills", "specstride"), plugin: join(home, "plugins", "specstride") };
  }
  return { skills: join(scope.root, ".hermes", "skills", "specstride"), plugin: null };
}

/** The plain skills shipped in the build, in a stable order. */
function plainSkillNames(): string[] {
  return fs.existsSync(SKILLS_SOURCE)
    ? fs.readdirSync(SKILLS_SOURCE).filter((n) => fs.existsSync(join(SKILLS_SOURCE, n, "SKILL.md"))).sort()
    : [];
}

/**
 * The reverse probe (F150-FR-031): `reverse --help` through the shim's
 * resolution steps (`SPECSTRIDE_BIN`, then PATH) must exit 0 — the stub's
 * "not in this build" exit 3 skips the skill.
 */
export function cliAcceptsReverse(): boolean {
  const bin = process.env.SPECSTRIDE_BIN ?? "specstride";
  const probe = spawnSync(bin, ["reverse", "--help"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

/** Walk a directory into a file plan, relative paths in sorted order. */
function planFromDir(dir: string): PlannedFile[] {
  const out: PlannedFile[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push({ rel: relative(dir, path), bytes: fs.readFileSync(path) });
    }
  };
  walk(dir);
  return out;
}

/**
 * The install plan of one root: every file this package ships there. The
 * plugin root mirrors the built plugin directory and gains `_paths.json`
 * (T024), whose `packageBin` points at the package's built `bin/` holding
 * `specstride-hermes.mjs`.
 */
function planFor(root: string, kind: "skills" | "plugin", withReverse: boolean): PlannedFile[] {
  if (kind === "skills") {
    const names = plainSkillNames().filter((n) => withReverse || n !== "specstride-reverse");
    return names.map((name) => ({
      rel: join(name, "SKILL.md"),
      bytes: fs.readFileSync(join(SKILLS_SOURCE, name, "SKILL.md")),
    }));
  }
  const files = planFromDir(PLUGIN_SOURCE);
  files.push({
    rel: "_paths.json",
    bytes: Buffer.from(JSON.stringify({ packageBin: join(PACKAGE_ROOT, "bin") }, null, 2) + "\n"),
  });
  return files;
}

type ExistingRecord = { schema?: string; root?: string; files?: { path: string; sha256: string }[] };

function readRecord(root: string): ExistingRecord | null {
  try {
    return JSON.parse(fs.readFileSync(join(root, RECORD_NAME), "utf8")) as ExistingRecord;
  } catch {
    return null;
  }
}

/** The existing entries of a root that the record does not describe, defensively. */
function existingEntries(root: string): string[] {
  try {
    return fs.readdirSync(root);
  } catch {
    return [];
  }
}

/**
 * Verify one root against its record before anything is written:
 * - no record and a root whose content is not ours → refuse;
 * - a record whose file hashes drifted → refuse, naming the file.
 * Returns the refusal line, or how the root may be written.
 */
function checkRoot(
  root: string,
  kind: "skills" | "plugin",
  withReverse: boolean,
): { refusal?: string; unchanged?: boolean; extras?: PlannedFile[] } {
  const record = readRecord(root);
  const plan = planFor(root, kind, withReverse);
  if (record === null) {
    const entries = existingEntries(root).filter((e) => e !== RECORD_NAME);
    if (entries.length === 0) return {}; // absent or empty: a fresh write
    return { refusal: `refuse ${root} — no install record describes it` };
  }
  const recorded = record.files ?? [];
  for (const file of recorded) {
    const abs = join(root, file.path);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(abs);
    } catch {
      return { refusal: `refuse ${abs} — changed since install` };
    }
    if (sha256(bytes) !== file.sha256) return { refusal: `refuse ${abs} — changed since install` };
  }
  const recordedSet = new Set(recorded.map((f) => f.path));
  const extras = plan.filter((f) => !recordedSet.has(f.rel));
  return { unchanged: extras.length === 0, extras };
}

/** Write the files of a plan, then the record, atomically and last. */
function writeRoot(root: string, files: PlannedFile[], scope: Scope): void {
  for (const file of files) {
    const abs = join(root, file.rel);
    fs.mkdirSync(dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.bytes);
  }
  const record = {
    schema: RECORD_SCHEMA,
    host: "hermes",
    scope: scope.kind,
    profile: scope.kind === "profile" ? scope.profile : undefined,
    root,
    packageBin: join(PACKAGE_ROOT, "bin"),
    installedAt: new Date().toISOString(),
    files: files.map((f) => ({ path: f.rel, sha256: sha256(f.bytes) })),
  };
  atomicWrite(join(root, RECORD_NAME), JSON.stringify(record, null, 2) + "\n");
}

/** A temp file plus rename in the target directory. */
function atomicWrite(path: string, text: string): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, path);
}

/** Remove a directory tree if it exists (rollback only; uninstalls never use this). */
function removeTree(path: string): boolean {
  if (!fs.existsSync(path)) return false;
  fs.rmSync(path, { recursive: true, force: true });
  return true;
}

/** Remove a directory only when it is empty, walking upwards above the floor. */
function pruneEmptyDirs(path: string, floor: string): void {
  let dir = path;
  const below = resolve(floor);
  while (resolve(dir).startsWith(below) && resolve(dir) !== below) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    fs.rmdirSync(dir);
    dir = dirname(dir);
  }
}

/** Run `hermes -p <p> plugins enable|disable specstride`; `missing` when `hermes` is absent. */
function runHermes(argv: readonly string[]): { ok: boolean; missing?: boolean; output: string } {
  const done = spawnSync("hermes", [...argv], { encoding: "utf8" });
  if (done.error !== undefined) {
    const code = (done.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, missing: true, output: `hermes is not on PATH: ${argv.join(" ")} needs it` };
    return { ok: false, output: `hermes ${argv.join(" ")} failed: ${String(done.error)}` };
  }
  if (done.status !== 0) {
    return { ok: false, output: (done.stderr || "") + (done.stdout || "") || `hermes ${argv.join(" ")} failed` };
  }
  return { ok: true, output: done.stdout ?? "" };
}

/** Install: evaluate every root, then write, then record, then enable. */
function install(scope: Scope): CliResult {
  const stdout: string[] = [];
  const roots = rootsOf(scope);
  const withReverse = cliAcceptsReverse();
  if (!withReverse) stdout.push("skip specstride-reverse — the CLI has no reverse verb");

  const targets: { root: string; kind: "skills" | "plugin" }[] = [
    { root: roots.skills, kind: "skills" },
    ...(roots.plugin ? [{ root: roots.plugin, kind: "plugin" as const }] : []),
  ];

  // Evaluate first: any refusal writes nothing anywhere.
  const verdicts = targets.map((t) => ({ ...t, verdict: checkRoot(t.root, t.kind, withReverse) }));
  for (const { verdict } of verdicts) {
    if (verdict.refusal !== undefined) {
      return { exit: 1, stdout: stdout.join("\n") + "\n", stderr: verdict.refusal + "\n" };
    }
  }
  if (verdicts.every((v) => v.verdict.unchanged === true)) {
    return { exit: 0, stdout: "already installed, unchanged\n", stderr: "" };
  }

  const writtenRoots: string[] = [];
  for (const { root, kind, verdict } of verdicts) {
    if (verdict.unchanged === true) continue; // matches the record: leave every byte and mtime alone
    const files = planFor(root, kind, withReverse);
    writeRoot(root, files, scope);
    writtenRoots.push(root);
    for (const file of files) stdout.push(`installed ${join(root, file.rel)}`);
  }

  // The plugin enable step, per scope (F150-FR-022, F150-FR-023).
  if (scope.kind === "profile") {
    const enable = runHermes(["-p", scope.profile, "plugins", "enable", "specstride"]);
    if (!enable.ok) {
      // Nothing is left half-installed: roll back the roots this run wrote.
      for (const root of writtenRoots) removeTree(root);
      return { exit: enable.missing ? 127 : 1, stdout: "", stderr: enable.output + "\n" };
    }
    stdout.push(enable.output.trim());
  } else if (scope.kind === "user") {
    stdout.push("enable the plugin with: hermes plugins enable specstride");
  } else {
    stdout.push(`trust the project skills with: hermes skills trust ${scope.root}`);
  }
  return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
}

/** Uninstall: remove matching recorded files, keep and name changed ones, record last. */
function uninstall(scope: Scope): CliResult {
  const stdout: string[] = [];
  const roots = rootsOf(scope);
  const installedRoots = [roots.skills, roots.plugin].filter((r): r is string => r !== null);
  const records = installedRoots
    .map((root) => ({ root, record: readRecord(root) }))
    .filter((r): r is { root: string; record: ExistingRecord } => r.record !== null && (r.record.files ?? []).length > 0);
  if (records.length === 0) {
    return { exit: 0, stdout: "no install record — nothing to uninstall\n", stderr: "" };
  }

  const recordPaths: string[] = [];
  for (const { root, record } of records) {
    recordPaths.push(join(root, RECORD_NAME));
    for (const file of record.files ?? []) {
      const target = join(root, file.path);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(target);
      } catch {
        continue; // already gone
      }
      if (sha256(bytes) === file.sha256) {
        fs.rmSync(target, { force: true });
      } else {
        stdout.push(`kept ${target} — changed since install`);
      }
    }
  }

  // Prune every emptied directory, deepest first, up to (not including) each
  // root; `rmdirSync` only ever removes a directory left empty.
  const prunable = records
    .flatMap(({ root }) => {
      const dirs: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const child = join(dir, entry.name);
          walk(child);
          dirs.push(child);
        }
      };
      try {
        walk(root);
      } catch {
        // A root already gone prunes nothing.
      }
      return dirs;
    })
    .sort((a, b) => b.length - a.length);
  for (const dir of prunable) pruneEmptyDirs(dir, dirname(dir));
  for (const { root } of records) pruneEmptyDirs(dirname(root), dirname(root));

  // The record is removed last, after every recorded file: the final
  // filesystem removal of an uninstall is the record file itself (T026).
  for (const recordPath of recordPaths) {
    if (fs.existsSync(recordPath)) fs.rmSync(recordPath, { force: true });
  }
  // Then only empty directories can remain; remove them so no root survives.
  for (const { root } of records) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    if (entries.length === 0) fs.rmdirSync(root);
  }

  if (scope.kind === "profile") {
    const disable = runHermes(["-p", scope.profile, "plugins", "disable", "specstride"]);
    if (!disable.ok) {
      return { exit: disable.missing ? 127 : 1, stdout: stdout.join("\n") + "\n", stderr: disable.output + "\n" };
    }
    stdout.push(disable.output.trim());
  } else {
    stdout.push("disable the plugin with: hermes plugins disable specstride");
  }
  return { exit: 0, stdout: stdout.join("\n") + "\n", stderr: "" };
}

/**
 * The CLI-shaped entry of the installer: `run(["install", "--user"])` →
 * `{exit, stdout, stderr}`. Exit codes: 0 done or unchanged, 1 refused,
 * 3 usage error, 127 `hermes` missing when the scope needs it to enable.
 */
export function run(argv: readonly string[]): CliResult {
  const parsed = parseInstallArgs(argv);
  if ("usageError" in parsed) {
    return { exit: 3, stdout: "", stderr: `specstride-host-hermes: ${parsed.usageError}\n` };
  }
  if (parsed.command === "install") return install(parsed.scope);
  return uninstall(parsed.scope);
}

/** The engine's documented install command, printed by the doctor (F150-FR-016). */
export const ENGINE_INSTALL_COMMAND: string = MISSING_CLI_COMMAND;
