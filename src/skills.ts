/**
 * The SkillSetHost binding of the Hermes host (T019, data-model.md, research
 * R3): the kit's run, reverse and doctor skill sources, the two skills of
 * this package under `skills-src/{status,curate}`, and the Hermes host block
 * table (`src/runtime-notes.ts`) rendered into `SkillRender[]`, every body
 * line of which carries an attribution — a host-kit source id, a
 * `curate-source`, an `HF-…` id or a runtime-notes id (F150-FR-004; the
 * build's unattributed-line gate holds the build to it).
 *
 * Copies (R3): run, reverse, status and curate ship `plain` AND `bundled`;
 * the doctor ships `bundled` ONLY, so it never enters the model's resident
 * catalog (F150-FR-002). The reverse skill is `gated`: it is installed only
 * where the CLI lists `reverse` (data-model.md).
 */
import {
  audienceNoticeSectionOf,
  bodyBudgetsOf,
  bodyBytes,
  byteBudgetOf,
  dataFramingSection,
  doctorSkillSourceOf,
  judgmentSectionOf,
  prohibitionSectionOf,
  prohibitionsOf,
  renderSkill,
  reverseSkillSourceOf,
  supervisionSectionOf,
  runSkillSourceOf,
  RUN_SKILL_DESCRIPTION,
  REVERSE_SKILL_DESCRIPTION,
  DOCTOR_SKILL_DESCRIPTION,
  type SkillSource,
} from "@specstride/host-kit";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesEntry, hermesProfile, BYTES_PER_TOKEN } from "./profile.ts";
import { runtimeNotes, type RuntimeNote } from "./runtime-notes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_SRC = join(HERE, "..", "skills-src");

/** The shared sections both supervising skills carry, over this host's figures. */
const sharedSections = () => ({
  judgment: judgmentSectionOf({ delegatesToAHarness: true }),
  supervision: supervisionSection(),
  audienceNotice: audienceNoticeSectionOf({
    harnessClause:
      "the model harness of Hermes runs under the consumer's own configuration and authentication",
    authTier: "the harness's configured authentication tier, as Hermes holds it",
  }),
  dataFraming: dataFramingSection(),
  prohibitions: prohibitionSectionOf(
    prohibitionsOf({
      "no-repository-write": { requirement: "F150-FR-006", origin: null },
      "no-verification-file": { requirement: "F150-FR-007", origin: null },
      "no-cli-search": { requirement: "F150-FR-011", origin: null },
      "logical-names-only": { requirement: "F150-FR-005", origin: null },
      "no-launcher-edit": { requirement: "F150-FR-009", origin: null },
      "supervision-reads-only": { requirement: "F150-FR-010", origin: null },
    }),
  ),
});

function supervisionSection() {
  // The kit's supervision section over this host's budgets (cycle 150,
  // supervision 3000; no background primitive — R2/R6).
  return supervisionSectionOf({
    backgroundPresent: false,
    cycleTokenBudget: hermesProfile.tokenBudgets["cycle"] ?? 0,
    runSupervisionTokenBudget: hermesProfile.tokenBudgets["supervision"] ?? 0,
  });
}

/** The body-limit check the kit's skill sources are built under. */
const bodyBudgets = bodyBudgetsOf({
  bodyTokenLimits: {
    "specstride-run": hermesProfile.tokenBudgets["run"] ?? 0,
    "specstride-reverse": hermesProfile.tokenBudgets["reverse"] ?? 0,
    doctor: hermesProfile.tokenBudgets["doctor"] ?? 0,
    status: hermesProfile.tokenBudgets["status"] ?? 0,
    curate: hermesProfile.tokenBudgets["curate"] ?? 0,
  },
  printedBodyByteLimits: {
    "specstride-run": (hermesProfile.tokenBudgets["run"] ?? 0) * BYTES_PER_TOKEN,
    "specstride-reverse": (hermesProfile.tokenBudgets["reverse"] ?? 0) * BYTES_PER_TOKEN,
    doctor: (hermesProfile.tokenBudgets["doctor"] ?? 0) * BYTES_PER_TOKEN,
    status: (hermesProfile.tokenBudgets["status"] ?? 0) * BYTES_PER_TOKEN,
    curate: (hermesProfile.tokenBudgets["curate"] ?? 0) * BYTES_PER_TOKEN,
  },
  bytesPerToken: BYTES_PER_TOKEN,
  designPoint:
    "F150-FR-045 — the body budgets of the Hermes host (research R2), measured at 2.8 bytes/token",
});

/** The kit's total-byte budget for a logical id, in bytes. */
function totalBytesOf(logicalId: string): number {
  const budget = byteBudgetOf(logicalId, hermesProfile);
  if (budget === undefined) throw new Error(`no byte budget for ${logicalId}`);
  return budget;
}

/** The body of a host skill of this package, read from `skills-src/`. */
function sourceBodyOf(name: string, file = "SKILL.md"): string {
  return readFileSync(join(SKILLS_SRC, name, file), "utf8");
}

/** One rendered skill of this host (data-model.md, "SkillRender"). */
export type SkillRender = {
  /** The kit id, or `status` / `curate`. */
  readonly logicalId: string;
  /** The Hermes spelling, the frontmatter `name`. */
  readonly spelling: string;
  /** Where the skill ships; the doctor ships `bundled` only (R3). */
  readonly copies: readonly ("plain" | "bundled")[];
  /** The frontmatter fields, validated by the build. */
  readonly frontmatter: {
    readonly name: string;
    readonly description: string;
    readonly tags: readonly string[];
  };
  /** Every body line, with the attribution the unattributed-line gate reads. */
  readonly bodyLines: readonly { readonly text: string; readonly attribution: string }[];
  /** The bytes of the rendered file. */
  readonly bytes: number;
  /** The tokens at the profile's rate: bytes / 2.8. */
  readonly tokens: number;
  /** The sha256 of the rendered file. */
  readonly contentHash: string;
  /** True where the skill installs only when the CLI lists its command. */
  readonly gated: boolean;
};

const ALL_NOTES: readonly string[] = [
  "launch-foreground",
  "shim-mapping",
  "survival",
  "state-home",
  "audience-notice",
  "relay-context",
];

const HOST_NOTES: readonly string[] = ["shim-mapping", "state-home", "relay-context"];

/** The note blocks a skill carries, by logical id. */
function notesOf(logicalId: string): readonly RuntimeNote[] {
  const ids = logicalId === "specstride-run" || logicalId === "specstride-reverse"
    ? ALL_NOTES
    : HOST_NOTES;
  return ids.map((id) => {
    const note = runtimeNotes.find((n) => n.id === id);
    if (!note) throw new Error(`runtime note ${id} is missing`);
    return note;
  });
}

/**
 * One render: the kit's or the host's body, the runtime-note blocks appended,
 * every line attributed, budget-checked by the kit's `renderSkill` with the
 * profile of T011.
 */
function renderOne(input: {
  readonly logicalId: string;
  readonly source: SkillSource;
  readonly description: string;
  readonly tags: readonly string[];
  readonly kitAttribution: string;
  readonly copies: readonly ("plain" | "bundled")[];
  readonly gated: boolean;
}): SkillRender {
  const blocks = notesOf(input.logicalId);
  const noteText = blocks.map((note) => note.lines.join("\n")).join("\n\n");
  const body = input.source.body.replace(/\n+$/, "") + "\n\n" + noteText + "\n";
  const attributedBody: { text: string; attribution: string }[] = [];
  const kitLines = input.source.body.replace(/\n+$/, "").split("\n");
  for (const line of kitLines) attributedBody.push({ text: line, attribution: input.kitAttribution });
  for (const note of blocks) {
    for (const line of note.lines) attributedBody.push({ text: line, attribution: note.id });
  }
  // The kit's render: budget-exceeded on a byte breach or over the 500-line
  // body cap (F150-FR-045), and the UnknownLogicalIdError of F150-FR-001.
  const artifact = renderSkill(
    { logicalId: input.logicalId, body, references: input.source.references, budget: input.source.budget },
    hermesProfile,
    { description: input.description },
  );
  const bytes = Buffer.byteLength(artifact.content, "utf8");
  return {
    logicalId: input.logicalId,
    spelling: hermesEntry(input.logicalId),
    copies: input.copies,
    frontmatter: { name: hermesEntry(input.logicalId), description: input.description, tags: input.tags },
    bodyLines: attributedBody,
    bytes,
    tokens: bytes / BYTES_PER_TOKEN,
    contentHash: createHash("sha256").update(artifact.content).digest("hex"),
    gated: input.gated,
  };
}

/** The renders of the host's whole skill set, in the order the host writes them. */
export function hermesSkillRenders(): readonly SkillRender[] {
  const sections = sharedSections();
  const budgets = { totalBytes: totalBytesOf("specstride-run"), assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit };
  const runSource = runSkillSourceOf({
    sections,
    oldModeNamesLine:
      "This host has no predecessor skill: the modes are `run` (the default) and `dry-run`, decided only by an explicit mode or by the comment.",
    budgets,
  });
  const reverseSource = reverseSkillSourceOf({
    sections,
    budgets: {
      totalBytes: totalBytesOf("specstride-reverse"),
      assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit,
    },
  });
  const doctorSource = doctorSkillSourceOf({
    totalBytes: totalBytesOf("doctor"),
    assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit,
  });
  const statusBody = sourceBodyOf("status", "source.md");
  // T050: the curate body renders from `source.md`, the read-only port of
  // the source of record (line ids in `retarget.json`), not a SKILL.md draft.
  const curateBody = sourceBodyOf("curate", "source.md");
  return [
    renderOne({
      logicalId: "specstride-run",
      source: runSource,
      description: RUN_SKILL_DESCRIPTION,
      tags: ["specstride", "run", "launch", "supervision"],
      kitAttribution: "host-kit:skill-run",
      copies: ["plain", "bundled"],
      gated: false,
    }),
    renderOne({
      logicalId: "specstride-reverse",
      source: reverseSource,
      description: REVERSE_SKILL_DESCRIPTION,
      tags: ["specstride", "reverse", "specify"],
      kitAttribution: "host-kit:skill-reverse",
      copies: ["plain", "bundled"],
      gated: true,
    }),
    renderOne({
      logicalId: "doctor",
      source: doctorSource,
      description: DOCTOR_SKILL_DESCRIPTION,
      tags: ["specstride", "doctor", "checks"],
      kitAttribution: "host-kit:skill-doctor",
      copies: ["bundled"],
      gated: false,
    }),
    renderOne({
      logicalId: "status",
      source: {
        logicalId: "status",
        body: statusBody,
        references: [],
        budget: totalBytesOf("status"),
      },
      description:
        "Show the state of a Specstride run on this Hermes host from the precomputed status line, without starting anything.",
      tags: ["specstride", "status"],
      kitAttribution: "curate-source",
      copies: ["plain", "bundled"],
      gated: false,
    }),
    renderOne({
      logicalId: "curate",
      source: {
        logicalId: "curate",
        body: curateBody,
        references: [],
        budget: totalBytesOf("curate"),
      },
      description:
        "Reconcile the Spec Kit corpus of this repository for the Hermes host: backup, checks, retargeting rules, analyze refresh.",
      tags: ["specstride", "curate", "spec-kit"],
      kitAttribution: "curate-source",
      copies: ["plain", "bundled"],
      gated: false,
    }),
  ];
}

/** The bytes a rendered body measures, at UTF-8 — re-exported for the gates. */
export { bodyBytes };

/** The SkillSetHost the kit's set functions take, if a caller wants the kit's view. */
export function hermesSkillSet() {
  const sections = sharedSections();
  const runBudgets = {
    totalBytes: totalBytesOf("specstride-run"),
    assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit,
  };
  const sources: readonly SkillSource[] = [
    runSkillSourceOf({
      sections,
      oldModeNamesLine:
        "This host has no predecessor skill: the modes are `run` (the default) and `dry-run`, decided only by an explicit mode or by the comment.",
      budgets: runBudgets,
    }),
    reverseSkillSourceOf({
      sections,
      budgets: {
        totalBytes: totalBytesOf("specstride-reverse"),
        assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit,
      },
    }),
    doctorSkillSourceOf({
      totalBytes: totalBytesOf("doctor"),
      assertBodyFitsItsLimit: bodyBudgets.assertBodyFitsItsLimit,
    }),
  ];
  return {
    sources,
    descriptions: {
      "specstride-run": RUN_SKILL_DESCRIPTION,
      "specstride-reverse": REVERSE_SKILL_DESCRIPTION,
      doctor: DOCTOR_SKILL_DESCRIPTION,
    },
    profile: hermesProfile,
  };
}
