/**
 * The capability declarations of the Hermes host (T018, F150-FR-015), built
 * with the kit's `describe` helpers: the host supplies the value, the
 * requirement and the host fact of each of the six capabilities of annex
 * H §H.1, and the kit reads the `Values` column and the declared fallback
 * from the contracts. An unknown capability is IGNORED, never an error.
 */
import {
  capabilityDeclaration,
  type CapabilityDeclaration,
  type CapabilityRendering,
  describeCapabilities,
  describeOf,
} from "@specstride/host-kit";
import { factById, hermesRange } from "./host-facts.ts";
import { DESCRIPTION_CAP } from "./profile.ts";

function pinOf(factId: string): string {
  return factById(factId)?.pin ?? "";
}

function declaration(input: {
  readonly capability: CapabilityDeclaration["capability"];
  readonly present: boolean;
  readonly value: string | readonly string[] | null;
  readonly absentBecause: string | null;
  readonly requirement: string;
  readonly hostFact: string;
}): CapabilityDeclaration {
  // The kit reads the `Values` column and the declared fallback from the
  // contracts; a host never spells them.
  return capabilityDeclaration({
    capability: input.capability,
    present: input.present,
    value: input.value,
    absentBecause: input.absentBecause,
    requirement: input.requirement,
    hostFact: input.hostFact,
    pin: pinOf(input.hostFact),
  });
}

/**
 * The four hook events the plugin manifest registers
 * (contracts/150-host-hermes/plugin-manifest.md): `pre_llm_call` twice (the
 * session start and the prompt), `pre_tool_call` (the launch guardrail) and
 * `on_session_end` (the host limit).
 */
export const HERMES_HOOK_EVENTS: readonly string[] = Object.freeze([
  "pre_llm_call",
  "pre_llm_call",
  "pre_tool_call",
  "on_session_end",
]);

/** The six declarations of annex H §H.1 for Hermes. */
export const hermesDeclarations: readonly CapabilityDeclaration[] = Object.freeze([
  declaration({
    capability: "hooks",
    present: true,
    value: HERMES_HOOK_EVENTS,
    absentBecause: null,
    requirement: "F150-FR-015 (plugin-manifest.md: the four hook rows)",
    hostFact: "HF-PRE-LLM",
  }),
  declaration({
    capability: "statusSurface",
    present: true,
    value: "the precomputed status line file the watcher writes, relayed by the plugin hooks",
    absentBecause: null,
    requirement: "F150-FR-015 (contracts/host-facts.md, HF-SKILL-LOAD)",
    hostFact: "HF-SKILL-LOAD",
  }),
  declaration({
    capability: "background",
    present: false,
    value: null,
    absentBecause:
      "Hermes launches are foreground terminal calls; the run survives through engine detach, not a host background primitive",
    requirement: "F150-FR-015 (runtime note launch-foreground)",
    hostFact: "HF-GW-SURVIVAL",
  }),
  declaration({
    capability: "evals",
    present: false,
    value: null,
    absentBecause:
      "the eval driver of this host is wired in a later task (T068); the declared fallback applies until then",
    requirement: "F150-FR-015",
    hostFact: "HF-PLUGINS-LIST",
  }),
  declaration({
    capability: "model",
    present: false,
    value: null,
    absentBecause: "Hermes names no model harness of this package's own choosing",
    requirement: "F150-FR-015",
    hostFact: "HF-BACKEND",
  }),
  declaration({
    capability: "stateRootWritable",
    present: true,
    value: true,
    absentBecause: null,
    requirement: "F150-FR-015 (runtime note state-home)",
    hostFact: "HF-ROOTS",
  }),
]);

/** How the host's artifacts are named and packaged (contracts/host-package rendering data). */
export const hermesRendering: CapabilityRendering = Object.freeze({
  skillNamingRule:
    "the logical id is spelled as a Hermes skill name: specstride-run, specstride-reverse, specstride-doctor, specstride-status, specstride-curate",
  descriptionCap: DESCRIPTION_CAP,
  packagingForm: "skill directories in a Hermes skill root plus the `specstride` plugin",
});

/**
 * `describe` of the port for Hermes: the six capabilities, with the declared
 * fallback of the annex in use for each absent one.
 */
export function hermesDescribe() {
  return describeOf(hermesDeclarations, hermesRendering);
}

/**
 * The declarations for the capabilities a caller asks about, with every
 * unknown name IGNORED (F100-FR-193) and the ignored names reported.
 */
export function hermesDescribeCapabilities(names: readonly string[]) {
  return describeCapabilities(hermesDeclarations, names);
}

export { hermesRange };
