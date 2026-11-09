/**
 * The release/packaging tests of the Hermes host (T072, PT-150-026,
 * PT-150-027): no install script and nothing compiled at install, every
 * `@specstride/*` dependency an exact `file:vendor/core` pin matching
 * `core-pin.json` (and the tarball's sha256), the eval suites and fixtures
 * absent from `files`, and a release template that names the engine version.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

type Manifest = {
  version: string;
  files?: string[];
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  specstride: { protocol: { min: number; max: number }; engineVersion: string };
};

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
const pin = JSON.parse(readFileSync(join(ROOT, "core-pin.json"), "utf8")) as {
  version: string;
  coreCommit: string;
  packages: { name: string; version: string; file: string; sha256: string }[];
};

const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepublish", "prepack", "prepare"];

test("the package has no install script and nothing compiled at install", () => {
  for (const script of INSTALL_SCRIPTS) {
    assert.equal(
      manifest.scripts[script],
      undefined,
      `package.json declares the install script "${script}" (F150-FR-026)`,
    );
  }
});

test("every @specstride/* dependency is an exact file:vendor/core pin matching core-pin.json", () => {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const pinned = Object.fromEntries(pin.packages.map((p) => [p.name, p]));
  const specstrideDeps = Object.entries(deps).filter(([name]) => name.startsWith("@specstride/") || name === "specstride");
  assert.ok(specstrideDeps.length >= 4, "the four engine packages are not all declared");
  for (const [name, spec] of specstrideDeps) {
    const entry = pinned[name];
    assert.ok(entry, `${name} is not in core-pin.json`);
    assert.equal(spec, `file:vendor/core/${entry.file}`, `${name} is not the exact vendor pin (${spec})`);
    const tarball = join(ROOT, "vendor", "core", entry.file);
    assert.ok(existsSync(tarball), `the pinned tarball ${entry.file} is absent`);
    assert.equal(
      createHash("sha256").update(readFileSync(tarball)).digest("hex"),
      entry.sha256,
      `the sha256 of ${entry.file} no longer matches core-pin.json`,
    );
    assert.equal(entry.version, manifest.specstride.engineVersion, `${name} pin and engineVersion drift`);
  }
});

test("the eval suites and fixtures are absent from files", () => {
  const files = manifest.files ?? [];
  for (const entry of files) {
    assert.ok(!entry.includes("evals"), `"${entry}" ships the eval suites or fixtures (F150-FR-026)`);
    assert.ok(!/tests?\//.test(entry), `"${entry}" ships a test directory (F150-FR-026)`);
    assert.ok(!entry.includes("specs/"), `"${entry}" ships the spec corpus (F150-FR-026)`);
  }
  assert.ok(!existsSync(join(ROOT, "evals")) || files.every((f) => !f.startsWith("evals")));
});

test("the release template names the engine version and its pin", () => {
  const templatePath = join(ROOT, "docs", "release-template.md");
  assert.ok(existsSync(templatePath), "docs/release-template.md is missing (F150-FR-027)");
  const template = readFileSync(templatePath, "utf8");
  assert.match(template, new RegExp(manifest.specstride.engineVersion), "the template does not name the engine version");
  assert.match(template, /core-pin\.json/, "the template does not point at the pin");
  assert.match(template, /coreCommit/, "the template does not name the core commit");
  assert.match(template, /protected branch/, "the template does not require a protected branch (F150-FR-027)");
  assert.match(template, /F150-FR-027/, "the template does not cite F150-FR-027");
});
