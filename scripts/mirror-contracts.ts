/**
 * T080 (PT-151-033) — the build-time contract mirror (F151-FR-027, no git).
 * `specs/<feature>/contracts/` is the source of truth; `contracts/<feature>/`
 * is the byte-for-byte copy that ships with the tree (contracts/README.md).
 * A plain file copy: no `git`, no diff, no history — the mirror test asserts
 * byte equality, so a stale or edited mirror fails the build.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The mirrors this phase owns: 151's whole contract set, plus the two 150
// contracts 151 amended (host facts and doctor output, 2026-11-11).
export const MIRROR_SETS: Array<{ feature: string; files: string[] }> = [
  {
    feature: "151-hermes-kanban",
    files: [
      "card-detail.md",
      "card-projection.md",
      "closed-sets.json",
      "lane-map.md",
      "plugin-api.md",
      "presentation.md",
      "sync-sidecar.md",
      "tab-manifest.md",
      "workspace-reader.md",
    ],
  },
  {
    feature: "150-host-hermes",
    files: ["doctor-output.md", "host-facts.md"],
  },
];

/** Copy each contract of the mirror set from its spec source into the
 * tracked mirror, byte for byte. Returns the mirror paths written. */
export function mirrorContracts(root: string = ROOT): string[] {
  const written: string[] = [];
  for (const set of MIRROR_SETS) {
    const outDir = join(root, "contracts", set.feature);
    mkdirSync(outDir, { recursive: true });
    for (const name of set.files) {
      const source = join(root, "specs", set.feature, "contracts", name);
      const mirror = join(outDir, name);
      copyFileSync(source, mirror);
      written.push(mirror);
    }
  }
  return written;
}

// The features that already mirror under contracts/ (README table) — used by
// the mirror test to cover every tracked file, not just this phase's set.
export function trackedMirrorFiles(root: string = ROOT): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, "contracts"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // README.md and friends are not mirrors
    const dir = join(root, "contracts", entry.name);
    for (const name of readdirSync(dir)) files.push(join(dir, name));
  }
  return files;
}
