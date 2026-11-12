/**
 * The harness of the watcher tests (T052–T054, contracts/150-host-hermes/
 * notice-line.md): a temporary `HERMES_HOME` whose `watch.json` names
 * fixture workspaces, the stub CLI scripting `wait --until-change` outputs
 * and the stub `hermes` answering `config get` and `send`. Every run goes
 * through `bin/specstride-host-hermes watch --once`, so the shim, the stubs
 * and the dispatcher are all exercised. No model call anywhere.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname, "..");

export type WatchFixture = {
  readonly root: string;
  readonly home: string;
  readonly stubs: string;
  readonly stubLog: string;
  /** The cgroup file the shim and the watcher's refusal probe read. */
  readonly cgroupFile: string;
  readonly sendLog: string;
  cleanup(): void;
};

export function watchFixture(): WatchFixture {
  const root = mkdtempSync(join(tmpdir(), "watch-fixture-"));
  const home = join(root, "hermes-home");
  const stubs = join(root, "stubs");
  const work = join(root, "workspaces");
  mkdirSync(home, { recursive: true });
  mkdirSync(stubs, { recursive: true });
  mkdirSync(work, { recursive: true });
  const cgroupFile = join(root, "self-cgroup");
  writeFileSync(cgroupFile, "0::/user.slice\n");
  const sendLog = join(root, "send-log.jsonl");
  // A stub `hermes` that records the send argv AND the stdin line it was given.
  writeFileSync(
    join(stubs, "hermes"),
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, readFileSync } from "node:fs";',
      "const argv = process.argv.slice(2);",
      "const normalized = argv.filter((a, i) => !(a === '-p' || argv[i - 1] === '-p')).join(' ');",
      "let stdin = '';",
      "if (normalized.startsWith('send')) {",
      "  stdin = readFileSync(0, 'utf8');",
      "}",
      "if (process.env.SEND_LOG) appendFileSync(process.env.SEND_LOG, JSON.stringify({ argv, stdin }) + '\\n');",
      "if (normalized === '--version') { console.log('hermes 0.22.2'); process.exit(0); }",
      "if (normalized.startsWith('config get specstride.notify.telegram')) {",
      "  const target = process.env.STUB_TARGET ?? '';",
      "  if (target !== '') console.log(target);",
      "  process.exit(0);",
      "}",
      "if (normalized.startsWith('send')) { process.exit(Number(process.env.STUB_SEND_EXIT ?? '0')); }",
      "process.stderr.write('stub hermes: unscripted: ' + normalized + '\\n');",
      "process.exit(2);",
    ].join("\n"),
  );
  chmodSync(join(stubs, "hermes"), 0o755);
  return {
    root,
    home,
    stubs,
    stubLog: join(root, "stub-log.jsonl"),
    cgroupFile,
    sendLog,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Register `count` fixture workspaces in the watch list. */
export function addWorkspaces(fx: WatchFixture, count: number): string[] {
  const workspaces: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const workspace = join(fx.root, "workspaces", "ws-" + index);
    mkdirSync(workspace, { recursive: true });
    workspaces.push(workspace);
  }
  mkdirSync(join(fx.home, "specstride-host"), { recursive: true });
  writeFileSync(join(fx.home, "specstride-host", "watch.json"), JSON.stringify(workspaces, null, 2) + "\n");
  return workspaces;
}

/** A stub CLI scripting `wait --until-change` (through `STUB_SCRIPT`). */
export function writeScript(fx: WatchFixture, script: Record<string, { stdout?: string; stderr?: string; exit?: number; delayMs?: number }>): void {
  const file = join(fx.root, "stub-script.json");
  writeFileSync(file, JSON.stringify(script));
  const cli = join(fx.stubs, "specstride");
  writeFileSync(
    cli,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, readFileSync } from "node:fs";',
      "const argv = process.argv.slice(2);",
      'if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");',
      'if (argv.includes("--protocol")) { console.log(process.env.STUB_PROTOCOL ?? "1"); process.exit(0); }',
      "let script = {};",
      "try { script = JSON.parse(readFileSync(process.env.STUB_SCRIPT_FILE, 'utf8')); } catch {}",
      "const key = argv.join(' ');",
      "for (const prefix of Object.keys(script).sort((a, b) => b.length - a.length)) {",
      "  if (key === prefix || key.startsWith(prefix + ' ')) {",
      "    const answer = script[prefix];",
      "    if (answer.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, answer.delayMs);",
      "    if (answer.stdout) process.stdout.write(answer.stdout + '\\n');",
      "    if (answer.stderr) process.stderr.write(answer.stderr + '\\n');",
      "    process.exit(answer.exit ?? 0);",
      "  }",
      "}",
      "process.stderr.write('stub specstride: no script for: ' + key + '\\n');",
      "process.exit(2);",
    ].join("\n"),
  );
  chmodSync(cli, 0o755);
}

/** Run `specstride-host-hermes watch` once against the fixture. */
export function runWatchOnce(
  fx: WatchFixture,
  extraEnv: Record<string, string | undefined> = {},
  args: readonly string[] = ["watch", "--once"],
) {
  return spawnSync(process.execPath, [join(ROOT, "bin", "specstride-host-hermes.mjs"), ...args], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: fx.root,
    env: {
      PATH: `${fx.stubs}:${join(process.execPath, "..")}:${process.env.PATH ?? ""}`,
      HOME: fx.home,
      HERMES_HOME: fx.home,
      SPECSTRIDE_BIN: join(fx.stubs, "specstride"),
      SPECSTRIDE_CGROUP_FILE: fx.cgroupFile,
      STUB_LOG: fx.stubLog,
      STUB_SCRIPT_FILE: join(fx.root, "stub-script.json"),
      SEND_LOG: fx.sendLog,
      STUB_TARGET: "telegram:4242",
      ...extraEnv,
    },
  });
}

/** The argv the stub CLI recorded, one entry per call. */
export function cliCalls(fx: WatchFixture): { argv: string[]; cwd: string }[] {
  return readLog(fx.stubLog);
}

/** The `send` calls the stub `hermes` recorded, argv and stdin line. */
export function sendCalls(fx: WatchFixture): { argv: string[]; stdin: string }[] {
  return readLog<{ argv: string[]; stdin: string }>(fx.sendLog).filter((call) =>
    call.argv.includes("send"),
  );
}

function readLog<T>(file: string): T[] {
  try {
    const text = readFileSync(file, "utf8").trim();
    if (text === "") return [];
    return JSON.parse("[" + text.split("\n").join(",") + "]");
  } catch {
    return [];
  }
}
