# Contract: host-facts table (seed) (150)

F150-FR-020; constitution H4. Pin for every row: **hermes-agent 0.22.2 @ d923a5eb48, Python 3.14.7**.
Mirrored by `src/host-facts.ts`; `host.hermes-version` reads `HF-VERSION` only.

| Id | Fact | Source | Verified-on | Status | Settling check |
|---|---|---|---|---|---|
| HF-VERSION | Supported range `>=0.22.2 <0.23.0` | `/root/.hermes/hermes-agent` release commit d923a5eb48 | 2026-11-08 | verified | — |
| HF-SKILL-FM | Loader reads `name`, `description`, `metadata`; manager rule `name` `^[a-z0-9][a-z0-9._-]*$` ≤ 64, `description` ≤ 1,024 | `agent/skill_utils.py:709-827`; `tools/skill_manager_tool.py:108-169` | 2026-11-08 | verified (read) | U-150-01: install + `hermes skills list` + linter |
| HF-NO-INVOKE-FIELD | No frontmatter field hides a skill from the model catalog | grep of the tree | 2026-11-08 | verified | — |
| HF-BUNDLED | Plugin-bundled skills are `plugin:skill`, read-only, absent from `<available_skills>` | `research/C-hermes-surface.md:108` (docs `.../index.md:963-1004`) | 2026-11-08 | readme-only | load test in a temporary home |
| HF-ROOTS | Profiles at `<home>/profiles/<id>/`; `skills/` and `plugins/` under the active home | `hermes_cli/profiles.py:282-290, 432-444`; `plugins_cmd.py:255-259` | 2026-11-08 | verified | — |
| HF-ENABLE | `hermes plugins enable <name>` edits the allow-list | `hermes_cli/plugins_cmd.py:696` | 2026-11-08 | verified | — |
| HF-VALIDATE | `hermes plugins validate <path>` is the model-free catalog CI gate, exits 0/1 | `hermes_cli/plugins_cmd_catalog.py:784-820` | 2026-11-08 | verified (read) | U-150-12: first CI run |
| HF-CMD | Slash command handler replies, cannot start a turn | `hermes_cli/plugins.py:647-672` | 2026-11-08 | verified | — |
| HF-PRE-LLM | `pre_llm_call` `context` goes into the user message for the model | `agent/turn_context.py:800-835` | 2026-11-08 | verified | — |
| HF-HOOK-TIMEOUT | Python hook callbacks abandoned after 30 s (max 600) | `hermes_cli/plugins_dispatch.py:153-157` | 2026-11-08 | verified | — |
| HF-SOURCE-ENV | Kanban workers run with `HERMES_SESSION_SOURCE=kanban` | `hermes_cli/kanban_db_dispatch.py:2889` | 2026-11-08 | verified | — |
| HF-GW-UNIT | Gateway is system unit `hermes-gateway.service`, `KillMode=mixed`, stop timeout 70 s | `systemctl show hermes-gateway` | 2026-11-08 | verified (host) | — |
| HF-GW-SURVIVAL | A run launched via `systemd-run --scope` from a gateway session survives `systemctl restart hermes-gateway` | inference (S00 S4-2) | — | unverified | U-150-06: live probe |
| HF-SEND | `hermes send --to telegram[:chat[:thread]] [--subject] [--file -]` needs no agent loop; exit 0/1/2 | `website/docs/reference/cli-commands.md:480-502` | 2026-11-08 | readme-only | watcher fixture against real `hermes send --help` |
| HF-HEADLESS | Headless defaults deny dangerous commands (`single_query_mode`, `cron_mode`, `unattended_mode`); `-z` forces yolo | `website/docs/user-guide/security.md:24-64`; `hermes_cli/oneshot.py:270-273` | 2026-11-08 | verified (read) | — |
| HF-SKILL-LOAD | Skill load in a session is the tool `skill_view` | `tools/skills_tool.py:673, 725` | 2026-11-08 | verified | U-150-09: typed `/name` load recorded |
| HF-STREAM-JSON | `chat --query-file - --format stream-json` emits `system/init`, `tool_use`, `tool_result`, `result{exit_code,error}` | `hermes_cli/stream_json.py:1-70` | 2026-11-08 | verified (read) | — |
| HF-BACKEND | Which terminal backends share the host filesystem | — | — | unverified | U-150-11: fixture per backend |
| HF-CONFIG-GET | `hermes -p <p> config get <key>` prints a value and writes nothing | — | — | unverified | T066: `config.yaml` mtime unchanged across the call |
| HF-PLUGINS-LIST | `hermes -p <p> plugins list --json` lists each plugin's name and enabled state | — | — | unverified | T066 |
| HF-PLUGINS-DISABLE | `hermes plugins disable <name>` is the inverse of `enable` | `hermes_cli/plugins_cmd.py` (next to `:696`) | — | unverified | read + T066 |
| HF-SKILLS-LIST | `hermes skills list` lists the installed skills of the active home | — | — | unverified | T066 (the U-150-01 check) |
| HF-PROFILE-CREATE | `hermes profile create <name>` makes `<home>/profiles/<name>/` | `hermes_cli/profiles.py` | — | unverified | read + quickstart step 0 |
| HF-VERSION-FMT | `hermes --version` prints a line containing `0.22.2`, parsed by `/(\d+\.\d+\.\d+)/` | — | — | unverified | T066 |

## Rows added by 151, 2026-11-11

Appended for feature 151 (`research/E-dsh-kanban-lessons.md` §2). Same pin as every row above: hermes-agent 0.22.2 @ d923a5eb48. The 24 rows above are unchanged; mirroring these six into `src/host-facts.ts` is a task of 151.

| Id | Fact | Source | Verified-on | Status | Settling check |
|---|---|---|---|---|---|
| HF-DASH-TOKENS | (added by 151, 2026-11-11) The dashboard exposes the theme tokens `--color-foreground`, `-card`, `-card-foreground`, `-primary`, `-primary-foreground`, `-secondary`, `-secondary-foreground`, `-muted`, `-muted-foreground`, `-accent`, `-accent-foreground`, `-destructive`, `-destructive-foreground`, `-success`, `-warning`, `-border`, `-input`, `-ring`, `-popover`, `-popover-foreground` | `web/src/index.css:154-181` | 2026-11-11 | verified (read) | — |
| HF-DASH-THEME-SWITCH | (added by 151, 2026-11-11) A theme switch sets the variables on the document root, so a plugin subtree follows without a reload | `web/src/themes/context.tsx:349-386`; `website/docs/user-guide/features/extending-the-dashboard.md:788-795` | 2026-11-11 | verified (read) | U-151-13: person-run switch with the tab open |
| HF-DASH-SDK | (added by 151, 2026-11-11) `window.__HERMES_PLUGIN_SDK__` gives `sdkVersion`, `React`, `hooks`, `api`, `fetchJSON`, `authedFetch`, `buildWsUrl`, `buildWsAuthParam`, `components`, `utils`, `useI18n` | `web/src/plugins/registry.ts:118-191` | 2026-11-11 | verified (read) | 151's live tab lane loads the bundle |
| HF-DASH-API-404 | (added by 151, 2026-11-11) An `/api/…` path no route matches, an unmounted `/api/plugins/<name>/…` route, and the routes of a `plugin_api.py` that failed to import answer 404 JSON, never the SPA page; authentication answers 401 first | `hermes_cli/web_server_dashboard.py:227-233, 943-960, 1045-1047`; `hermes_cli/web_server.py:674-683` | 2026-11-11 | verified (read) | U-151-12: 151's live tab lane requests a route of a disabled plugin |
| HF-DASH-CSS | (added by 151, 2026-11-11) A dashboard manifest's `css` field names a stylesheet injected as a `<link>` on plugin load | `website/docs/user-guide/features/extending-the-dashboard.md:776-788`; `hermes_cli/web_server_dashboard.py:550` | 2026-11-11 | readme-only | 151's live tab lane |
| HF-SESSION-USAGE | (added by 151, 2026-11-11) Hermes keeps per-session usage (`input_tokens`, `output_tokens`, `estimated_cost_usd`) in its state database; whether a session can be joined to a run and read without opening that database | `hermes_state_schema.py:85-90` | — | unverified | U-151-10 |

### Kanban rows added by 151, 2026-11-11

The facts about the Hermes Kanban that feature 151 relies on (its research R1 to R4), which no row carried until now. Sources are the code reads of 2026-11-08 recorded in `research/S00-specify-grounding.md` slice 2 and `research/P00-plan-grounding.md` slices 1–2; the line anchors marked † were re-opened on 2026-11-11. Mirrored into `src/host-facts.ts` by a task of 151.

| Id | Fact | Source | Verified-on | Status | Settling check |
|---|---|---|---|---|---|
| HF-KANBAN-CLI | (added by 151, 2026-11-11) `hermes kanban create` takes `--tenant`, `--assignee` and `--idempotency-key`; a repeated create with the same key is a no-op | `hermes_cli/kanban_parser.py:84, 167, 181` †; `research/C-hermes-surface.md:158` | 2026-11-08 | verified (read) | 151 live dispatcher lane |
| HF-KANBAN-NONSPAWN | (added by 151, 2026-11-11) A card whose assignee is not a Hermes profile is bucketed `skipped_nonspawnable` in every lane, and `kanban.default_assignee` does not apply to it | `hermes_cli/kanban_db_dispatch.py:2042-2061` †, `:2400-2410` | 2026-11-08 | verified (read) | U-151-02: 151 live dispatcher lane (also that `create --assignee` accepts a non-profile name) |
| HF-KANBAN-BLOCK | (added by 151, 2026-11-11) Every block is sticky (`recompute_ready` does not promote it); a second block of the same kind routes the card to `triage` (`BLOCK_RECURRENCE_LIMIT = 2`) | `hermes_cli/kanban_db.py:114` †, `:2005-2020, 3239-3264` | 2026-11-08 | verified (read) | — |
| HF-KANBAN-PROMOTE | (added by 151, 2026-11-11) `recompute_ready` promotes a `todo` card whose parents are done, including a card with no parents | `hermes_cli/kanban_db.py:2063-2110` † | 2026-11-08 | verified (read) | — |
| HF-KANBAN-RUNNING | (added by 151, 2026-11-11) A `running` card without a claim is reconciled to `ready` | `hermes_cli/kanban_db_dispatch.py:846-862` | 2026-11-08 | verified (read) | — |
| HF-KANBAN-TRIAGE | (added by 151, 2026-11-11) `kanban.auto_decompose` is on by default: a card in `triage` is handed to a model on a dispatch tick | `hermes_cli/config_defaults.py:1941` † | 2026-11-08 | verified (read) | U-151-07: tick test with `auto_decompose` on |
| HF-KANBAN-SCHEDULED | (added by 151, 2026-11-11) `scheduled` is entered from `todo`, `ready`, `running` and `blocked` and is not dispatchable | `hermes_cli/kanban_db.py:3889-3915` † | 2026-11-08 | verified (read) | — |
| HF-KANBAN-HOOK | (added by 151, 2026-11-11) `on_kanban_task_updated` carries field names only; lifecycle moves fire other hooks | `research/P00-plan-grounding.md` P2-6 | 2026-11-08 | verified (read) | — |
| HF-KANBAN-NOTIFY | (added by 151, 2026-11-11) `kanban notify-subscribe` delivers through the card owner's profile adapter; whether it delivers for a non-profile assignee | `research/C-hermes-surface.md:163` | — | unverified | U-151-05: model-free probe with a stub Telegram adapter |

