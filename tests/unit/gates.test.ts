/**
 * The static-gate tests of the Hermes host (T022): each gate flags a failing
 * fixture in a tests-only temporary tree, and passes the clean repository
 * tree. No fixture ever lives inside the shipped directories.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  allGateFindings,
  checkCliSpawnScan,
  checkLanguageLedger,
  checkNoBash,
  checkNoEngineCopy,
  checkNoLogicInPython,
  checkReferenceClosure,
} from "../../src/gates.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "gates-fixture-"));
}

test("the clean repository tree passes every gate", () => {
  const findings = allGateFindings(ROOT);
  assert.deepEqual(findings, []);
});

test("no-engine-copy flags a build output that matches an engine file", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "skills", "specstride", "x"), { recursive: true });
    const engineFile = join(ROOT, "node_modules", "@specstride", "host-kit", "dist", "render.js");
    copyFileSync(engineFile, join(root, "skills", "specstride", "x", "copied.md"));
    const findings = checkNoEngineCopy(root, ROOT);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /no-engine-copy: .*copied\.md matches the engine file/);
    rmSync(join(root, "skills", "specstride", "x", "copied.md"));
    assert.deepEqual(checkNoEngineCopy(root, ROOT), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference-closure flags a skill path into product source, state or logs", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "skills", "specstride", "x"), { recursive: true });
    const path = join(root, "skills", "specstride", "x", "SKILL.md");
    writeFileSync(path, "Read ../src/profile.ts first.\n");
    let findings = checkReferenceClosure(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /path into product source/);
    writeFileSync(path, "Engine state lives under $XDG_STATE_HOME/specstride/cache.\n");
    findings = checkReferenceClosure(root);
    assert.match(findings[0], /engine state/);
    writeFileSync(path, "Then read build/logs/render.txt.\n");
    findings = checkReferenceClosure(root);
    assert.match(findings[0], /logs/);
    writeFileSync(path, "Host state only: $HERMES_HOME/specstride-host/watch.json.\n");
    assert.deepEqual(checkReferenceClosure(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli-spawn flags a source file that spawns the engine executable", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "rogue.ts"), 'spawnSync("specstride", argv);\n');
    let findings = checkCliSpawnScan(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /src\/rogue\.ts names the engine executable/);
    writeFileSync(join(root, "src", "rogue.ts"), 'const line = "run: specstride launch";\n');
    findings = checkCliSpawnScan(root);
    assert.equal(findings.length, 1);
    // A data string — a tag, a metadata key — is not a spawn.
    writeFileSync(join(root, "src", "rogue.ts"), 'const tags = ["specstride", "run"];\n');
    assert.deepEqual(checkCliSpawnScan(root), []);
    // The allowlist holds: the shim and its generator are never flagged.
    mkdirSync(join(root, "bin"), { recursive: true });
    copyFileSync(join(ROOT, "src", "shim.ts"), join(root, "src", "shim.ts"));
    copyFileSync(join(ROOT, "bin", "specstride-hermes.mjs"), join(root, "bin", "specstride-hermes.mjs"));
    assert.deepEqual(checkCliSpawnScan(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("language-ledger flags an unlisted .py file, a stray .py file and dependency keys", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    copyFileSync(join(ROOT, "docs", "language-ledger.md"), join(root, "docs", "language-ledger.md"));
    mkdirSync(join(root, "hermes-plugin", "specstride"), { recursive: true });
    writeFileSync(join(root, "hermes-plugin", "specstride", "extra.py"), "x = 1\n");
    let findings = checkLanguageLedger(root);
    assert.ok(findings.some((f) => f.includes("extra.py has no row in docs/language-ledger.md")));
    writeFileSync(join(root, "src-stray.py"), "y = 2\n");
    mkdirSync(join(root, "systemd"), { recursive: true });
    writeFileSync(join(root, "systemd", "stray.py"), "y = 2\n");
    findings = checkLanguageLedger(root);
    assert.ok(findings.some((f) => f.includes("systemd/stray.py is outside hermes-plugin/")));
    copyFileSync(join(ROOT, "hermes-plugin", "specstride", "plugin.yaml"), join(root, "hermes-plugin", "specstride", "plugin.yaml"));
    const clean = readFileSync(join(root, "hermes-plugin", "specstride", "plugin.yaml"), "utf8");
    assert.ok(!findings.some((f) => f.includes("pip_dependencies")), "the clean manifest carries no dependency keys");
    writeFileSync(join(root, "hermes-plugin", "specstride", "plugin.yaml"), clean + "pip_dependencies: [requests]\n");
    findings = checkLanguageLedger(root);
    assert.ok(findings.some((f) => f.includes("pip_dependencies")));
    writeFileSync(join(root, "hermes-plugin", "specstride", "plugin.yaml"), clean.replace(/python_runtime: .*/, "python_runtime: venv"));
    findings = checkLanguageLedger(root);
    assert.ok(findings.some((f) => f.includes("python_runtime: external")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no-logic-in-python flags import re and launch strings", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "hermes-plugin", "specstride"), { recursive: true });
    const path = join(root, "hermes-plugin", "specstride", "__init__.py");
    writeFileSync(path, "import re\n\nx = 1\n");
    let findings = checkNoLogicInPython(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /imports re/);
    writeFileSync(path, "from re import compile\n");
    assert.equal(checkNoLogicInPython(root).length, 1);
    writeFileSync(path, 'MSG = "run specstride launch now"\n');
    findings = checkNoLogicInPython(root);
    assert.match(findings[0], /launch string/);
    writeFileSync(path, "import json\n\nx = 1\n");
    assert.deepEqual(checkNoLogicInPython(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no-bash flags a .sh file shipped in files", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ files: ["bin/", "systemd/"] }) + "\n",
    );
    assert.deepEqual(checkNoBash(root), []);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ files: ["bin/", "scripts/install.sh"] }) + "\n",
    );
    let findings = checkNoBash(root);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /no-bash: package\.json ships scripts\/install\.sh/);
    writeFileSync(join(root, "package.json"), JSON.stringify({ files: ["systemd/"] }) + "\n");
    mkdirSync(join(root, "systemd"), { recursive: true });
    writeFileSync(join(root, "systemd", "helper.sh"), "#!/bin/sh\n");
    findings = checkNoBash(root);
    assert.match(findings[0], /systemd\/helper\.sh ships in files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
