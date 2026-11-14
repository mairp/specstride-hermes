/**
 * The scan of the dashboard tab sources (T061; T054 is its test,
 * PT-151-049, F151-FR-049). Contracts:
 * contracts/151-hermes-kanban/presentation.md §Scan.
 *
 * Five line-based rules over the given files or directories:
 * - `no-lane-assignment`: a lane literal assigned or switched on outside the
 *   reader's lane table (`src/kanban/reader/lanes.ts`) — the column comes
 *   from `card.lane` and nothing else (F151-FR-025);
 * - `css-colour`: a colour literal (hex, named colour, `rgb(`/`hsl(`), a
 *   foreign `var(--x)` or a non-`--sskh-` property with a colour value — the
 *   stylesheet tints only through the theme tokens;
 * - `css-selector`: an `@import`, a `prefers-color-scheme` query, or a
 *   selector line whose `{` lacks the `sskh-` scope prefix;
 * - `markup-sink`: `innerHTML` / `dangerouslySetInnerHTML` in code;
 * - `nondeterminism`: `Date.now`, `new Date(`, `Math.random`,
 *   `performance.now` in a pure builder.
 *
 * Line-based and deterministic: the same tree always yields the same
 * findings, each carrying rule, path, line and snippet.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Finding {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly snippet: string;
}

export interface ScanOptions {
  /** Extra rule exemptions, e.g. the generated files. */
  readonly allow?: readonly string[];
}

/** The canonical lanes (closed set "kanban-lanes"). */
const LANES = ["queued", "proposing", "verifying", "reviewing", "approved", "blocked", "paused", "failed"];

const NAMED_COLOURS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque",
  "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
  "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue",
  "cornsilk", "crimson", "cyan", "darkblue", "darkcyan", "darkgoldenrod",
  "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon",
  "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey",
  "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray",
  "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray",
  "green", "greenyellow", "honeydew", "hotpink", "indianred", "indigo",
  "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon",
  "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow",
  "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey",
  "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta",
  "maroon", "mediumaquamarine", "mediumblue", "mediumorchid",
  "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen",
  "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive",
  "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen",
  "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru",
  "pink", "plum", "powderblue", "purple", "rebeccapurple", "rosybrown",
  "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey",
  "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato",
  "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
];

const ALLOWED_CSS_VALUES = new Set(["transparent", "inherit", "initial", "unset", "none", "currentcolor"]);

/** Expand a path or directory into the files to scan. */
function expandPaths(paths: string | readonly string[]): string[] {
  const out: string[] = [];
  const walk = (p: string): void => {
    let stat;
    try {
      stat = statSync(p);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      let names: string[] = [];
      try {
        names = readdirSync(p).sort();
      } catch {
        return;
      }
      for (const name of names) walk(join(p, name));
      return;
    }
    out.push(p);
  };
  for (const p of typeof paths === "string" ? [paths] : paths) walk(p);
  return out;
}

/** Whether a path is exempt from `no-lane-assignment` (the lane table). */
function laneExempt(path: string, allow: readonly string[]): boolean {
  if (/(^|\/)lanes\.ts$/.test(path)) return true;
  return allow.some((a) => path === a || path.includes(a));
}

/** Strip comments and string literals (code only) so rule text never fires
 *  from a comment or a data string of the spec. */
function stripCodeComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
}

/** The findings of the code rules over one line of a .ts/.js/.mjs file. */
function codeFindings(rule: string, path: string, lineNo: number, raw: string, allow: readonly string[]): Finding[] {
  const line = stripCodeComments(raw);
  const findings: Finding[] = [];
  const push = (snippet: string): void => findings.push({ rule, path, line: lineNo, snippet: snippet.trim().slice(0, 120) });
  if (rule === "no-lane-assignment") {
    if (laneExempt(path, allow)) return findings;
    const laneAlt = LANES.join("|");
    const patterns = [
      new RegExp(`lane\\s*:\\s*"(${laneAlt})"`),
      new RegExp(`\\.lane\\s*=\\s*"(${laneAlt})"`),
      new RegExp(`case\\s*"(${laneAlt})"\\s*:`),
    ];
    if (patterns.some((re) => re.test(line))) push(raw);
    return findings;
  }
  if (rule === "markup-sink") {
    if (/innerHTML|dangerouslySetInnerHTML/.test(line)) push(raw);
    return findings;
  }
  if (rule === "nondeterminism") {
    if (/\bDate\.now\b|\bnew\s+Date\s*\(|\bMath\.random\b|\bperformance\.now\b/.test(line)) push(raw);
    return findings;
  }
  return findings;
}

/** The findings of the CSS rules over one line. */
function cssFindings(path: string, lineNo: number, raw: string): Finding[] {
  const findings: Finding[] = [];
  const push = (rule: string): void => findings.push({ rule, path, line: lineNo, snippet: raw.trim().slice(0, 120) });
  const line = raw.replace(/\/\*.*?\*\//g, "").trim();
  if (line === "") return findings;

  // css-selector: @import, prefers-color-scheme, unscoped selector line.
  if (/@import/.test(line)) push("css-selector");
  else if (/prefers-color-scheme/.test(line)) push("css-selector");
  else if (/^[^@{}][^{}]*\{\s*$/.test(line) && !/sskh-/.test(line)) push("css-selector");

  // css-colour: hex, rgb(/hsl(, named colour values, foreign var(--x),
  // non---sskh- properties with a colour value. `transparent` and a
  // `color-mix` of theme tokens are allowed.
  const colourValue = (value: string): boolean => {
    const v = value.trim().replace(/;$/, "").trim();
    if (v === "") return false;
    if (ALLOWED_CSS_VALUES.has(v.toLowerCase())) return false;
    if (/^#([0-9a-f]{3,8})$/i.test(v)) return true;
    if (/^(rgba?|hsla?)\(/i.test(v)) return true;
    if (/^color-mix\(/i.test(v)) {
      // allowed only when every referenced variable is a theme token
      const foreign = v.match(/var\(--(?!color-)[a-z0-9-]+\)/gi);
      return foreign !== null && foreign.length > 0;
    }
    if (/^var\(--(color|sskh)-[a-z0-9-]+\)$/i.test(v)) return false;
    if (/^var\(--/.test(v)) return true;
    if (/^--sskh-[a-z0-9-]+$/i.test(v)) return false;
    if (/^var\(--color-[a-z0-9-]+\)$/i.test(v)) return false;
    if (/^[a-z]+$/i.test(v) && NAMED_COLOURS.includes(v.toLowerCase())) return true;
    return false;
  };
  const hex = /#[0-9a-f]{3,8}\b/i.test(line);
  const fnColour = /\b(rgba?|hsla?)\s*\(/i.test(line);
  if (hex || fnColour) push("css-colour");
  // property declarations: `name: value`
  const decl = line.match(/([a-z-]+|--[a-z0-9-]+)\s*:\s*([^;{}]+)/gi);
  if (decl !== null) {
    for (const d of decl) {
      const m = d.match(/^([a-z-]+|--[a-z0-9-]+)\s*:\s*(.+)$/i);
      if (m === null) continue;
      const [, name, value] = m;
      if (colourValue(value)) {
        // a --sskh- custom property may hold a colour; any other property
        // with a colour literal is a colour finding
        if (!/^--sskh-/.test(name)) {
          // var(--color-*) and color-mix of tokens are fine; a named colour,
          // a hex or a foreign var is not (already caught above when bare)
          const v = value.trim();
          if (!/^var\(--color-/.test(v) && !/^color-mix\(/i.test(v)) push("css-colour");
          else if (/^color-mix\(/i.test(v) && /var\(--(?!color-)/.test(v)) push("css-colour");
        }
      }
    }
  }
  return findings;
}

/** De-duplicate findings that the same line hit through several sub-rules. */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.rule}|${f.path}|${f.line}|${f.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Scan the given files or directories for the five rules
 * (`no-lane-assignment`, `css-colour`, `css-selector`, `markup-sink`,
 * `nondeterminism`) and return every finding. */
export function scanKanban(paths: string | readonly string[], opts?: ScanOptions): Finding[] {
  const allow = opts?.allow ?? [];
  const findings: Finding[] = [];
  for (const path of expandPaths(paths)) {
    if (/\.css$/.test(path)) {
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n");
      let inBlock = false;
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (inBlock) {
          const end = line.indexOf("*/");
          if (end === -1) continue;
          line = line.slice(end + 2);
          inBlock = false;
        }
        const open = line.indexOf("/*");
        if (open !== -1 && line.indexOf("*/", open) === -1) {
          line = line.slice(0, open);
          inBlock = true;
        }
        findings.push(...cssFindings(path, i + 1, line));
      }
      continue;
    }
    if (!/\.(ts|js|mjs|jsx)$/.test(path)) continue;
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (inBlockComment) {
        const end = line.indexOf("*/");
        if (end === -1) continue;
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const open = line.indexOf("/*");
      if (open !== -1 && line.indexOf("*/", open) === -1) {
        line = line.slice(0, open);
        inBlockComment = true;
      }
      for (const rule of ["no-lane-assignment", "markup-sink", "nondeterminism"]) {
        findings.push(...codeFindings(rule, path, i + 1, line, allow));
      }
    }
  }
  return dedupe(findings);
}
