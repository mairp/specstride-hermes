/**
 * The harness of the shim tests (T015–T017): the generated shim text
 * (src/shim.ts) is written into a temporary `bin/` and RUN against stub CLIs,
 * with `HOME`, `HERMES_HOME` and the cgroup file isolated to the fixture
 * (F150-FR-021). The stubs run offline and write only inside the fixture.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { hermesShimScript } from "../../src/shim.ts";

/** A PATH that carries the stubs first and the running Node's directory. */
export const STUB_PATH = (stubs: string): string => `${stubs}:${join(process.execPath, "..")}`;

export type ShimFixture = {
  readonly root: string;
  readonly bin: string;
  readonly home: string;
  /** A directory to put stub executables in; put it first on PATH. */
  readonly stubs: string;
  readonly shimPath: string;
  readonly cgroupFile: string;
  /** Record the argv of every run the shim makes, through the stub CLI. */
  readonly cliLog: string;
  cleanup(): void;
};

export function shimFixture(): ShimFixture {
  const root = mkdtempSync(join(tmpdir(), "shim-fixture-"));
  const bin = join(root, "bin");
  const home = join(root, "hermes-home");
  const stubs = join(root, "stubs");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(stubs, { recursive: true });
  const shimPath = join(bin, "specstride-hermes.mjs");
  writeFileSync(shimPath, hermesShimScript());
  chmodSync(shimPath, 0o755);
  const cgroupFile = join(root, "self-cgroup");
  const cliLog = join(root, "cli-log.jsonl");
  return {
    root,
    bin,
    home,
    stubs,
    shimPath,
    cgroupFile,
    cliLog,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** A stub CLI: records its argv as one JSON line and answers `--protocol`. */
export function writeStubCli(fx: ShimFixture, protocol: number, exit = 0, name = "specstride"): string {
  const path = join(fx.stubs, name);
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync } from "node:fs";',
      "const argv = process.argv.slice(2);",
      'if (process.env.STUB_CLI_LOG) appendFileSync(process.env.STUB_CLI_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");',
      'if (argv[0] === "--protocol") { console.log("' + protocol + '"); process.exit(0); }',
      'if (argv[0] === "--version") { console.log("0.1.0"); process.exit(0); }',
      "process.exit(" + exit + ");",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

export type ShimRun = SpawnSyncReturns<string> & { argvLines: readonly { argv: readonly string[]; cwd: string }[] };

/** Run the shim with the fixture's environment: isolated home, no network. */
export function runShim(
  fx: ShimFixture,
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): ShimRun {
  const result = spawnSync(fx.shimPath, args, {
    encoding: "utf8",
    env: {
      PATH: STUB_PATH(fx.stubs),
      HOME: fx.home,
      HERMES_HOME: fx.home,
      SPECSTRIDE_CGROUP_FILE: fx.cgroupFile,
      STUB_CLI_LOG: fx.cliLog,
      ...env,
    },
  });
  let argvLines: { argv: string[]; cwd: string }[] = [];
  try {
    const log = readFileSync(fx.cliLog, "utf8").trim();
    argvLines =
      log === "" ? [] : (JSON.parse("[" + log.split("\n").join(",") + "]") as { argv: string[]; cwd: string }[]);
  } catch {
    argvLines = [];
  }
  return Object.assign(result, { argvLines });
}
