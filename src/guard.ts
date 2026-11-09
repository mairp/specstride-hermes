/**
 * The launch-guardrail table (T061, F150-FR-040, research R9,
 * contracts/150-host-hermes/plugin-manifest.md): the patterns and the
 * blocking verdict the `pre_tool_call` hook applies. This module is the ONLY
 * author of `$HERMES_HOME/specstride-host/guard.json`; the Python hook holds
 * no pattern of its own — it reads this table and applies it with plain
 * substring tests (H3). The doctor (T030) and the watcher (T057) call
 * `writeGuard` so the table always reflects the last doctor result.
 *
 * The guardrail only ever BLOCKS; it never approves anything (Principle II).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** One rule of the table: literal substrings only, no regex (H3). */
export type GuardRule = {
  /** Every literal must appear in the command string. */
  readonly contains: readonly string[];
  /** No literal of these may appear in the command string. */
  readonly absent: readonly string[];
  /** Why the launch is refused, shown to the model as one line. */
  readonly reason: string;
  /** The fix shown with the refusal. */
  readonly fix: string;
};

/**
 * The rules (research R9): a launch that does not go through the shim, and a
 * launch run in the background (the engine detaches itself; a backgrounded
 * call is never wanted). Chained foreground commands (`x && <shim> launch`)
 * stay allowed: the `&&` literal sits in `absent` of the `&` rule.
 */
export const GUARD_RULES: readonly GuardRule[] = Object.freeze([
  {
    contains: ["launch"],
    absent: ["specstride-hermes"],
    reason: "the engine's launch must run through the shim",
    fix: "run the engine's launch only through specstride-hermes",
  },
  {
    contains: ["launch", "nohup"],
    absent: [],
    reason: "the engine's launch must run in the foreground",
    fix: "run launch in the foreground; the engine detaches itself",
  },
  {
    contains: ["launch", "setsid"],
    absent: [],
    reason: "the engine's launch must run in the foreground",
    fix: "run launch in the foreground; the engine detaches itself",
  },
  {
    contains: ["launch", "&"],
    absent: ["&&"],
    reason: "the engine's launch must run in the foreground",
    fix: "run launch in the foreground; the engine detaches itself",
  },
]);

/** The written table's schema tag. */
export const GUARD_SCHEMA = "specstride.guard/1";

/** The table as the hook reads it. */
export type GuardTable = {
  readonly schema: string;
  /** True when the last doctor result held a launch-blocking finding: any
   * launch is refused with `fix`. */
  readonly blocking: boolean;
  /** The fix line, from the blocking finding of `doctor.last`. */
  readonly fix: string | null;
  readonly rules: readonly GuardRule[];
};

/** `$HERMES_HOME/specstride-host/guard.json`. */
export function guardPath(home: string): string {
  return join(home, "specstride-host", "guard.json");
}

/** The precomputed status files of a workspace (the watcher writes them). */
export function statusPathsOf(home: string, workspace: string): {
  readonly lineFile: string;
  readonly seqFile: string;
} {
  const key = createHash("sha256").update(workspace, "utf8").digest("hex").slice(0, 16);
  const directory = join(home, "specstride-host", "status");
  return { lineFile: join(directory, key + ".line"), seqFile: join(directory, key + ".seq") };
}

/** The doctor report the hooks read for the blocking verdict. */
export type DoctorLast = {
  readonly exit?: number;
  readonly checks?: readonly {
    readonly id?: string;
    readonly severity?: string;
    readonly message?: string;
    readonly blocking?: boolean;
  }[];
};

/**
 * Compute the blocking verdict and the fix from a doctor report: blocking
 * exactly when a finding that `LAUNCH_CHECK_IDS` would cover is a `fail`
 * (the report already flags only `host.cli-found` as launch-blocking).
 */
export function blockingFromDoctorLast(report: DoctorLast | null): {
  blocking: boolean;
  fix: string | null;
} {
  if (report === null || !Array.isArray(report.checks)) return { blocking: false, fix: null };
  const hit = report.checks.find((check) => check.blocking === true || check.severity === "fail");
  if (hit === undefined) return { blocking: false, fix: null };
  return { blocking: true, fix: hit.message ?? null };
}

/** Read `doctor.last`; unreadable or invalid → null (the hooks fail open). */
export function readDoctorLast(home: string): DoctorLast | null {
  try {
    return JSON.parse(fs.readFileSync(join(home, "specstride-host", "doctor.last"), "utf8")) as DoctorLast;
  } catch {
    return null;
  }
}

/** Read the written table; missing or invalid → null (the hook does nothing). */
export function readGuard(home: string): GuardTable | null {
  try {
    return JSON.parse(fs.readFileSync(guardPath(home), "utf8")) as GuardTable;
  } catch {
    return null;
  }
}

/**
 * Write `guard.json` atomically from the doctor report of `home`
 * (`doctor.last`, written by the doctor; a missing report means not
 * blocking). Returns the table written, or null when unwritable — the
 * guardrail fails open.
 */
export function writeGuard(home: string): GuardTable | null {
  const { blocking, fix } = blockingFromDoctorLast(readDoctorLast(home));
  const table: GuardTable = { schema: GUARD_SCHEMA, blocking, fix, rules: GUARD_RULES };
  const path = guardPath(home);
  const temporary = path + ".tmp-" + process.pid;
  try {
    fs.mkdirSync(join(path, ".."), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(table, null, 2) + "\n");
    fs.renameSync(temporary, path);
  } catch {
    return null;
  }
  return table;
}

/**
 * Rule match (the exact test the Python hook repeats): every `contains`
 * literal is a substring of the command and no `absent` literal is.
 */
export function ruleMatches(command: string, rule: GuardRule): boolean {
  for (const literal of rule.contains) {
    if (!command.includes(literal)) return false;
  }
  for (const literal of rule.absent) {
    if (command.includes(literal)) return false;
  }
  return true;
}

/** The first matching rule, or null. */
export function matchRule(command: string, rules: readonly GuardRule[]): GuardRule | null {
  for (const rule of rules) {
    if (ruleMatches(command, rule)) return rule;
  }
  return null;
}
