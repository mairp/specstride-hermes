/**
 * The pin test of 151 (T002, PT-151-054): `core-pin.json` names a core
 * commit of `27e7d71b` or newer (the list a person extends at each later
 * pin move); every `@specstride/*` dependency of `package.json` is the
 * `file:vendor/core/...` tarball of that pin; and the sha256 of each
 * tarball equals the one the pin records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const OLDER_OR_EQUAL = JSON.parse(
  readFileSync(join(ROOT, "tests/fixtures/pins-newer-than-27e7d71b.json"), "utf8"),
) as string[];
const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as {
  coreCommit: string;
  packages: { name: string; version: string; file: string; sha256: string }[];
};
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

test("the pin names core 27e7d71b or a listed newer commit", () => {
  const commit = pin.coreCommit;
  assert.match(commit, /^[0-9a-f]{40}$/, "coreCommit is a full sha");
  const ok = commit.startsWith("27e7d71b") || OLDER_OR_EQUAL.includes(commit.slice(0, 8));
  assert.equal(ok, true, `coreCommit ${commit} must be 27e7d71b or newer`);
});

test("every pinned tarball exists with the sha256 the pin records", () => {
  assert.ok(pin.packages.length >= 1, "the pin names at least one package");
  for (const entry of pin.packages) {
    const path = join(ROOT, "vendor/core", entry.file);
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(
      digest,
      entry.sha256,
      `vendor/core/${entry.file} sha256 must equal the pin's`,
    );
  }
});

test("every @specstride/* dependency is the file tarball of the pin", () => {
  const deps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const pinned = new Map(pin.packages.map((p) => [p.name, p]));
  for (const [name, spec] of Object.entries(deps)) {
    if (!name.startsWith("@specstride/") && name !== "specstride") continue;
    const entry = pinned.get(name);
    assert.ok(entry, `${name} is named by core-pin.json`);
    assert.equal(
      spec,
      `file:vendor/core/${entry.file}`,
      `${name} resolves to the pinned tarball`,
    );
  }
  for (const name of pinned.keys()) {
    assert.ok(
      deps[name] !== undefined,
      `pinned package ${name} is a dependency of package.json`,
    );
  }
});

test("the pinned packages are version 0.1.0", () => {
  for (const entry of pin.packages) {
    assert.equal(entry.version, "0.1.0");
  }
});
