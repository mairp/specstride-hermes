/**
 * The render profile of the Hermes host (T011, research R2): the tables the
 * host-kit renderer (`render`, `skills`) reads for this host. There is no
 * default in the kit — a host that forgot a table cannot compile into a
 * second host by accident — so every figure of R2 stands here exactly once.
 *
 * An unknown logical id fails the build (F150-FR-001): the kit's
 * `renderEntry` throws `UnknownLogicalIdError` for any id the `spellings`
 * table does not name.
 */
import {
  type SkillRenderProfile,
  assertBudgetTables,
  renderEntry,
} from "@specstride/host-kit";

/** The rate the budgets are measured at, in bytes per token (R2). */
export const BYTES_PER_TOKEN = 2.8;

/** The cap on the lines of the body of a rendered skill (R2). */
export const MAX_BODY_LINES = 500;

/** The cap on a rendered description, in characters (R2). */
export const DESCRIPTION_CAP = 1024;

/**
 * The Hermes spelling of each logical id: the two host skills and the doctor
 * skill of row 144, plus the two host skills of this package (R3).
 */
export const HERMES_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  "specstride-run": "specstride-run",
  "specstride-reverse": "specstride-reverse",
  doctor: "specstride-doctor",
  status: "specstride-status",
  curate: "specstride-curate",
});

/**
 * The token budgets of the host's design point (R2), keyed by the thing each
 * budget belongs to.
 */
export const HERMES_TOKEN_BUDGETS: Readonly<Record<string, number>> = Object.freeze({
  run: 8000,
  reverse: 7000,
  doctor: 1500,
  status: 1500,
  curate: 8000,
  cycle: 150,
  unchanged: 0,
  supervision: 3000,
  // The same figures keyed by the logical ids the kit's budget lookups take
  // (`byteBudgetOf` of `render`), so a lookup by either spelling resolves.
  "specstride-run": 8000,
  "specstride-reverse": 7000,
});

/** The requirement the budget message names, in this host's own words. */
export const BUDGET_REQUIREMENT =
  "F150-FR-045 — the context-cost budgets of the Hermes host (research R2), measured at 2.8 bytes/token with a body cap of 500 lines";

/** The render profile of the Hermes host, as the kit takes it. */
export const hermesProfile: SkillRenderProfile = Object.freeze({
  bytesPerToken: BYTES_PER_TOKEN,
  maxBodyLines: MAX_BODY_LINES,
  descriptionCap: DESCRIPTION_CAP,
  skillFile: "SKILL.md",
  skillsDirectory: "skills/specstride",
  spellings: HERMES_SPELLINGS,
  tokenBudgets: HERMES_TOKEN_BUDGETS,
  printedByteBudgets: Object.fromEntries(
    Object.entries(HERMES_TOKEN_BUDGETS).map(([key, tokens]) => [key, tokens * BYTES_PER_TOKEN]),
  ),
  budgetRequirement: BUDGET_REQUIREMENT,
});

// The printed byte numbers and the arithmetic cannot drift: the kit holds
// them against each other at load, and a drift fails the build here.
assertBudgetTables(hermesProfile);

/** The Hermes spelling of a logical id. An unknown id fails the build. */
export function hermesEntry(logicalId: string): string {
  return renderEntry(logicalId, hermesProfile);
}
