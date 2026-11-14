/**
 * T080 (PT-151-033) — the tracked contract mirrors are byte-for-byte copies
 * of their spec sources (F151-FR-027): `contracts/151-hermes-kanban/` over
 * `specs/151-hermes-kanban/contracts/`, and 150's two amended contracts
 * (`host-facts.md`, `doctor-output.md`) over `specs/150-host-hermes/contracts/`.
 * `scripts/build.ts` re-copies the set on every build (plain copyFileSync,
 * no git); this test asserts equality, so a stale or edited mirror fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIRROR_SETS, mirrorContracts, trackedMirrorFiles } from "../../scripts/mirror-contracts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

function mirrorBytes(feature: string, name: string): Buffer {
  return readFileSync(join(ROOT, "contracts", feature, name));
}

function sourceBytes(feature: string, name: string): Buffer {
  return readFileSync(join(ROOT, "specs", feature, "contracts", name));
}

test("every contract of 151 mirrors its spec source byte for byte", () => {
  const set = MIRROR_SETS.find((s) => s.feature === "151-hermes-kanban")!;
  assert.equal(set.files.length, 9, "151 mirrors its nine contract files");
  for (const name of set.files) {
    const mirror = mirrorBytes("151-hermes-kanban", name);
    const source = sourceBytes("151-hermes-kanban", name);
    assert.ok(
      Buffer.compare(mirror, source) === 0,
      `contracts/151-hermes-kanban/${name} differs from specs/151-hermes-kanban/contracts/${name}`,
    );
  }
});

test("the two amended contracts of 150 mirror their spec sources byte for byte", () => {
  const set = MIRROR_SETS.find((s) => s.feature === "150-host-hermes")!;
  assert.deepEqual(set.files, ["doctor-output.md", "host-facts.md"], "150 mirrors the two contracts 151 amended");
  for (const name of set.files) {
    assert.equal(
      Buffer.compare(mirrorBytes("150-host-hermes", name), sourceBytes("150-host-hermes", name)),
      0,
      `contracts/150-host-hermes/${name} differs from its spec source`,
    );
  }
});

test("every tracked mirror file under contracts/ is covered and byte-equal", () => {
  for (const path of trackedMirrorFiles(ROOT)) {
    const feature = path.split("/").at(-2)!;
    const name = path.split("/").at(-1)!;
    const source = join(ROOT, "specs", feature, "contracts", name);
    let sourceText: Buffer;
    try {
      sourceText = readFileSync(source);
    } catch {
      continue; // a tracked file with no spec source is not a mirror
    }
    assert.equal(Buffer.compare(readFileSync(path), sourceText), 0, `${path} differs from ${source}`);
  }
  // The phase's mirror set is part of the tracked tree.
  const tracked = trackedMirrorFiles(ROOT).map((p) => p.split("/").slice(-2).join("/"));
  for (const set of MIRROR_SETS) {
    for (const name of set.files) {
      assert.ok(tracked.includes(`${set.feature}/${name}`), `contracts/${set.feature}/${name} must exist`);
    }
  }
});

test("mirrorContracts copies the sources byte for byte into a sandbox", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "mirror151-"));
  try {
    cpSync(join(ROOT, "specs"), join(sandbox, "specs"), { recursive: true });
    const written = mirrorContracts(sandbox);
    assert.equal(written.length, 11, "the mirror step writes 9 + 2 files");
    for (const set of MIRROR_SETS) {
      for (const name of set.files) {
        const mirror = readFileSync(join(sandbox, "contracts", set.feature, name));
        const source = readFileSync(join(sandbox, "specs", set.feature, "contracts", name));
        assert.equal(Buffer.compare(mirror, source), 0, `sandbox mirror ${set.feature}/${name} differs`);
      }
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
