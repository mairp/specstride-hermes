/**
 * The hermetic driver of the US2 contract tests (T032, T034): the rendered
 * `specstride-run` command sequence executed against a stub `specstride` CLI
 * behind the shim `bin/specstride-hermes.mjs`, in a temporary `HERMES_HOME`
 * with the skills installed (F150-FR-021: tests run only against a temporary
 * HERMES_HOME). No model call anywhere: the stub answers canned terse lines,
 * and every argv it receives is logged so a test asserts the order of
 * F150-FR-004, the verbatim relay of F150-FR-005 and the dry-run withhold of
 * F150-FR-006.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decideMode, stepsOfMode, type Mode } from "@specstride/host-kit";
import { REPO_ROOT } from "./run-body.ts";

export const SHIM = join(REPO_ROOT, "bin", "specstride-hermes.mjs");

/** A file tree's sha256 digest, over sorted relative paths and contents. */
export function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else hash.update(`${rel}\0${createHash("sha256").update(readFileSync(full)).digest("hex")}\0`);
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

/** The stub `specstride` CLI: logs every argv, prints canned terse lines, writes nothing of the repository. */
const STUB_SCRIPT = `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const dir = process.env.SPECSTRIDE_SCENARIO_DIR;
const log = process.env.SPECSTRIDE_CALL_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv }) + "\\n");
const out = (s) => process.stdout.write(s + "\\n");
const file = (name, fallback) => {
  try { return fs.readFileSync(path.join(dir, name), "utf8").trim(); } catch { return fallback; }
};
if (argv[0] === "--protocol") return out("1");
if (argv[0] === "contract" && argv[1] === "derive") {
  if (argv.includes("--answer")) return out("answered batch-001 remaining=0");
  return out("derived draft draft-001 remaining=1 batch batch-001 items=1");
}
if (argv[0] === "contract" && argv[1] === "validate") return out("validation verdict: pass");
if (argv[0] === "contract" && argv[1] === "promote") return out("promoted draft-001");
if (argv[0] === "contract" && argv[1] === "render") return out("rendered bundle bundle-001");
if (argv[0] === "launch") {
  const line = file("launch-outcome.txt", "started run-001 detached from the session");
  out(line);
  process.exit(Number(file("launch-exit.txt", "0")));
}
if (argv[0] === "wait") {
  const i = argv.indexOf("--cursor");
  const cursor = i >= 0 ? argv[i + 1] : "";
  let map = {};
  try { map = JSON.parse(fs.readFileSync(path.join(dir, "wait-outputs.json"), "utf8")); } catch {}
  const line = map[cursor];
  if (line === undefined || line === "") return; // an unchanged cycle prints nothing
  return out(line);
}
if (argv[0] === "digest") return out(file("digest.txt", "DIGEST run-001 verdict=pass"));
out("unexpected call: " + argv.join(" "));
process.exit(3);
`;

export type Hermetic = {
  dir: string;
  fixture: string;
  callLog: string;
  scenario: string;
  home: string;
  env: NodeJS.ProcessEnv;
  before: string;
  cleanup: () => void;
};

/** The hermetic environment: fixture repository, stub CLI, skills in HERMES_HOME. */
export function setupHermetic(): Hermetic {
  const dir = mkdtempSync(join(tmpdir(), "us2-hermetic-"));
  const fixture = join(dir, "fixture-repo");
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "README.md"), "# fixture\n");
  writeFileSync(join(fixture, "src", "app.ts"), "export const app = 1;\n");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "specstride");
  writeFileSync(stub, STUB_SCRIPT, { mode: 0o755 });
  chmodSync(stub, 0o755);
  const scenario = join(dir, "scenario");
  mkdirSync(scenario, { recursive: true });
  // The supervision scenario: cursor 0001 changes to 0002; 0002 is unchanged.
  writeFileSync(join(scenario, "wait-outputs.json"), JSON.stringify({ "0001": "changed cursor=0002" }));
  const home = join(dir, "hermes-home");
  // Install: the built skills into the plain skill root of the hermetic home
  // (`<root>/specstride/<name>/SKILL.md`, F150-FR-002).
  mkdirSync(join(home, "skills"), { recursive: true });
  fsCopy(join(REPO_ROOT, "skills"), join(home, "skills"));
  const callLog = join(dir, "calls.jsonl");
  writeFileSync(callLog, "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SPECSTRIDE_BIN: stub,
    SPECSTRIDE_SCENARIO_DIR: scenario,
    SPECSTRIDE_CALL_LOG: callLog,
    HERMES_HOME: home,
  };
  return {
    dir,
    fixture,
    callLog,
    scenario,
    home,
    env,
    before: treeDigest(fixture),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function fsCopy(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) fsCopy(source, target);
    else writeFileSync(target, readFileSync(source));
  }
}

/** The argv lines the stub recorded. */
export function calls(ctx: Hermetic): string[][] {
  return readFileSync(ctx.callLog, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l).argv as string[]);
}

/** The commands of the log, without the shim's own `--protocol` probes. */
export function commandsOf(log: readonly string[][]): string[] {
  return log
    .map((argv) => (argv[0] === "contract" ? `contract ${argv[1]}` : argv[0]))
    .filter((c) => c !== "--protocol");
}

/** One call through the shim: the only channel the skill has (F150-FR-009). */
export function shim(ctx: Hermetic, args: string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [SHIM, ...args], { env: ctx.env, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout };
}

/** A scenario file: the stub reads its answers from it. */
export function scenario(ctx: Hermetic, name: string, content: string) {
  writeFileSync(join(ctx.scenario, name), content);
}

/** Execute the skill's sequence, in F150-FR-004 order, for one mode. */
export function driveRun(
  ctx: Hermetic,
  input: { comment: string; mode: Mode; supervise?: boolean },
): { printed: string[]; launched: boolean; outcomeLine?: string } {
  const { comment, mode } = input;
  const steps = stepsOfMode(mode);
  const printed: string[] = [];
  const flags = decideMode({ explicit: mode === "run" ? undefined : mode, comment });
  const call = (args: string[], relay = true) => {
    const r = shim(ctx, args);
    if (relay) printed.push(...r.stdout.split("\n").filter((l) => l !== ""));
    return r;
  };

  // Step 1 is a model step: the comment is captured verbatim, before any read.
  if (steps[0]!.id !== "capture-the-comment") throw new Error("the first step is not capture-the-comment");
  // Step 2: the CLI check through the shim.
  const check = call(["--protocol"], false); // the probe is a check, not a relayed line
  if (check.status !== 0) throw new Error("the CLI check failed");
  // Step 3: derive, comment verbatim as ONE argument.
  const derive = call(["contract", "derive", "--repo", ctx.fixture, "--comment", comment]);
  if (derive.status !== 0) throw new Error("derive failed");
  // Step 4: judge — the oracle fixture answers the one batch deterministically.
  if (derive.stdout.includes("remaining=1")) {
    call(["contract", "derive", "--repo", ctx.fixture, "--answer", "batch-001", "item-001=option-a"]);
  }
  if (mode === "dry-run") {
    // DRY_RUN_LAST_STEP: validate, print the plan and the verdict, launch nothing.
    const verdict = call(["contract", "validate", ctx.fixture]);
    printed.push(...verdict.stdout.split("\n").filter((l) => l !== ""));
    if (flags.mode !== "dry-run") throw new Error("the mode did not resolve to dry-run");
    return { printed, launched: false };
  }
  // Step 5: validate and promote.
  call(["contract", "validate", ctx.fixture]);
  call(["contract", "promote", ctx.fixture]);
  // Step 6: render. Step 7: launch, comment unchanged.
  call(["contract", "render", ctx.fixture]);
  const launch = call(["launch", "--repo", ctx.fixture, "--comment", comment], false);
  const outcomeLine = launch.stdout.trim();
  // Step 8: the outcome line is relayed VERBATIM.
  printed.push(outcomeLine);
  if (!outcomeLine.startsWith("started") && !outcomeLine.startsWith("attached")) {
    return { printed, launched: false, outcomeLine };
  }
  if (input.supervise !== false) {
    // Step 9: supervise — one blocking wait per cycle with the previous
    // cursor; an unchanged cycle prints nothing; then the digest, verbatim,
    // as the last line.
    call(["wait", "--until-change", "--cursor", "0001"]); // changed
    call(["wait", "--until-change", "--cursor", "0002"]); // unchanged: prints nothing
    call(["wait", "--until-change", "--cursor", "0002"]); // the read repeated
    const digest = call(["digest", ctx.fixture], false);
    printed.push(digest.stdout.trim()); // the digest, verbatim, last
  }
  return { printed, launched: true, outcomeLine };
}
