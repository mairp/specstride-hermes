/**
 * The host-facts table (T010, F150-FR-020; data-model.md §HostFact;
 * contracts/150-host-hermes/host-facts.md). One row per Hermes fact this
 * package relies on, with its source, its verification date (`null` where
 * the fact is unverified on the pinned build), the Hermes version pin, its
 * status in the closed set `verified | readme-only | unverified`, and, for
 * an `unverified` row, the check that would settle it (Principle X and
 * XVII: an unverified fact is reported, never assumed).
 *
 * Seeded from contracts/150-host-hermes/host-facts.md (the seed read of
 * 2026-11-08 against hermes-agent 0.22.2 @ d923a5eb48, Python 3.14.7).
 * The live probe of F150-FR-049 writes its results back into the rows it
 * settles and bumps their `verifiedOn`.
 */

/** The Hermes release every row is pinned to (constitution H4). */
export const HERMES_VERSION_PIN = "hermes-agent@0.22.2+d923a5eb48";

/** The closed set of row statuses (data-model.md §HostFact). */
export type HostFactStatus = "verified" | "readme-only" | "unverified";

export type HostFactRow = {
  /** The row id, `HF-…`. */
  readonly id: string;
  /** The fact, in one sentence. */
  readonly fact: string;
  /** Where the fact was read from (`path:line` or a command). */
  readonly source: string;
  /** The verification date, or `null` exactly when `status` is `unverified`. */
  readonly verifiedOn: string | null;
  /** The Hermes version the fact is pinned to. */
  readonly pin: string;
  /** The closed-set status of the row. */
  readonly status: HostFactStatus;
  /** For an `unverified` row: the check that would settle it; else `null`. */
  readonly settlingCheck: string | null;
  /** The FR ids that rely on the row (at least one). */
  readonly usedBy: readonly string[];
};

const PIN = HERMES_VERSION_PIN;

/**
 * The rows, in the order of contracts/150-host-hermes/host-facts.md —
 * `HF-VERSION` through `HF-VERSION-FMT`, 24 rows.
 */
export const hostFacts: readonly HostFactRow[] = Object.freeze([
  {
    id: "HF-VERSION",
    fact: "Supported range >=0.22.2 <0.23.0",
    source: "/root/.hermes/hermes-agent release commit d923a5eb48",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-016", "F150-FR-018", "F150-FR-020"],
  },
  {
    id: "HF-SKILL-FM",
    fact:
      "Loader reads `name`, `description`, `metadata`; manager rule `name` ^[a-z0-9][a-z0-9._-]*$ at most 64, `description` at most 1,024",
    source: "agent/skill_utils.py:709-827; tools/skill_manager_tool.py:108-169",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-150-01: install + `hermes skills list` + linter",
    usedBy: ["F150-FR-003"],
  },
  {
    id: "HF-NO-INVOKE-FIELD",
    fact: "No frontmatter field hides a skill from the model catalog",
    source: "grep of the tree",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-002"],
  },
  {
    id: "HF-BUNDLED",
    fact: "Plugin-bundled skills are `plugin:skill`, read-only, absent from `<available_skills>`",
    source: "research/C-hermes-surface.md:108 (docs .../index.md:963-1004)",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "readme-only",
    settlingCheck: "load test in a temporary home",
    usedBy: ["F150-FR-002"],
  },
  {
    id: "HF-ROOTS",
    fact: "Profiles at `<home>/profiles/<id>/`; `skills/` and `plugins/` under the active home",
    source: "hermes_cli/profiles.py:282-290, 432-444; plugins_cmd.py:255-259",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-021"],
  },
  {
    id: "HF-ENABLE",
    fact: "`hermes plugins enable <name>` edits the allow-list",
    source: "hermes_cli/plugins_cmd.py:696",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-022"],
  },
  {
    id: "HF-VALIDATE",
    fact: "`hermes plugins validate <path>` is the model-free catalog CI gate, exits 0/1",
    source: "hermes_cli/plugins_cmd_catalog.py:784-820",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-150-12: first CI run",
    usedBy: ["F150-FR-043"],
  },
  {
    id: "HF-CMD",
    fact: "Slash command handler replies, cannot start a turn",
    source: "hermes_cli/plugins.py:647-672",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-030"],
  },
  {
    id: "HF-PRE-LLM",
    fact: "`pre_llm_call` `context` goes into the user message for the model",
    source: "agent/turn_context.py:800-835",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-038", "F150-FR-039"],
  },
  {
    id: "HF-HOOK-TIMEOUT",
    fact: "Python hook callbacks abandoned after 30 s (max 600)",
    source: "hermes_cli/plugins_dispatch.py:153-157",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-042"],
  },
  {
    id: "HF-SOURCE-ENV",
    fact: "Kanban workers run with `HERMES_SESSION_SOURCE=kanban`",
    source: "hermes_cli/kanban_db_dispatch.py:2889",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-041", "F150-FR-042"],
  },
  {
    id: "HF-GW-UNIT",
    fact: "Gateway is system unit `hermes-gateway.service`, `KillMode=mixed`, stop timeout 70 s",
    source: "systemctl show hermes-gateway",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-013"],
  },
  {
    id: "HF-GW-SURVIVAL",
    fact: "A run launched via `systemd-run --scope` from a gateway session survives `systemctl restart hermes-gateway`",
    source: "inference (S00 S4-2)",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "U-150-06: live probe",
    usedBy: ["F150-FR-013", "F150-SC-006"],
  },
  {
    id: "HF-SEND",
    fact: "`hermes send --to telegram[:chat[:thread]] [--subject] [--file -]` needs no agent loop; exit 0/1/2",
    source: "website/docs/reference/cli-commands.md:480-502",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "readme-only",
    settlingCheck: "watcher fixture against real `hermes send --help`",
    usedBy: ["F150-FR-034"],
  },
  {
    id: "HF-HEADLESS",
    fact: "Headless defaults deny dangerous commands (`single_query_mode`, `cron_mode`, `unattended_mode`); `-z` forces yolo",
    source: "website/docs/user-guide/security.md:24-64; hermes_cli/oneshot.py:270-273",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-018"],
  },
  {
    id: "HF-SKILL-LOAD",
    fact: "Skill load in a session is the tool `skill_view`",
    source: "tools/skills_tool.py:673, 725",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-150-09: typed `/name` load recorded",
    usedBy: ["F150-FR-046"],
  },
  {
    id: "HF-STREAM-JSON",
    fact: "`chat --query-file - --format stream-json` emits `system/init`, `tool_use`, `tool_result`, `result{exit_code,error}`",
    source: "hermes_cli/stream_json.py:1-70",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F150-FR-046"],
  },
  {
    id: "HF-BACKEND",
    fact: "Which terminal backends share the host filesystem",
    source: "—",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "U-150-11: fixture per backend",
    usedBy: ["F150-FR-019"],
  },
  {
    id: "HF-CONFIG-GET",
    fact: "`hermes -p <p> config get <key>` prints a value and writes nothing",
    source: "—",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "T066: `config.yaml` mtime unchanged across the call",
    usedBy: ["F150-FR-018"],
  },
  {
    id: "HF-PLUGINS-LIST",
    fact: "`hermes -p <p> plugins list --json` lists each plugin's name and enabled state",
    source: "—",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "T066",
    usedBy: ["F150-FR-016"],
  },
  {
    id: "HF-PLUGINS-DISABLE",
    fact: "`hermes plugins disable <name>` is the inverse of `enable`",
    source: "hermes_cli/plugins_cmd.py (next to :696)",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "read + T066",
    usedBy: ["F150-FR-024"],
  },
  {
    id: "HF-SKILLS-LIST",
    fact: "`hermes skills list` lists the installed skills of the active home",
    source: "—",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "T066 (the U-150-01 check)",
    usedBy: ["F150-FR-002", "F150-FR-016"],
  },
  {
    id: "HF-PROFILE-CREATE",
    fact: "`hermes profile create <name>` makes `<home>/profiles/<name>/`",
    source: "hermes_cli/profiles.py",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "read + quickstart step 0",
    usedBy: ["F150-FR-021"],
  },
  {
    id: "HF-VERSION-FMT",
    fact: "`hermes --version` prints a line containing `0.22.2`, parsed by /(\\d+\\.\\d+\\.\\d+)/",
    source: "—",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "T066",
    usedBy: ["F150-FR-016"],
  },
]);

/**
 * The version range `host.hermes-version` reports (F150-FR-016, F150-FR-020),
 * read from the row `HF-VERSION` only — never a literal here.
 */
export function hermesRange(): string {
  const row = hostFacts.find((r) => r.id === "HF-VERSION");
  if (row === undefined) throw new Error("host-facts: HF-VERSION is missing");
  const match = row.fact.match(/>=\S+\s+<\S+/);
  if (match === null) throw new Error("host-facts: HF-VERSION carries no range");
  return match[0];
}

/** The host-facts row with an id, or `undefined`. */
export function factById(id: string): HostFactRow | undefined {
  return hostFacts.find((row) => row.id === id);
}

/** The `unverified` rows, in table order — the ones a settling check awaits. */
export function unverifiedHostFacts(): readonly HostFactRow[] {
  return hostFacts.filter((row) => row.status === "unverified");
}
