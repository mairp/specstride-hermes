/**
 * The shim call (T012; PT-151-006, PT-151-051; contracts/workspace-reader.md
 * §1, F151-FR-033, F151-FR-049). The ONLY place the kanban host spawns a
 * process: 150's shim `bin/specstride-hermes.mjs`, run with
 * `process.execPath`, argv exactly `status --json` or
 * `wait --until-change --cursor <cursor> --timeout 25`.
 *
 * Runtime limits: 10 s idle (no stdout activity), 30 s hard, the whole
 * process group killed on a timeout or an error (spawned detached), stdout
 * capped at 512 KiB. The parsed body's schema major is read BEFORE
 * `isRunView`, so an unsupported major is `refused-schema` while a view that
 * fails validation inside the supported major is `unavailable`. The engine's
 * `no-state` / `no-feature` envelope of a non-zero exit is a REASON of
 * `unavailable`, not a result of its own (§1 step 3).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunView, MAJOR } from "@specstride/contracts/records/run-view";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The shim the call spawns, resolved from the package root. */
export function shimPath(packageRoot: string = join(HERE, "..", "..")): string {
  return join(packageRoot, "bin", "specstride-hermes.mjs");
}

/** No stdout activity for this long: the call is dead. */
export const IDLE_TIMEOUT_MS = 10_000;
/** Wall clock, regardless of activity. */
export const HARD_TIMEOUT_MS = 30_000;
/** More stdout than this aborts the call. */
export const STDOUT_CAP_BYTES = 512 * 1024;

/** One answer of the shim: exactly one of these kinds. */
export type ShimAnswer =
  | { kind: "view"; view: Record<string, unknown> }
  | { kind: "empty"; view: Record<string, unknown> }
  | { kind: "none"; view: Record<string, unknown> }
  | { kind: "refused-schema"; major: number }
  | { kind: "unavailable"; reason: string };

export interface CallOptions {
  /** Override the idle limit (tests). */
  idleMs?: number;
  /** Override the hard limit (tests). */
  hardMs?: number;
  /** Extra environment for the shim (`SPECSTRIDE_BIN`, `STUB_SCRIPT`, …). */
  env?: Record<string, string | undefined>;
  /** Override the shim path (tests); defaults to the package's own `bin/`. */
  shim?: string;
  /** Override the stdout cap (tests); defaults to `STDOUT_CAP_BYTES`. */
  stdoutCap?: number;
}

export interface RawOutcome {
  exit: number | null;
  stdout: string;
  stderr: string;
  /** Set when a limit killed the call. */
  reason?: string;
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Spawn the shim for one argv, holding the idle, hard and stdout-cap limits. */
export function callShim(cwd: string, args: readonly string[], options: CallOptions = {}): Promise<RawOutcome> {
  const idleMs = options.idleMs ?? IDLE_TIMEOUT_MS;
  const hardMs = options.hardMs ?? HARD_TIMEOUT_MS;
  const stdoutCap = options.stdoutCap ?? STDOUT_CAP_BYTES;
  const shim = options.shim ?? shimPath();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [shim, ...args], {
      cwd,
      env: { ...process.env, ...options.env },
      detached: true, // its own process group, so a kill takes everything
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let idleTimer: NodeJS.Timeout | null = null;
    const finish = (outcome: RawOutcome) => {
      if (settled) return;
      settled = true;
      if (idleTimer !== null) clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      killGroup(child);
      resolve(outcome);
    };
    const armIdle = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish({
          exit: null,
          stdout: Buffer.concat(chunks).toString("utf8"),
          stderr: "",
          reason: `idle timeout: no stdout activity for ${idleMs} ms`,
        });
      }, idleMs);
      idleTimer.unref?.();
    };
    const hardTimer = setTimeout(() => {
      finish({
        exit: null,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: "",
        reason: `hard timeout: the call ran over ${hardMs} ms`,
      });
    }, hardMs);
    hardTimer.unref?.();
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        exit: null,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: String(error.message),
        reason: `the shim could not be spawned: ${error.message}`,
      });
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      armIdle();
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes > stdoutCap) {
        finish({
          exit: null,
          stdout: Buffer.concat(chunks).subarray(0, stdoutCap).toString("utf8"),
          stderr: "",
          reason: `stdout cap exceeded: over ${String(stdoutCap)} bytes`,
        });
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      /* collected only */
    });
    child.on("exit", (code) => {
      finish({
        exit: code,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: "",
      });
    });
    armIdle();
  });
}

/** The schema major of a body, read before any validation (F100-FR-049). */
export function schemaMajorOf(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const schema = (body as Record<string, unknown>).schema;
  if (typeof schema !== "string") return null;
  const match = /\/(\d+)$/.exec(schema);
  return match === null ? null : Number(match[1]);
}

/** Interpret one raw outcome into exactly one `ShimAnswer` (§1 step 3). */
export function interpret(outcome: RawOutcome): ShimAnswer {
  if (outcome.reason !== undefined) {
    return { kind: "unavailable", reason: outcome.reason };
  }
  if (outcome.exit === null || outcome.exit !== 0) {
    const exit = outcome.exit;
    let envelope: string | null = null;
    try {
      const parsed = JSON.parse(outcome.stdout) as unknown;
      if (typeof parsed === "object" && parsed !== null && typeof (parsed as Record<string, unknown>).error === "string") {
        envelope = (parsed as Record<string, unknown>).error as string;
      }
    } catch {
      /* not JSON: fall through to the exit-code reasons */
    }
    if (envelope !== null) {
      return { kind: "unavailable", reason: `engine envelope: ${envelope} (exit ${exit})` };
    }
    if (exit === 4) return { kind: "unavailable", reason: "the shim refused the call: protocol mismatch (exit 4)" };
    if (exit === 127) return { kind: "unavailable", reason: "the engine was not found (exit 127)" };
    return { kind: "unavailable", reason: `engine exit ${String(exit)}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(outcome.stdout) as unknown;
  } catch {
    return { kind: "unavailable", reason: "the body is not JSON" };
  }
  // The schema major is read BEFORE isRunView (F100-FR-049, F151-FR-049).
  const major = schemaMajorOf(body);
  if (major === null || major !== MAJOR) {
    return { kind: "refused-schema", major: major ?? -1 };
  }
  if (!isRunView(body)) {
    return { kind: "unavailable", reason: `the view failed validation inside schema major ${String(MAJOR)}` };
  }
  const view = body as unknown as Record<string, unknown>;
  if (view.state === "none") return { kind: "none", view };
  const cards = view.cards;
  if (Array.isArray(cards) && cards.length === 0) return { kind: "empty", view };
  return { kind: "view", view };
}

/** `status --json` through the shim (§1 step 1). */
export async function status(cwd: string, options: CallOptions = {}): Promise<ShimAnswer> {
  return interpret(await callShim(cwd, ["status", "--json"], options));
}

/** `wait --until-change --cursor <c> --timeout 25` through the shim (§1 step 1). */
export async function wait(cwd: string, cursor: string, options: CallOptions = {}): Promise<ShimAnswer> {
  return interpret(
    await callShim(cwd, ["wait", "--until-change", "--cursor", cursor, "--timeout", "25"], options),
  );
}
