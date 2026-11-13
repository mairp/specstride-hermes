/**
 * The read-only file port of the workspace reader tests (T006).
 *
 * It serves reads over either an in-memory tree or a fixture directory,
 * records every path that was asked for (so a test can assert what the
 * reader touched), and THROWS on any path outside the closed set
 * "Reader inputs" of `contracts/151-hermes-kanban/closed-sets.json`
 * (F151-FR-034: a path outside the list is never opened). Paths are
 * normalized and resolved against the port root before the check.
 *
 * Only the minimal read-only operations the reader tests need are exposed:
 * `readFile`, `readdir`, `stat`, `exists`. Nothing writes; nothing spawns.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep, dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = pathDirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(join(HERE, "..", ".."));
export const CLOSED_SETS_JSON = join(REPO_ROOT, "contracts", "151-hermes-kanban", "closed-sets.json");

/** A path the closed set forbids was asked for. */
export class OutsideReaderInputsError extends Error {
  constructor(path: string, rule: string) {
    super(
      `fs-port refused "${path}": outside the closed set "Reader inputs" (${rule}) — ` +
        `a path outside the list is never opened (F151-FR-034)`,
    );
    this.name = "OutsideReaderInputsError";
  }
}

type ClosedSets = {
  proposedByFeature: { id: string; members: unknown; rule?: string }[];
};

/** The "Reader inputs" entry of the closed sets, as data. */
export function readerInputs(): { id: string; members: { n: number; path: string }[]; bounds: Record<string, number>; rule: string } {
  const sets = JSON.parse(readFileSync(CLOSED_SETS_JSON, "utf8")) as ClosedSets;
  const entry = sets.proposedByFeature.find((e) => e.id === "kanban-reader-inputs");
  if (!entry) throw new Error("closed-sets.json lost the kanban-reader-inputs set");
  return entry as never;
}

/**
 * Turn one member path string of the closed set into anchored regexes over
 * port-relative POSIX paths (leading "/", subtree members get "..." tails).
 * Handles the notation of the JSON: `<placeholder>` segments, `launch-*`
 * globs, `{a,b}` alternatives, a trailing "/" as a subtree, and the
 * parenthetical annotations ("(names)", "(names and sizes)", the "(also
 * ...)" alternate roots of member 8).
 */
function memberRegexes(pathSpec: string, extraRoots: string[] = []): RegExp[] {
  const sources: string[] = [];
  const compile = (spec: string): string => {
    let s = spec;
    // Drop annotation groups that are not path syntax.
    s = s.replace(/\s*\((?:names( and sizes)?|also[^)]*)\)/g, "");
    // `~` members are matched after the port has resolved the home, so the
    // regex is over the resolved relative path.
    s = s.replace(/^~\//, "");
    // Escape regex syntax first, then lay the path grammar over it.
    s = s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    // Brace alternatives.
    s = s.replace(/\\\{([^{}]+)\\\}/g, (_m, group: string) => `(?:${group.split(",").join("|")})`);
    // Placeholders and globs.
    s = s.replace(/<[^/]+>/g, "[^/]+").replace(/\*/g, "[^/]*");
    // A trailing "/" opens the whole subtree.
    if (s.endsWith("/")) s += "(?:.*)?";
    return "^/" + s.replace(/^\//, "") + "$";
  };
  // Split on ", " at brace depth 0 (alternatives of one member).
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of pathSpec) {
    if (ch === "{" || ch === "(") depth++;
    if (ch === "}" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    sources.push(compile(part));
  }
  for (const extra of extraRoots) sources.push(compile(extra));
  return sources.map((src) => new RegExp(src));
}

/**
 * The allow list, compiled from the closed set at load time. Member 8
 * carries its alternate roots ("~/.specstride/workspaces/<id16>/ (also the
 * full id, and $XDG_STATE_HOME/specstride/workspaces/)") — both spellings
 * are allowed for that root.
 */
export function buildReaderInputsAllowList(): RegExp[] {
  const inputs = readerInputs();
  const regexes: RegExp[] = [];
  for (const member of inputs.members) {
    if (member.n === 8) {
      regexes.push(
        ...memberRegexes("~/.specstride/workspaces/<id16>/runs/*/events.jsonl"),
        ...memberRegexes("~/.specstride/workspaces/<id16>/procs.json"),
        ...memberRegexes(
          "~/.specstride/workspaces/<id16>/features/<f>/{approvals,bound,micro,feedback,set-aside}/",
        ),
        ...memberRegexes("~/.specstride/workspaces/<id16>/features/<f>/{ledger,loop}.json"),
      );
      continue;
    }
    if (member.n === 10) {
      regexes.push(...memberRegexes("~/.dsh/sessions/<cwd-slug>/"));
      continue;
    }
    if (member.n === 9) {
      // The member reads "/proc/<pid>/{stat,cmdline} for recorded pids,
      // /proc/stat" — the prose note is not path syntax.
      regexes.push(...memberRegexes("/proc/<pid>/{stat,cmdline}"), ...memberRegexes("/proc/stat"));
      continue;
    }
    regexes.push(...memberRegexes(member.path));
  }
  return regexes;
}

/**
 * The directories a listing may touch: every ancestor directory of every
 * member path of the closed set (a member with a trailing "/" contributes
 * itself as well). Derived structurally from the same member specs, so the
 * list can never grow beyond what the closed set admits.
 */
export function buildReaderDirList(): RegExp[] {
  const inputs = readerInputs();
  const specs: string[] = [];
  for (const member of inputs.members) {
    if (member.n === 8) {
      specs.push(
        "~/.specstride/workspaces/<id16>/runs/*/events.jsonl",
        "~/.specstride/workspaces/<id16>/procs.json",
        "~/.specstride/workspaces/<id16>/features/<f>/{approvals,bound,micro,feedback,set-aside}/",
        "~/.specstride/workspaces/<id16>/features/<f>/{ledger,loop}.json",
      );
      continue;
    }
    if (member.n === 10) {
      specs.push("~/.dsh/sessions/<cwd-slug>/");
      continue;
    }
    if (member.n === 9) continue; // /proc listings are never wanted
    specs.push(member.path);
  }
  const rules: RegExp[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    // Every ancestor directory of the member is listable; a member given
    // with a trailing "/" contributes itself as well. Reuse the member
    // compiler on the prefix (a trailing "/" opens the subtree).
    const parts = spec.replace(/\s*\((?:names( and sizes)?|also[^)]*)\)/g, "").replace(/^~\//, "").split("/").filter((part) => part !== "");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      for (const rule of memberRegexes(parts.slice(0, depth).join("/"))) {
        if (!seen.has(rule.source)) {
          seen.add(rule.source);
          rules.push(rule);
        }
      }
    }
  }
  return rules;
}

export type PortStat = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  mtimeMs: number;
};

export type FsPortOptions = {
  /** In-memory tree: path (port-relative POSIX, leading "/") -> text. */
  tree?: Map<string, string>;
  /** Or a fixture directory, mounted at the port root. */
  root?: string;
  /** Home directory used to resolve `~` members (defaults to the root). */
  home?: string;
};

export class FsPort {
  readonly root: string;
  readonly home: string;
  private readonly tree: Map<string, string> | null;
  private readonly allow: RegExp[];
  private readonly allowDirs: RegExp[];
  private readonly asked: string[] = [];
  /** Paths the guard refused (a readdir swallowed by `listSafe` shows here). */
  readonly refusals: string[] = [];

  constructor(options: FsPortOptions = {}) {
    this.root = resolve((options.root ?? "/").replace(/\/+$/, "") || "/");
    this.home = options.home ?? this.root;
    this.tree = options.tree ?? null;
    this.allow = buildReaderInputsAllowList();
    this.allowDirs = buildReaderDirList();
  }

  /** The guard, for a DIRECTORY listing: a directory that holds (or is an
   * ancestor of) an allowed path is listable — enumerating names is how a
   * read-only reader uses a glob. A directory that cannot contain an
   * allowed path is refused like any other path outside the list. */
  private guardDir(path: string): string {
    try {
      return this.guard(path);
    } catch (error) {
      if (!(error instanceof OutsideReaderInputsError)) throw error;
      const normalized = this.normalize(path);
      const relative = normalized.startsWith("/proc")
        ? normalized
        : normalized.slice(this.root.length) || "/";
      const posix = relative.split(sep).join("/");
      if (posix !== "/" && posix !== "" && this.allowDirs.some((rule) => rule.test(posix))) {
        return normalized;
      }
      this.refusals.push(normalized);
      throw error;
    }
  }

  /** Normalize to an absolute POSIX path under the port root. */
  private normalize(path: string): string {
    let p = path;
    if (p.startsWith("~")) p = this.home + p.slice(1);
    if (p.startsWith("/proc/") || p === "/proc/stat") return p; // absolute
    const resolved = resolve(this.root, p);
    return resolved;
  }

  /**
   * The closed-set check, run BEFORE any read. `/proc` is allowed with its
   * real absolute spelling; everything else is matched relative to the
   * port root.
   */
  private guard(path: string): string {
    const normalized = this.normalize(path);
    this.asked.push(normalized);
    const relative = normalized.startsWith("/proc")
      ? normalized
      : normalized.slice(this.root.length) || "/";
    const posix = relative.split(sep).join("/");
    for (const rule of this.allow) {
      if (rule.test(posix)) return normalized;
    }
    throw new OutsideReaderInputsError(path, `no member of "Reader inputs" matches "${posix}"`);
  }

  private treeGet(path: string): string | undefined {
    if (!this.tree) return undefined;
    return this.tree.get(path) ?? this.tree.get(path.replace(/\/+$/, ""));
  }

  readFile(path: string, encoding = "utf8"): string {
    const p = this.guard(path);
    if (this.tree) {
      const text = this.treeGet(p);
      if (text === undefined) throw new Error(`fs-port: no such file: ${p}`);
      return text;
    }
    return readFileSync(p, encoding as BufferEncoding);
  }

  readdir(path: string): string[] {
    const p = this.guardDir(path);
    if (this.tree) {
      const prefix = p.endsWith("/") ? p : p + "/";
      const names = new Set<string>();
      for (const key of this.tree.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        names.add(rest.split("/")[0]);
      }
      return [...names].sort();
    }
    return readdirSync(p).sort();
  }

  stat(path: string): PortStat {
    const p = this.guard(path);
    if (this.tree) {
      const text = this.treeGet(p);
      if (text !== undefined) return { size: Buffer.byteLength(text), isFile: true, isDirectory: false, mtimeMs: 0 };
      const prefix = p.endsWith("/") ? p : p + "/";
      const isDir = [...this.tree.keys()].some((key) => key.startsWith(prefix));
      if (!isDir) throw new Error(`fs-port: no such path: ${p}`);
      return { size: 0, isFile: false, isDirectory: true, mtimeMs: 0 };
    }
    const st = statSync(p);
    return { size: st.size, isFile: st.isFile(), isDirectory: st.isDirectory(), mtimeMs: st.mtimeMs };
  }

  exists(path: string): boolean {
    try {
      this.guard(path);
    } catch (error) {
      if (error instanceof OutsideReaderInputsError) throw error;
      return false;
    }
    if (this.tree) return this.treeGet(this.normalize(path)) !== undefined;
    try {
      statSync(this.normalize(path));
      return true;
    } catch {
      return false;
    }
  }

  /** Raw bytes, up to `limit` — the FilePort.bytes of the reader port. */
  bytes(path: string, limit?: number): Uint8Array {
    const p = this.guard(path);
    const buffer = this.tree
      ? Buffer.from(this.treeGet(p) ?? "", "utf8")
      : readFileSync(p);
    return limit === undefined ? buffer : buffer.subarray(0, limit);
  }

  /** Every path that was asked for, in order, normalized. */
  accessed(): string[] {
    return [...this.asked];
  }
}

/** Convenience: a port over a fixture directory of `tests/fixtures/workspaces/<name>`. */
export function workspacePort(name: string, options: Omit<FsPortOptions, "root"> = {}): FsPort {
  return new FsPort({ root: join(REPO_ROOT, "tests", "fixtures", "workspaces", name), ...options });
}
