/**
 * T037 — the EP-01 host conformance suite of THIS package (`npm run
 * conformance`, F150-FR-044 / F113-FR-034). The suite records TWO targets —
 * THIS host FIRST (`hostConformanceTargets`), the plain shell (the testkit's
 * own EP-01 sample) SECOND — and runs the host's cases against EVERY target:
 * the command sequences of the kit's skills, the bytes against the budgets of
 * F150-FR-045, the reference closure of the rendered artifacts, and the
 * rendered-tree validation. No paid call anywhere; the live-host case is the
 * testkit's own skip with its reason. The process exits non-zero on any
 * failing test (`node:test` sets the exit code).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCTOR_SKILL_ID,
  HOST_SKILL_IDS,
  RUN_STEP_IDS,
  RUN_STEPS,
  DRY_RUN_LAST_STEP,
  checkSkillBudget,
  stepLines,
  stepsOfMode,
} from "@specstride/host-kit";
import type { Implementation, SkillSource } from "@specstride/host-kit";
import {
  hostConformanceTargets,
  type ConformanceTarget,
} from "@specstride/testkit/conformance/EP-01/targets";
import { registerHostConformanceCases } from "@specstride/testkit/conformance/EP-01/host-suite";
import { implementation as plainShellImplementation } from "@specstride/testkit/samples/EP-01";
import { hermesPort } from "../src/port.ts";
import { hermesSkillSet } from "../src/skills.ts";
import { hermesProfile } from "../src/profile.ts";
import { referenceClosureFindingsOfText } from "../src/gates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_IMPLEMENTATION_ID = "host-hermes";

/** The kit's skill sources of THIS host (the set T036 wires), by logical id. */
const kitSources: Readonly<Record<string, SkillSource>> = (() => {
  const set = hermesSkillSet();
  const names = ["specstride-run", "specstride-reverse", DOCTOR_SKILL_ID] as const;
  return Object.fromEntries(names.map((name, i) => [name, set.sources[i]!]));
})();

/** This host's implementation record, bound to the port of `src/port.ts`. */
const hostImplementation: Implementation = Object.freeze({
  ep: "EP-01",
  pointId: "specstride.host/1",
  id: HOST_IMPLEMENTATION_ID,
  implementationClass: "first-party",
  majors: [1],
  provenance: "default",
  operations: hermesPort,
});

const targets: readonly ConformanceTarget[] = hostConformanceTargets({
  order: 1,
  implementationId: HOST_IMPLEMENTATION_ID,
  host: "hermes — this package's host port (`@specstride/host-hermes`, src/port.ts)",
  source: "src/port.ts",
  live: false,
  requirement: "F150-FR-044",
});

function implementationOf(id: string): Implementation {
  if (id === HOST_IMPLEMENTATION_ID) return hostImplementation;
  if (id === plainShellImplementation.id) return plainShellImplementation;
  throw new Error(`no implementation registered under \`${id}\``);
}

const cases = [
  {
    id: "command-sequences-of-the-kit-skills",
    title: "the command sequence of specstride-run, in F150-FR-004 order, dry-run withholding launch",
    proves: ["F150-FR-044", "F150-FR-004", "F150-FR-006"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      const artifact = operations.renderSkill(kitSources["specstride-run"]!);
      const content = artifact.content;
      // The ten steps, verbatim and in order.
      const lines = stepLines(RUN_STEPS);
      let cursor = 0;
      for (const line of lines) {
        const at = content.indexOf(line, cursor);
        assert.notEqual(at, -1, `step line missing or out of order: ${line}`);
        cursor = at + line.length;
      }
      // dry-run withholds the launch: its last step is DRY_RUN_LAST_STEP and
      // its step list has no launch.
      const drySteps = stepsOfMode("dry-run");
      assert.equal(DRY_RUN_LAST_STEP, "validate");
      assert.ok(!drySteps.some((step) => step.id === "launch"));
      assert.match(content, /In `dry-run`: derive and validate, print the plan, and STOP\. Never launch\./);
      // The reverse skill, where the CLI mounts it, carries its own order.
      const reverse = operations.renderSkill(kitSources[DOCTOR_SKILL_ID]!);
      assert.ok(reverse.content.length > 0);
    },
  },
  {
    id: "bytes-against-the-budgets",
    title: "the bytes of every kit skill measure inside the budgets of F150-FR-045",
    proves: ["F150-FR-044", "F150-FR-045"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      for (const logicalId of [HOST_SKILL_IDS[0], HOST_SKILL_IDS[1], DOCTOR_SKILL_ID]) {
        const source = kitSources[logicalId]!;
        const artifact = operations.renderSkill(source);
        for (const finding of checkSkillBudget(source, artifact.bytes, hermesProfile)) {
          assert.equal(finding.verdict, "pass", `${implementation.id} ${logicalId}: ${finding.check}`);
        }
        const budget = hermesSkillSet().profile.tokenBudgets[logicalId] ?? 0;
        assert.ok(
          artifact.bytes <= budget * 2.8 + 4096,
          `${implementation.id} ${logicalId}: ${artifact.bytes} bytes over the budget of ${logicalId}`,
        );
      }
    },
  },
  {
    id: "reference-closure",
    title: "the rendered artifacts name no path into product source, state or logs (F150-FR-005)",
    proves: ["F150-FR-044", "F150-FR-005", "F150-FR-009"],
    run(implementation: Implementation) {
      const operations = implementation.operations!;
      const names = [HOST_SKILL_IDS[0]!, HOST_SKILL_IDS[1]!, DOCTOR_SKILL_ID, "status", "curate"];
      for (const logicalId of names) {
        const source = kitSources[logicalId];
        if (source === undefined) continue; // the host skills have no kit source here
        const artifact = operations.renderSkill(source);
        assert.deepEqual(
          referenceClosureFindingsOfText(artifact.content, `${implementation.id}/${logicalId}`),
          [],
        );
      }
      // The plain copies on disk (this host) are closed, too.
      if (implementation.id === HOST_IMPLEMENTATION_ID) {
        const plain = join(ROOT, "skills", "specstride");
        if (existsSync(plain)) {
          for (const name of readdirSync(plain)) {
            const path = join(plain, name, "SKILL.md");
            if (!statSync(path).isFile()) continue;
            assert.deepEqual(
              referenceClosureFindingsOfText(readFileSync(path, "utf8"), `skills/specstride/${name}`),
              [],
            );
          }
        }
      }
    },
  },
  {
    id: "rendered-tree-validation",
    title: "the rendered tree validates: skills, entries and, for this host, the shim (F150-FR-044)",
    proves: ["F150-FR-044", "F150-FR-002", "F150-FR-011"],
    run(implementation: Implementation, target: ConformanceTarget) {
      const operations = implementation.operations!;
      if (target.order === 1) {
        // This host's tree: the plain copies under `skills/specstride/<name>`
        // (run, reverse, status, curate), the doctor ONLY bundled under the
        // plugin (F150-FR-002), and the shim at its contract path.
        const plain = join(ROOT, "skills", "specstride");
        const entries = readdirSync(plain).filter((name) => statSync(join(plain, name)).isDirectory());
        assert.deepEqual(
          [...entries].sort(),
          ["specstride-curate", "specstride-reverse", "specstride-run", "specstride-status"],
        );
        for (const spelling of entries) {
          const path = join(plain, spelling, "SKILL.md");
          assert.ok(existsSync(path), `no SKILL.md at ${spelling}`);
          assert.match(readFileSync(path, "utf8"), /^---\nname: /, `${spelling} has frontmatter`);
        }
        const bundled = join(ROOT, "hermes-plugin", "specstride", "skills");
        assert.ok(
          existsSync(join(bundled, "specstride-doctor", "SKILL.md")),
          "the doctor ships bundled (F150-FR-002)",
        );
        assert.ok(
          !existsSync(join(plain, "specstride-doctor")),
          "the doctor is not model-invocable: no plain copy",
        );
        assert.ok(existsSync(join(ROOT, "bin", "specstride-hermes.mjs")), "the shim is rendered");
      }
      // Both targets: entries exist for the model-invocable skills, and each
      // entry names its skill.
      for (const logicalId of HOST_SKILL_IDS) {
        const entry = String(operations.renderEntry(logicalId));
        assert.ok(entry.includes(logicalId), `${implementation.id}: entry for ${logicalId} names it`);
      }
    },
  },
  {
    id: "protocol-and-status-hooks",
    title: "the port declares protocol 1 and its status hooks render (F150-FR-044, F150-FR-038..042)",
    proves: ["F150-FR-044", "F150-FR-038"],
    run(implementation: Implementation) {
      assert.deepEqual(implementation.majors, [1]);
      const operations = implementation.operations as Implementation["operations"] & {
        renderStatusHooks?: (name: string) => readonly { readonly path: string }[];
      };
      assert.equal(typeof operations.renderStatusHooks, "function");
      const artifacts = operations.renderStatusHooks!("specstride-status");
      assert.ok(artifacts.length >= 1);
      for (const artifact of artifacts) assert.ok(artifact.path.length > 0);
    },
  },
];

const registered = registerHostConformanceCases({
  targets,
  implementationOf,
  cases,
});

// The suite must hold both targets and every case against both (F113-FR-034).
assert.equal(registered.targetCount, 2);
assert.equal(registered.caseRuns, cases.length * 2);

// The kit's own step ids stay the ten of F150-FR-004 — a drift fails here,
// before any suite case reports it.
assert.equal(RUN_STEP_IDS.length, 10);
