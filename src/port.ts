/**
 * The Hermes implementation of the host port `specstride.host/1` (T021,
 * annex H §H.1): the `HostPort` object of the contracts, bound to this
 * host's profile, descriptions, declarations and renders. `evalDriver.run`
 * is wired in T068; the field is present from this phase on, and its run
 * refuses until then rather than pretending.
 */
import {
  type HostArtifact,
  type HostDescription,
  type HostPort,
  type SkillSource,
  type TriggerCase,
  type TriggerResult,
  renderEntry as kitRenderEntry,
  renderSkill as kitRenderSkill,
} from "@specstride/host-kit";
import { hermesDescribe, HERMES_HOOK_EVENTS } from "./describe.ts";
import { hermesEntry, hermesProfile } from "./profile.ts";

/** The port this package implements, and its protocol (annex G §G.1). */
export const HOST = "hermes";
export const PORT = "specstride.host/1";
export const PROTOCOL = 1;

/**
 * The four hooks of contracts/150-host-hermes/plugin-manifest.md, in the
 * order the contract's table gives them: `pre_llm_call` twice (session
 * start, prompt), `pre_tool_call` (the launch guardrail) and
 * `on_session_end` (the host limit).
 */
export type StatusHook = {
  readonly event: string;
  readonly trigger: string;
  readonly returns: string;
};

export const hermesStatusHooks: readonly StatusHook[] = Object.freeze([
  Object.freeze({
    event: "pre_llm_call",
    trigger: "session start: `is_first_turn` and a line file exists for the cwd",
    returns: '{"context": "Specstride: <line>"}',
  }),
  Object.freeze({
    event: "pre_llm_call",
    trigger: "later turn: the `.seq` counter differs from the last one given in this session",
    returns: '{"context": "Specstride: <line>"}',
  }),
  Object.freeze({
    event: "pre_tool_call",
    trigger: "a terminal call matching a launch rule of guard.json, or any launch while blocking",
    returns: "the block directive with the rule's reason and fix",
  }),
  Object.freeze({
    event: "on_session_end",
    trigger: "a provider usage limit with SPECSTRIDE_CHILD=1",
    returns: "None, after the inbox request is written atomically",
  }),
]);

/** The hook names the manifest registers, in contract order. */
export const MANIFEST_HOOK_NAMES: readonly string[] = Object.freeze([
  "pre_llm_call",
  "pre_llm_call",
  "pre_tool_call",
  "on_session_end",
]);

/** The four hooks of the contract, as names — the check of T021. */
export function checkRenderStatusHooksAgainstContract(): void {
  const names = hermesStatusHooks.map((hook) => hook.event);
  if (names.length !== 4 || names.join(",") !== MANIFEST_HOOK_NAMES.join(",")) {
    throw new Error(
      `renderStatusHooks must cover the four hooks of contracts/plugin-manifest.md (${MANIFEST_HOOK_NAMES.join(", ")}), got ${names.join(", ")}`,
    );
  }
  const manifest = ["pre_llm_call", "pre_tool_call", "on_session_end"];
  for (const event of manifest) {
    if (!names.includes(event)) throw new Error(`the hook ${event} of the manifest is missing`);
  }
}

/** The status-line artifacts `renderStatusHooks` renders, one per hook. */
export function renderStatusHooks(statusLineLogicalName: string): readonly HostArtifact[] {
  return hermesStatusHooks.map((hook, index) => {
    const content = [
      `# Hermes status hook ${index + 1} of 4 — ${hook.event}`,
      "",
      `- status line: ${statusLineLogicalName}`,
      `- trigger: ${hook.trigger}`,
      `- returns: ${hook.returns}`,
      "",
      "Silence (return `None`) when `HERMES_SESSION_SOURCE` is `kanban` or `cron`, or",
      "`SPECSTRIDE_CHILD=1`. Any exception returns `None`. The internal bound is 5 s.",
      "",
    ].join("\n");
    return {
      path: `hermes-plugin/specstride/hooks/${index + 1}-${hook.event}${index < 2 ? `-${index === 0 ? "session-start" : "prompt"}` : ""}.md`,
      bytes: Buffer.byteLength(content, "utf8"),
      content,
    };
  });
}

/** The port object of annex H §H.1, for Hermes. */
export const hermesPort: HostPort = {
  describe(): HostDescription {
    return hermesDescribe();
  },
  renderSkill(source: SkillSource): HostArtifact {
    return kitRenderSkill(source, hermesProfile);
  },
  renderEntry(logicalId: string): string {
    return hermesEntry(logicalId);
  },
  renderStatusHooks(statusLineLogicalName: string): readonly HostArtifact[] {
    return renderStatusHooks(statusLineLogicalName);
  },
  evalDriver: {
    async run(_suite: readonly TriggerCase[]): Promise<readonly TriggerResult[]> {
      throw new Error("the eval driver is wired in T068; the port carries the field only");
    },
  },
};

export { HERMES_HOOK_EVENTS, kitRenderEntry };
