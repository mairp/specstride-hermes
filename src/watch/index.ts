/**
 * The watcher (T057, F150-FR-034 to F150-FR-037, H5,
 * contracts/150-host-hermes/notice-line.md): one concurrent
 * `specstride-hermes wait --until-change` per watched workspace (cap 16;
 * above it, round-robin with `--timeout 5`), a Telegram notice per change or
 * new attention item through `hermes send`, the precomputed status lines for
 * the hooks (T056), the forwarding of `inbox/*.json` host-limit requests
 * (left in place until the CLI has the verb — U-150-08) and a rewrite of
 * `guard.json` each cycle. The watcher never gates a run: every failure is
 * one log line (F150-FR-037). It refuses to run inside a Kanban or cron
 * session or inside the gateway's cgroup (F150-FR-037, T054).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readWatchList } from "./watch-list.ts";
import { readStatus, writeStatus } from "./status-line.ts";
import { NOTIFY_PROFILE, TARGET_KEY, parseWaitOutput, processWaitOutput } from "./notify.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..", "..");

/** The concurrent `wait` cap of one cycle (contracts/notice-line.md). */
export const WAIT_CONCURRENCY_CAP = 16;

/** The `--timeout` of a cycle within the cap, in seconds. */
export const WAIT_TIMEOUT = 25;

/** The `--timeout` of a round-robin batch above the cap, in seconds. */
export const WAIT_TIMEOUT_ROUND_ROBIN = 5;

/** The unit the watcher refuses to run under (silence in Kanban/cron, H5). */
const SILENT_SESSION_SOURCES: readonly string[] = ["kanban", "cron"];

/** The gateway unit whose cgroup the watcher must not run inside (T054). */
const GATEWAY_UNIT = "hermes-gateway.service";

/** The cursor store: workspace → last cursor seen, persisted atomically. */
function cursorsPath(home: string): string {
  return join(home, "specstride-host", "notify", "cursors.json");
}

function loadCursors(home: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(cursorsPath(home), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCursors(home: string, cursors: Record<string, string>): void {
  const file = cursorsPath(home);
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(cursors, null, 2) + "\n");
  renameSync(temporary, file);
}

/** One round-robin batch: the workspaces of one concurrent wave and its timeout. */
export type WaitBatch = {
  readonly workspaces: readonly string[];
  readonly timeout: number;
};

/**
 * Plan the concurrent waves of one cycle: at most 16 workspaces at a time,
 * `--timeout 25` within the cap, round-robin with `--timeout 5` above it.
 */
export function planWaves(workspaces: readonly string[]): WaitBatch[] {
  if (workspaces.length <= WAIT_CONCURRENCY_CAP) {
    return workspaces.length === 0 ? [] : [{ workspaces, timeout: WAIT_TIMEOUT }];
  }
  const waves: WaitBatch[] = [];
  for (let start = 0; start < workspaces.length; start += WAIT_CONCURRENCY_CAP) {
    waves.push({ workspaces: workspaces.slice(start, start + WAIT_CONCURRENCY_CAP), timeout: WAIT_TIMEOUT_ROUND_ROBIN });
  }
  return waves;
}

/** The path of the shipped systemd user unit (T058). */
export function watchUnitPath(): string {
  return join(PACKAGE_ROOT, "systemd", "specstride-hermes-watch.service");
}

/**
 * The systemd user unit template (T058): a person installs it, the watcher
 * only prints it (`watch --print-unit`). No relation to
 * `hermes-gateway.service` — the unit must survive a gateway restart.
 */
export const WATCH_UNIT_TEMPLATE = [
  "[Unit]",
  "Description=Specstride watcher for Hermes (notices and precomputed status lines)",
  "After=default.target",
  "",
  "[Service]",
  "Type=simple",
  "ExecStart=specstride-host-hermes watch",
  "Restart=on-failure",
  "Environment=HERMES_HOME=%h/.hermes",
  "",
  "[Install]",
  "WantedBy=default.target",
  "",
].join("\n");

/** The command that enables the unit, printed for a person to run. */
export const WATCH_UNIT_ENABLE_COMMAND = "systemctl --user enable --now specstride-hermes-watch";

/** The text `watch --print-unit` prints (F150-FR-037: nothing auto-installs). */
export function printUnitText(home: string | null): string {
  const unit = home === null
    ? WATCH_UNIT_TEMPLATE
    : WATCH_UNIT_TEMPLATE.replace("Environment=HERMES_HOME=%h/.hermes", `Environment=HERMES_HOME=${home}`);
  return (
    unit +
    "\n# Install by hand (nothing installs it for you):\n" +
    "#   mkdir -p ~/.config/systemd/user\n" +
    `#   cp ${watchUnitPath()} ~/.config/systemd/user/specstride-hermes-watch.service\n` +
    `#   ${WATCH_UNIT_ENABLE_COMMAND}\n`
  );
}

/** One spawn of the shim (the only channel to the CLI, H2). */
export type ShimSpawn = (
  args: readonly string[],
) => Promise<{ readonly exit: number; readonly stdout: string; readonly stderr: string }>;

/** One spawn of the `hermes` binary (config get, send). */
export type HermesSpawn = (
  argv: readonly string[],
  input: string,
) => Promise<{ readonly exit: number; readonly stdout: string; readonly stderr: string }>;

/** Injectable surroundings of the watcher, for tests and 151. */
export type WatchDeps = {
  readonly home: string;
  readonly shimPath?: string;
  readonly hermesBin?: string;
  readonly spawnShim?: ShimSpawn;
  readonly spawnHermes?: HermesSpawn;
  readonly log?: (line: string) => void;
  /** The CLI verb that writes a host-limit request, once core has one (U-150-08). */
  readonly hostLimitVerb?: string | null;
  /** The cgroup file the refusal probe reads (test fixture). */
  readonly cgroupFile?: string;
};

/** The optional-module hook 151 registers to extend the cycle. */
let kanbanHook: (() => void | Promise<void>) | null = null;

/** Register a Kanban extension hook (spec 151; never registered here). */
export function registerKanban(hook: () => void | Promise<void>): void {
  kanbanHook = hook;
}

function defaultShimPath(): string {
  const built = join(PACKAGE_ROOT, "bin", "specstride-hermes.mjs");
  if (existsSync(built)) return built;
  return "specstride-hermes";
}

function defaultSpawnShim(deps: WatchDeps): ShimSpawn {
  return async (args) => {
    const shimPath = deps.shimPath ?? defaultShimPath();
    const command = shimPath.endsWith(".mjs") ? process.execPath : shimPath;
    const file = shimPath.endsWith(".mjs") ? shimPath : undefined;
    return await new Promise((resolveSpawn) => {
      const child = spawn(command, file === undefined ? [...args] : [file, ...args], {
        env: { ...process.env, HERMES_HOME: deps.home },
        encoding: "utf8",
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => resolveSpawn({ exit: 1, stdout, stderr: String(error) }));
      child.on("close", (code) => resolveSpawn({ exit: code ?? 1, stdout, stderr }));
    });
  };
}

function defaultSpawnHermes(deps: WatchDeps): HermesSpawn {
  return async (argv, input) => {
    return await new Promise((resolveSpawn) => {
      const child = spawn(deps.hermesBin ?? "hermes", [...argv], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin?.on("error", () => {
        // A child that closed its stdin early must not crash the watcher.
      });
      child.stdin?.end(input);
      child.on("error", (error) => resolveSpawn({ exit: 1, stdout, stderr: String(error) }));
      child.on("close", (code) => resolveSpawn({ exit: code ?? 1, stdout, stderr }));
    });
  };
}

/** Why the watcher refused to start; `null` when it may run (F150-FR-037). */
export function watchRefusal(env: NodeJS.ProcessEnv, cgroupFile?: string): string | null {
  const source = env.HERMES_SESSION_SOURCE ?? "";
  if (SILENT_SESSION_SOURCES.includes(source)) {
    return `watcher skipped: HERMES_SESSION_SOURCE=${source} (the watcher is not a child of Kanban or cron, H5)`;
  }
  if (env.SPECSTRIDE_CHILD === "1") {
    return "watcher skipped: SPECSTRIDE_CHILD=1 (a run's own child session never watches)";
  }
  const file = cgroupFile ?? env.SPECSTRIDE_CGROUP_FILE ?? "/proc/self/cgroup";
  try {
    if (readFileSync(file, "utf8").includes(GATEWAY_UNIT)) {
      return `watcher skipped: inside the ${GATEWAY_UNIT} cgroup (the gateway restarts with KillMode=mixed, F150-FR-013)`;
    }
  } catch {
    // An unreadable cgroup file is not a reason to refuse.
  }
  return null;
}

/** Read the Telegram target with a read-only `config get` (F150-FR-034). */
export async function readNotifyTarget(spawnHermes: HermesSpawn): Promise<string | null> {
  const result = await spawnHermes(["-p", NOTIFY_PROFILE, "config", "get", TARGET_KEY], "");
  const value = result.exit === 0 ? result.stdout.trim() : "";
  return value === "" ? null : value;
}

/**
 * Forward the `inbox/*.json` host-limit requests through the shim (T057,
 * F150-FR-041, U-150-08): until the CLI has the verb the requests stay in
 * place and the watcher logs once. With `hostLimitVerb` set, a request is
 * forwarded and deleted after exit 0.
 */
export async function forwardInboxRequests(
  deps: WatchDeps,
  spawnShim: ShimSpawn,
  log: (line: string) => void,
): Promise<void> {
  const directory = join(deps.home, "specstride-host", "inbox");
  let entries: string[] = [];
  try {
    entries = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return;
  }
  if (entries.length === 0) return;
  const verb = deps.hostLimitVerb ?? null;
  if (verb === null || verb === "") {
    log(`[specstride-watch] ${entries.length} host-limit request(s) wait for the CLI verb (U-150-08); left in place`);
    return;
  }
  for (const name of entries) {
    const file = join(directory, name);
    const result = await spawnShim([verb, "--file", file]);
    if (result.exit === 0) {
      try {
        unlinkSync(file);
      } catch {
        // A request the engine took but that cannot be removed is retried.
      }
    } else {
      log(`[specstride-watch] host-limit request ${name} not forwarded: shim exited ${result.exit}`);
    }
  }
}

/**
 * Rewrite `guard.json` for the launch guardrail each cycle (T057, F150-FR-040)
 * through `src/guard.ts` (T061, phase 8). Until that module exists the
 * rewrite is skipped with one log line; a failure never stops the cycle.
 */
export async function rewriteGuard(
  deps: WatchDeps,
  log: (line: string) => void,
  warned: { value: boolean },
): Promise<void> {
  try {
    const guard = (await import("../guard.ts")) as { writeGuard?: (home: string) => unknown };
    if (typeof guard.writeGuard === "function") {
      await guard.writeGuard(deps.home);
      return;
    }
    if (!warned.value) log("[specstride-watch] src/guard.ts exports no writeGuard; guard.json not rewritten");
  } catch {
    if (!warned.value) log("[specstride-watch] src/guard.ts not present yet (T061); guard.json not rewritten");
  }
  warned.value = true;
}

/** The outcome of one watcher cycle. */
export type CycleResult = {
  readonly workspaces: number;
  readonly delivered: number;
  readonly failed: number;
};

/**
 * One watcher cycle (T057): read the watch list, run one concurrent `wait`
 * per workspace, precompute each status line, deliver the notices, forward
 * the inbox requests, rewrite `guard.json`, run the optional Kanban hook.
 * No failure here can affect a run (H5).
 */
export async function runCycle(deps: WatchDeps): Promise<CycleResult> {
  const log = deps.log ?? (() => {});
  const spawnShim = deps.spawnShim ?? defaultSpawnShim(deps);
  const spawnHermes = deps.spawnHermes ?? defaultSpawnHermes(deps);
  const workspaces = readWatchList(deps.home);
  const cursors = loadCursors(deps.home);
  const target = await readNotifyTarget(spawnHermes);
  if (target === null) {
    log("[specstride-watch] no Telegram target configured (specstride.notify.telegram); notices are not sent");
  }
  let delivered = 0;
  let failed = 0;
  const nextCursors: Record<string, string> = { ...cursors };
  for (const wave of planWaves(workspaces)) {
    const results = await Promise.all(
      wave.workspaces.map(async (workspace) => {
        const args = ["wait", "--until-change"];
        const cursor = cursors[workspace];
        if (cursor !== undefined) args.push("--cursor", cursor);
        args.push("--timeout", String(wave.timeout));
        try {
          const result = await spawnShim(args);
          if (result.exit !== 0) {
            log(`[specstride-watch] wait failed for ${workspace}: shim exited ${result.exit}${result.stderr ? ": " + result.stderr.trim() : ""}`);
            return 0;
          }
          const previous = readStatus(deps.home, workspace).line;
          const outcome = await processWaitOutput({
            home: deps.home,
            workspace,
            output: result.stdout,
            previousLine: previous,
            target,
            writeLine: (ws, line) => {
              writeStatus(deps.home, ws, line);
            },
            spawnHermes: async (argv, input) => {
              const sent = await spawnHermes(argv, input);
              return { exit: sent.exit, stderr: sent.stderr };
            },
            log,
          });
          const events = parseWaitOutput(result.stdout);
          const cursorValue = events.length > 0 ? events[events.length - 1].cursor : null;
          if (cursorValue !== null) nextCursors[workspace] = cursorValue;
          delivered += outcome.delivered;
          return outcome.delivered;
        } catch (error) {
          log(`[specstride-watch] cycle error for ${workspace}: ${String(error)}`);
          failed += 1;
          return 0;
        }
      }),
    );
    void results;
  }
  if (Object.keys(nextCursors).length > 0) {
    try {
      saveCursors(deps.home, nextCursors);
    } catch {
      // A lost cursor file costs at most one re-read, never a wrong notice.
    }
  }
  try {
    await forwardInboxRequests(deps, spawnShim, log);
  } catch (error) {
    log(`[specstride-watch] inbox forwarding failed: ${String(error)}`);
  }
  try {
    await rewriteGuard(deps, log, warnedGuardAbsent);
  } catch (error) {
    log(`[specstride-watch] guard rewrite failed: ${String(error)}`);
  }
  if (kanbanHook !== null) {
    try {
      await kanbanHook();
    } catch (error) {
      log(`[specstride-watch] kanban hook failed: ${String(error)}`);
    }
  }
  return { workspaces: workspaces.length, delivered, failed };
}

const warnedGuardAbsent = { value: false };

/** The flags `specstride-host-hermes watch` accepts (T057). */
export type WatchFlags = {
  readonly once: boolean;
  readonly printUnit: boolean;
};

export function parseWatchFlags(argv: readonly string[]): WatchFlags {
  return {
    once: argv.includes("--once"),
    printUnit: argv.includes("--print-unit"),
  };
}

/**
 * The body of `specstride-host-hermes watch [--once] [--print-unit]` (T057).
 * Returns the process exit code: 0 when skipped (a refused watcher is not an
 * error, F150-FR-037), 0 after a printed unit, 0 after the cycles it ran.
 */
export async function runWatch(
  argv: readonly string[],
  deps?: Partial<WatchDeps>,
  log: (line: string) => void = (line) => process.stderr.write(line + "\n"),
  out: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  const flags = parseWatchFlags(argv);
  const home = deps?.home ?? process.env.HERMES_HOME ?? join(process.env.HOME ?? "", ".hermes");
  if (flags.printUnit) {
    out(printUnitText(home));
    return 0;
  }
  const refusal = watchRefusal(process.env, deps?.cgroupFile);
  if (refusal !== null) {
    log(refusal);
    return 0;
  }
  const full: WatchDeps = { home, ...(deps as WatchDeps), log: deps?.log ?? log };
  for (;;) {
    await runCycle(full);
    if (flags.once) break;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 200));
  }
  return 0;
}
