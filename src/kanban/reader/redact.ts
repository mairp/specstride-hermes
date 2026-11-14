/*! PORT of portions of specstride-dsh packages/dsh-kanban/src/server/run-detail.ts (capText at :40-46, safePath at :49-55, describeProcess at :289-313).
 * Provenance: https://github.com/odanado/specstride-dsh (dsh-kanban), file packages/dsh-kanban/src/server/run-detail.ts,
 * copied and adapted for Specstride (hermes) on 2026-11-11 by Specstride US6 (F151-FR-044, F151-FR-045).
 * SPDX-License-Identifier: MIT
 */

/**
 * The redaction and capping of the card detail (F151-FR-044): every string
 * is bounded at its cap, never split inside a multi-byte character; every
 * path is turned into a workspace-relative, `~`-rooted or bare base-name
 * form; a command line is reduced to the harness base name, the profile,
 * the model and the role — never the argv itself (F151-SC-009).
 */

/** The default cap of any detail string. */
export const DETAIL_TEXT_CAP = 240;
/** Task and file strings. */
export const TASK_TEXT_CAP = 160;
/** Run and attempt ids. */
export const ID_CAP = 40;
/** Model, critic and similar naming strings. */
export const NAME_CAP = 80;
/** Profile and similar shorter naming strings. */
export const PROFILE_CAP = 60;
/** Exit and similar compact strings. */
export const EXIT_CAP = 60;
/** Commit hashes. */
export const COMMIT_CAP = 12;
/** The list bounds (each with its omitted count). */
export const MAX_TASKS = 60;
export const MAX_FILES = 12;
export const MAX_ATTEMPTS = 12;
export const MAX_LAUNCHES = 12;
export const MAX_AGENTS = 8;
export const MAX_MODELS = 6;

const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * The record-bound form of one string: control characters become spaces,
 * whitespace runs collapse, and the text is cut at `capBytes` bytes — on a
 * character boundary, never inside one — with `...` marking the cut.
 */
export function capText(text: string, capBytes: number = DETAIL_TEXT_CAP): string {
  const cleaned = text.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(cleaned, "utf8") <= capBytes) return cleaned;
  const chars = Array.from(cleaned);
  let out = "";
  for (const char of chars) {
    if (Buffer.byteLength(out + char, "utf8") > Math.max(capBytes - 3, 1)) break;
    out += char;
  }
  // A cut that lands mid-character leaves a replacement character on
  // re-decode; strip any trailing partial sequence.
  while (out.length > 0 && Buffer.byteLength(out, "utf8") + 3 > capBytes && out.includes("\uFFFD")) out = out.slice(0, -1);
  return `${out}...`;
}

/** `true` when `path` is inside `root` (or is `root` itself). */
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The redacted form of a path: inside the workspace it is workspace-relative;
 * inside the state home it is `~`-rooted; anything else keeps only its base
 * name. The result is capped like any other string.
 */
export function safePath(path: string, cwd: string, home: string): string {
  const resolved = path.startsWith("/") ? path : `${cwd}/${path}`;
  const normal = normalize(resolved);
  let out: string;
  if (within(normal, cwd)) out = normal === cwd ? "." : normal.slice(cwd.length + 1);
  else if (home !== "" && within(normal, home)) out = normal === home ? "~" : `~${normal.slice(home.length)}`;
  else out = normal.slice(normal.lastIndexOf("/") + 1);
  return capText(out, TASK_TEXT_CAP);
}

/** A POSIX-style lexical normalization (no filesystem access). */
function normalize(path: string): string {
  const root = path.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${root}${parts.join("/")}`;
}

export interface ProcessDescription {
  harness: string | null;
  profile: string | null;
  model: string | null;
  role: string | null;
}

/** The role a command line names, when it names one. */
function roleOf(argv: readonly string[]): string | null {
  const text = argv.join(" ");
  if (/\bcritic\b/.test(text)) return "critic";
  if (/\bproposer\b/.test(text)) return "proposer";
  if (/\bverif(?:ier|y)\b/.test(text)) return "verifier";
  return null;
}

/**
 * What a command line may tell the board: the harness base name, the
 * `--profile` value, the `--model` value and the role — never the argv
 * itself, never a path, never an argument value beyond those three.
 */
export function describeProcess(cmdline: string | null): ProcessDescription | null {
  if (cmdline === null) return null;
  const argv = cmdline.split("\0").filter((entry) => entry !== "");
  if (argv.length === 0) return null;
  // The harness is the interpreter's entry script (`.mjs`/`.js`/...), not the
  // interpreter itself; without one, the first argv's base name.
  const script = argv.find((entry) => entry.includes("/") && /\.(mjs|cjs|js|py|sh)$/.test(entry));
  const base = (script ?? argv[0]).slice((script ?? argv[0]).lastIndexOf("/") + 1);
  const flag = (name: string): string | null => {
    const index = argv.indexOf(name);
    const value = index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
    return value !== null && /^[\w.:@-]{1,80}$/.test(value) ? value : null;
  };
  return {
    harness: capText(base, PROFILE_CAP),
    profile: flag("--profile"),
    model: flag("--model"),
    role: roleOf(argv),
  };
}

/**
 * A free-text field of the workspace (a task text, a goal): quoted spans and
 * key-like tokens are dropped, then the text is capped — so a prompt body or
 * a key planted in the workspace never reaches the view (F151-SC-009).
 */
export function freeText(text: string | null, capBytes: number = TASK_TEXT_CAP): string {
  if (text === null) return "";
  const scrubbed = text
    .replace(/(["'`])(?:(?!\1)[\s\S])*\1/g, " ") // quoted spans (prompt bodies)
    .replace(/\b(?:sk|pk|api|tok)[-_]?[A-Za-z0-9_-]{8,}\b/g, "[key]") // key-like tokens
    .replace(/(?:\/[\w.-]+){2,}/g, (match) => match.slice(match.lastIndexOf("/") + 1)); // absolute paths
  return capText(scrubbed, capBytes);
}
