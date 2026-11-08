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
