/**
 * T054 (PT-151-049; F151-FR-049) — brace balance over the stylesheet and
 * the built dist copy: with comments removed, the depth of `{` and `}` is
 * never below 0 and is 0 at the end; depth above 1 is allowed only inside an
 * @media, @supports or @layer block. Regression of the dsh stylesheet: one
 * stray brace emptied every rule after it while the tree tests still passed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SHEETS = [
  join(REPO, "src", "tab", "client", "styles.css"),
  join(REPO, "hermes-plugin", "specstride", "dashboard", "dist", "style.css"),
];

/** The stylesheet with its comments removed. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The brace depths, one entry per character position that changes depth. */
function depths(css: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") out.push(++depth);
    if (ch === "}") out.push(--depth);
  }
  return out;
}

/** Whether position `index` of the depth trail sits inside an at-rule block. */
function insideAtRule(css: string, index: number): boolean {
  const head = css.slice(0, index);
  const opens = head.lastIndexOf("{");
  const headToOpen = head.slice(0, opens);
  return /@(media|supports|layer)[^{]*$/.test(headToOpen);
}

for (const sheet of SHEETS) {
  test(`brace balance: ${sheet}`, () => {
    assert.ok(existsSync(sheet), `${sheet} exists (run the build for dist/style.css)`);
    const css = stripComments(readFileSync(sheet, "utf8"));
    const trail = depths(css);
    const below = trail.findIndex((d) => d < 0);
    assert.ok(below === -1, `depth never below 0 (first at trail index ${below})`);
    assert.equal(trail.at(-1) ?? 0, 0, "depth is 0 at the end");
    for (let i = 0; i < trail.length; i++) {
      if (trail[i] > 1) {
        assert.ok(
          insideAtRule(css, i),
          `depth above 1 only inside @media/@supports/@layer (at trail index ${i})`,
        );
      }
    }
  });
}
