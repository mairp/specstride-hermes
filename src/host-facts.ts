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
 * `HF-VERSION` through `HF-VERSION-FMT` (24 rows), then the 15 rows added by
 * 151 (HF-DASH-* / HF-SESSION-USAGE / HF-KANBAN-*).
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
  // The 15 rows appended by 151 (contracts/150-host-hermes/host-facts.md,
  // "Rows added by 151, 2026-11-11" and "Kanban rows added by 151").
  {
    id: "HF-DASH-TOKENS",
    fact:
      "(added by 151, 2026-11-11) The dashboard exposes the theme tokens `--color-foreground`, `-card`, `-card-foreground`, `-primary`, `-primary-foreground`, `-secondary`, `-secondary-foreground`, `-muted`, `-muted-foreground`, `-accent`, `-accent-foreground`, `-destructive`, `-destructive-foreground`, `-success`, `-warning`, `-border`, `-input`, `-ring`, `-popover`, `-popover-foreground`",
    source: "web/src/index.css:154-181",
    verifiedOn: "2026-11-11",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-001"],
  },
  {
    id: "HF-DASH-THEME-SWITCH",
    fact:
      "(added by 151, 2026-11-11) A theme switch sets the variables on the document root, so a plugin subtree follows without a reload",
    source: "web/src/themes/context.tsx:349-386; website/docs/user-guide/features/extending-the-dashboard.md:788-795",
    verifiedOn: "2026-11-11",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-151-13: person-run switch with the tab open",
    usedBy: ["F151-FR-001"],
  },
  {
    id: "HF-DASH-SDK",
    fact:
      "(added by 151, 2026-11-11) `window.__HERMES_PLUGIN_SDK__` gives `sdkVersion`, `React`, `hooks`, `api`, `fetchJSON`, `authedFetch`, `buildWsUrl`, `buildWsAuthParam`, `components`, `utils`, `useI18n`",
    source: "web/src/plugins/registry.ts:118-191",
    verifiedOn: "2026-11-11",
    pin: PIN,
    status: "verified",
    settlingCheck: "151's live tab lane loads the bundle",
    usedBy: ["F151-FR-001"],
  },
  {
    id: "HF-DASH-API-404",
    fact:
      "(added by 151, 2026-11-11) An `/api/…` path no route matches, an unmounted `/api/plugins/<name>/…` route, and the routes of a `plugin_api.py` that failed to import answer 404 JSON, never the SPA page; authentication answers 401 first",
    source:
      "hermes_cli/web_server_dashboard.py:227-233, 943-960, 1045-1047; hermes_cli/web_server.py:674-683",
    verifiedOn: "2026-11-11",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-151-12: 151's live tab lane requests a route of a disabled plugin",
    usedBy: ["F151-FR-002"],
  },
  {
    id: "HF-DASH-CSS",
    fact:
      "(added by 151, 2026-11-11) A dashboard manifest's `css` field names a stylesheet injected as a `<link>` on plugin load",
    source:
      "website/docs/user-guide/features/extending-the-dashboard.md:776-788; hermes_cli/web_server_dashboard.py:550",
    verifiedOn: "2026-11-11",
    pin: PIN,
    status: "readme-only",
    settlingCheck: "151's live tab lane",
    usedBy: ["F151-FR-001"],
  },
  {
    id: "HF-SESSION-USAGE",
    fact:
      "(added by 151, 2026-11-11) Hermes keeps per-session usage (`input_tokens`, `output_tokens`, `estimated_cost_usd`) in its state database; whether a session can be joined to a run and read without opening that database",
    source: "hermes_state_schema.py:85-90",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "U-151-10",
    usedBy: ["F151-FR-003"],
  },
  {
    id: "HF-KANBAN-CLI",
    fact:
      "(added by 151, 2026-11-11) `hermes kanban create` takes `--tenant`, `--assignee` and `--idempotency-key`; a repeated create with the same key is a no-op",
    source: "hermes_cli/kanban_parser.py:84, 167, 181 †; research/C-hermes-surface.md:158",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: "151 live dispatcher lane",
    usedBy: ["F151-FR-010"],
  },
  {
    id: "HF-KANBAN-NONSPAWN",
    fact:
      "(added by 151, 2026-11-11) A card whose assignee is not a Hermes profile is bucketed `skipped_nonspawnable` in every lane, and `kanban.default_assignee` does not apply to it",
    source: "hermes_cli/kanban_db_dispatch.py:2042-2061 †, :2400-2410",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck:
      "U-151-02: 151 live dispatcher lane (also that `create --assignee` accepts a non-profile name)",
    usedBy: ["F151-FR-010"],
  },
  {
    id: "HF-KANBAN-BLOCK",
    fact:
      "(added by 151, 2026-11-11) Every block is sticky (`recompute_ready` does not promote it); a second block of the same kind routes the card to `triage` (`BLOCK_RECURRENCE_LIMIT = 2`)",
    source: "hermes_cli/kanban_db.py:114 †, :2005-2020, 3239-3264",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-011"],
  },
  {
    id: "HF-KANBAN-PROMOTE",
    fact:
      "(added by 151, 2026-11-11) `recompute_ready` promotes a `todo` card whose parents are done, including a card with no parents",
    source: "hermes_cli/kanban_db.py:2063-2110 †",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-011"],
  },
  {
    id: "HF-KANBAN-RUNNING",
    fact:
      "(added by 151, 2026-11-11) A `running` card without a claim is reconciled to `ready`",
    source: "hermes_cli/kanban_db_dispatch.py:846-862",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-011"],
  },
  {
    id: "HF-KANBAN-TRIAGE",
    fact:
      "(added by 151, 2026-11-11) `kanban.auto_decompose` is on by default: a card in `triage` is handed to a model on a dispatch tick",
    source: "hermes_cli/config_defaults.py:1941 †",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: "U-151-07: tick test with `auto_decompose` on",
    usedBy: ["F151-FR-012"],
  },
  {
    id: "HF-KANBAN-SCHEDULED",
    fact:
      "(added by 151, 2026-11-11) `scheduled` is entered from `todo`, `ready`, `running` and `blocked` and is not dispatchable",
    source: "hermes_cli/kanban_db.py:3889-3915 †",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-012"],
  },
  {
    id: "HF-KANBAN-HOOK",
    fact:
      "(added by 151, 2026-11-11) `on_kanban_task_updated` carries field names only; lifecycle moves fire other hooks",
    source: "research/P00-plan-grounding.md P2-6",
    verifiedOn: "2026-11-08",
    pin: PIN,
    status: "verified",
    settlingCheck: null,
    usedBy: ["F151-FR-013"],
  },
  {
    id: "HF-KANBAN-NOTIFY",
    fact:
      "(added by 151, 2026-11-11) `kanban notify-subscribe` delivers through the card owner's profile adapter; whether it delivers for a non-profile assignee",
    source: "research/C-hermes-surface.md:163",
    verifiedOn: null,
    pin: PIN,
    status: "unverified",
    settlingCheck: "U-151-05: model-free probe with a stub Telegram adapter",
    usedBy: ["F151-FR-014"],
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
