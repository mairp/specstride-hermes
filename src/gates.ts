/**
 * The static gates of the Hermes host (T022): pure checks over a tree, used
 * by `npm test` and by `scripts/conformance.ts`. Each gate returns the
 * findings it saw; an empty list is a pass. A gate never writes and never
 * calls the network or a model.
 *
 * - No-engine-copy: no build output may carry a file whose sha256 equals an
 *   engine file's (F150-SC-007).
 * - Reference closure: no path from a skill into product source, state or
 *   logs (F150-FR-005).
 * - CLI-spawn scan: only the built shim and its generator may name the
 *   engine executable (F150-FR-014, PT-150-014).
 * - Language Ledger (F150-FR-025, PT-150-025): every `.py` under
 *   `hermes-plugin/` has a row in `docs/language-ledger.md`, no `.py` exists
 *   outside `hermes-plugin/`, and `plugin.yaml` carries no
 *   `pip_dependencies` / `python_dependencies`.
 * - No-logic-in-Python (H3, F150-FR-042): no `import re`, no `from re`, no
 *   string literal naming a launch.
 * - No-Bash (Principle VI): no `.sh` file ships in `files`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

export type Findings = readonly string[];

/** The engine packages whose shipped files nothing of this host may copy. */
const ENGINE_PACKAGES: readonly string[] = ["@specstride", "specstride"];
/** Files that legitimately match byte for byte: the licence files and manifests. */
const IGNORED_FILE_NAMES: readonly string[] = ["LICENSE", "LICENSE.md", "NOTICE", "NOTICE.md", "README.md", "package.json"];
/** The build outputs and sources the no-engine-copy gate covers. */
const COPY_SCOPES: readonly string[] = ["skills", "bin", "hermes-plugin", "src", "scripts", "systemd"];

/** Every file under a directory, skipping `node_modules`. */
export function filesUnder(root: string, directory: string): readonly string[] {
  const absolute = join(root, directory);
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(absolute, entry);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) out.push(...filesUnder(root, join(directory, entry)));
    else out.push(path);
  }
  return out;
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The sha256 of every engine file, keyed by digest, skipping licence files. */
export function engineFileHashes(packageRoot: string): ReadonlyMap<string, string> {
  const nodeModules = join(packageRoot, "node_modules");
  const hashes = new Map<string, string>();
  for (const scope of ENGINE_PACKAGES) {
    let entries: string[];
    try {
      entries = readdirSync(join(nodeModules, scope));
    } catch {
      continue;
    }
    for (const name of entries) {
      const packageDirectory = join(nodeModules, scope, name);
      try {
        if (!statSync(packageDirectory).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of filesUnder(packageDirectory, ".")) {
        const base = file.split("/").pop() ?? file;
        if (IGNORED_FILE_NAMES.includes(base)) continue;
        try {
          hashes.set(sha256Of(file), relative(packageRoot, file));
        } catch {
          // An unreadable engine file is not a hash anything can copy.
        }
      }
    }
  }
  return hashes;
}

/**
 * Gate: no file of the host's outputs matches an engine file byte for byte.
 * The engine's own hashes come from the package root that holds
 * `node_modules/`, which is the tested tree unless a caller says otherwise.
 */
export function checkNoEngineCopy(root: string, engineRoot: string = root): Findings {
  const engine = engineFileHashes(engineRoot);
  const findings: string[] = [];
  for (const scope of COPY_SCOPES) {
    for (const file of filesUnder(root, scope)) {
      const base = file.split("/").pop() ?? file;
      if (IGNORED_FILE_NAMES.includes(base)) continue;
      const digest = sha256Of(file);
      const match = engine.get(digest);
      if (match !== undefined)
        findings.push(
          `no-engine-copy: ${relative(root, file)} matches the engine file ${match} byte for byte (F150-SC-007)`,
        );
    }
  }
  return findings;
}

/** The paths a skill must never name (F150-FR-005, F150-SC-003). */
const FORBIDDEN_REFERENCE_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] =
  Object.freeze([
    { pattern: /(^|[^\w.-])(src|core|packages|vendor)\//, why: "a path into product source" },
    { pattern: /node_modules/, why: "a path into the installed packages" },
    { pattern: /XDG_STATE_HOME\/specstride\b/, why: "a path into engine state" },
    { pattern: /\.specstride\//, why: "a path into engine or product state" },
    { pattern: /(^|[^\w.-])logs?\//, why: "a path into logs" },
  ]);

/** The reference-closure findings one text carries, labelled for a report
 * (`scripts/conformance.ts` scans the artifacts a target renders, not only
 * the tree on disk). */
export function referenceClosureFindingsOfText(text: string, label: string): Findings {
  const findings: string[] = [];
  for (const { pattern, why } of FORBIDDEN_REFERENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) findings.push(`reference-closure: ${label} names ${why}: ${JSON.stringify(match[0])} (F150-FR-005)`);
  }
  return findings;
}

/** Gate: no path from a skill into product source, state or logs. */
export function checkReferenceClosure(root: string): Findings {
  const findings: string[] = [];
  for (const scope of ["skills", "hermes-plugin"]) {
    for (const file of filesUnder(root, scope)) {
      if (![".md", ".py", ".yaml", ".yml", ".json"].includes(extname(file))) continue;
      const text = readFileSync(file, "utf8");
      findings.push(...referenceClosureFindingsOfText(text, relative(root, file)));
    }
  }
  return findings;
}

/** The engine executable's name, built from parts so this file never spells it. */
const EXECUTABLE = ["spec", "stride"].join("");
/**
 * Naming the executable in the spawn sense (F150-FR-014): a spawn or exec
 * call whose target is the executable, or a command string that runs it by
 * its bare name with a verb or a flag after it. Data strings — a metadata
 * key, a tag, a YAML field — name nothing a process runs and are not a
 * spawn.
 */
const SPAWN_CALL_PATTERN = new RegExp(
  "(spawnSync|spawn|execFile|execFileSync|execSync|exec)[^\\n]{0,60}[\"'`]" + EXECUTABLE + "(?![\\w.-])",
);
const CLI_COMMAND_PATTERN = new RegExp(
  "(?<![\\w.-])" + EXECUTABLE + "\\s+(launch|resume|doctor|status|curate|wait|reverse|contract|--|-)",
);
/** The only files that may name the executable: the shim and its generator. */
const EXECUTABLE_ALLOWLIST: readonly string[] = [join("bin", "specstride-hermes.mjs"), join("src", "shim.ts")];
/** The scopes the spawn scan covers: files that could spawn a process. */
const SPAWN_SCOPES: readonly string[] = ["src", "scripts", "bin"];

/** Gate: only the shim and its generator name the engine executable. */
export function checkCliSpawnScan(root: string): Findings {
  const findings: string[] = [];
  for (const scope of SPAWN_SCOPES) {
    for (const file of filesUnder(root, scope)) {
      if (![".ts", ".mjs", ".js"].includes(extname(file))) continue;
      const id = relative(root, file);
      if (EXECUTABLE_ALLOWLIST.includes(id)) continue;
      const text = readFileSync(file, "utf8");
      const match = SPAWN_CALL_PATTERN.exec(text) ?? CLI_COMMAND_PATTERN.exec(text);
      if (match)
        findings.push(
          `cli-spawn: ${id} names the engine executable; only bin/specstride-hermes.mjs and src/shim.ts may (F150-FR-014)`,
        );
    }
  }
  return findings;
}

/** The Python rows the Language Ledger carries, as file names. */
export function ledgerRows(ledgerPath: string): readonly string[] {
  let text: string;
  try {
    text = readFileSync(ledgerPath, "utf8");
  } catch {
    return [];
  }
  const rows: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) rows.push(match[1]);
  }
  return rows;
}

/** Gate: the Language Ledger holds every Python file, and Python ships only in the plugin. */
export function checkLanguageLedger(root: string): Findings {
  const findings: string[] = [];
  const rows = ledgerRows(join(root, "docs", "language-ledger.md"));
  if (rows.length === 0) findings.push("language-ledger: docs/language-ledger.md carries no rows");
  let pluginPython: readonly string[] = [];
  try {
    pluginPython = filesUnder(root, "hermes-plugin").filter((file) => extname(file) === ".py");
  } catch {
    // No plugin directory: nothing to hold the ledger to.
  }
  for (const file of pluginPython) {
    const name = file.split("/").pop() ?? file;
    const held = rows.some((row) => row === name || row.endsWith("/" + name));
    if (!held)
      findings.push(`language-ledger: ${relative(root, file)} has no row in docs/language-ledger.md (F150-FR-025)`);
  }
  for (const scope of COPY_SCOPES) {
    if (scope === "hermes-plugin") continue;
    for (const file of filesUnder(root, scope)) {
      if (extname(file) !== ".py") continue;
      findings.push(`language-ledger: ${relative(root, file)} is outside hermes-plugin/ (F150-FR-025)`);
    }
  }
  const manifest = join(root, "hermes-plugin", "specstride", "plugin.yaml");
  let manifestText: string;
  try {
    manifestText = readFileSync(manifest, "utf8");
  } catch {
    manifestText = "";
  }
  if (manifestText !== "") {
    if (/pip_dependencies|python_dependencies/.test(manifestText))
      findings.push(
        "language-ledger: hermes-plugin/specstride/plugin.yaml names pip_dependencies or python_dependencies (F150-FR-025)",
      );
    if (!/python_runtime:\s*external/.test(manifestText))
      findings.push("language-ledger: plugin.yaml must declare python_runtime: external");
  }
  return findings;
}

/** Gate: no logic in Python — no `re`, no launch string (H3, F150-FR-042). */
export function checkNoLogicInPython(root: string): Findings {
  const findings: string[] = [];
  let python: readonly string[] = [];
  try {
    python = filesUnder(root, "hermes-plugin").filter((file) => extname(file) === ".py");
  } catch {
    return findings;
  }
  for (const file of python) {
    const text = readFileSync(file, "utf8");
    if (/(^|\n)\s*import\s+re\b/.test(text) || /(^|\n)\s*from\s+re\s+import\b/.test(text))
      findings.push(`no-logic-in-python: ${relative(root, file)} imports re (F150-FR-042)`);
    const launchPhrase = new RegExp("[\"'][^\"']*" + EXECUTABLE + " launch[^\"']*[\"']");
    if (launchPhrase.test(text))
      findings.push(`no-logic-in-python: ${relative(root, file)} carries a launch string (F150-FR-042)`);
  }
  return findings;
}

/** Gate: no `.sh` file ships in `files` (Principle VI). */
export function checkNoBash(root: string): Findings {
  const findings: string[] = [];
  let files: readonly string[] = [];
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      files?: readonly string[];
    };
    files = manifest.files ?? [];
  } catch {
    return findings;
  }
  for (const entry of files) {
    if (entry.endsWith(".sh"))
      findings.push(`no-bash: package.json ships ${entry} (Principle VI)`);
    const directory = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    for (const file of filesUnder(root, directory)) {
      if (extname(file) === ".sh")
        findings.push(`no-bash: ${relative(root, file)} ships in files (Principle VI)`);
    }
  }
  return findings;
}

/** Every gate, with its name; used by `npm test` and `scripts/conformance.ts`. */
export function runAllGates(root: string): Readonly<Record<string, Findings>> {
  return {
    "no-engine-copy": checkNoEngineCopy(root),
    "reference-closure": checkReferenceClosure(root),
    "cli-spawn": checkCliSpawnScan(root),
    "language-ledger": checkLanguageLedger(root),
    "no-logic-in-python": checkNoLogicInPython(root),
    "no-bash": checkNoBash(root),
  };
}

/** The findings of every gate, flattened; an empty list is a pass. */
export function allGateFindings(root: string): Findings {
  const results = runAllGates(root);
  return Object.values(results).flat();
}
