/**
 * The frontmatter tests of the Hermes host (T013, PT-150-003): one failing
 * case per rule of research R2, plus the passing case. The build validates
 * every rendered skill with the same `validateFrontmatter`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  insertFrontmatter,
  validateFrontmatter,
  type FrontmatterInput,
} from "../../src/frontmatter.ts";

const good: FrontmatterInput = {
  name: "specstride-run",
  description: "Run Specstride on the finished features of this repository.",
  version: "0.1.0",
  tags: ["specstride", "run"],
};

function textWith(overrides: Partial<FrontmatterInput>): string {
  return insertFrontmatter(
    { spelling: overrides.name ?? good.name, description: overrides.description ?? good.description, body: "Body line.\n" },
    { version: overrides.version ?? good.version, tags: overrides.tags ?? good.tags },
  );
}

/** A hand-written frontmatter document, for rule-by-rule breaches. */
function handwritten(lines: string[]): string {
  return ["---", ...lines, "---", "", "Body line.", ""].join("\n");
}

test("a conforming skill validates and round-trips", () => {
  const text = textWith({});
  const verdict = validateFrontmatter(text);
  assert.deepEqual(verdict.errors, []);
  assert.equal(verdict.ok, true);
  assert.match(text, /^---\nname: specstride-run\n/);
  assert.match(text, /license: Apache-2.0/);
  assert.match(text, /platforms: \[linux, macos\]/);
  assert.match(text, /category: specstride/);
  assert.match(text, /requires_toolsets: \[terminal\]/);
  assert.match(text, /host: hermes\n/);
});

test("a name breaking the pattern fails", () => {
  const text = handwritten([
    "name: Specstride-Run",
    'description: "x"',
    "version: 0.1.0",
    "license: Apache-2.0",
    "platforms: [linux, macos]",
    "metadata:",
    "  hermes:",
    "    tags: [specstride]",
    "    category: specstride",
    "    requires_toolsets: [terminal]",
    "  specstride:",
    "    version: 0.1.0",
    "    host: hermes",
  ]);
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("name")));
});

test("a name over 64 characters fails", () => {
  const long = "a".repeat(65);
  const text = handwritten([
    `name: ${long}`,
    'description: "x"',
    "version: 0.1.0",
    "license: Apache-2.0",
    "platforms: [linux, macos]",
    "metadata:",
    "  hermes:",
    "    tags: [specstride]",
    "    category: specstride",
    "    requires_toolsets: [terminal]",
    "  specstride:",
    "    version: 0.1.0",
    "    host: hermes",
  ]);
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("over the cap of 64")));
});

test("a description over 1024 characters fails", () => {
  const text = textWith({ description: "x".repeat(1025) });
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("description")));
  assert.ok(verdict.errors.some((error) => error.includes("1024")));
});

test("a missing version fails", () => {
  const text = textWith({}).replace(/^version: .*\n/m, "");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("version is missing")));
});

test("a license other than Apache-2.0 fails", () => {
  const text = textWith({}).replace(/^license: .*\n/m, "license: MIT\n");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("license")));
});

test("wrong platforms fail", () => {
  const text = textWith({}).replace(/^platforms: .*\n/m, "platforms: [linux, win32]\n");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("platforms")));
});

test("a wrong metadata.hermes.category fails", () => {
  const text = textWith({}).replace(/^    category: .*\n/m, "    category: other\n");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("category")));
});

test("wrong metadata.hermes.requires_toolsets fail", () => {
  const text = textWith({}).replace(
    /^    requires_toolsets: .*\n/m,
    "    requires_toolsets: [terminal, shell]\n",
  );
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("requires_toolsets")));
});

test("empty metadata.hermes.tags fail", () => {
  const text = textWith({}).replace(/^    tags: .*\n/m, "    tags: []\n");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("tags")));
});

test("a wrong metadata.specstride.host fails", () => {
  const text = textWith({}).replace(/^    host: .*\n/m, "    host: dsh\n");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("host")));
});

test("a wrong metadata.specstride.version fails", () => {
  const text = textWith({}).replace(/^(---\n(?:.*\n)*?)    version: .*\n/m, "$1");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("metadata.specstride.version")));
});

test("an unknown top-level field fails", () => {
  const text = textWith({}).replace(/^version: /m, "harness: hermes-agent\nversion: ");
  const verdict = validateFrontmatter(text);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("unknown top-level field: harness")));
});
