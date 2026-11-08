# Contract: the `specstride` Hermes plugin (150)

F150-FR-025, F150-FR-038 to F150-FR-042; research R8, R9, R13; constitution H3, H5.

## `hermes-plugin/specstride/plugin.yaml`

```yaml
manifest_version: 2
name: specstride
version: <package version>
description: Specstride host for Hermes (thin glue over the specstride-hermes shim).
author: mairp
license: Apache-2.0
kind: general
python_runtime: external        # nothing installed into Hermes's venv
capabilities: []
provides_tools: [specstride_status, specstride_doctor]
provides_hooks: [pre_llm_call, pre_tool_call, on_session_end]
requires_hermes: ">=0.22.2,<0.23.0"
config_schema:
  specstride.notify.telegram: {type: string, description: "telegram[:chat_id[:thread]] target for notices"}
  specstride.kanban.actions: {type: boolean, default: false}   # 151
```

No `pip_dependencies`, no `python_dependencies` (CI fails otherwise).

## `register(ctx)`

| Registration | Name | Behaviour |
|---|---|---|
| `register_command` | `specstride` | [slash-command.md](slash-command.md) |
| `register_cli_command` | `specstride` | same verbs for `hermes specstride …` (in-process only) |
| tool, toolset `specstride` (default-off) | `specstride_status` | forwards `status` via the shim; read-only |
| tool, toolset `specstride` | `specstride_doctor` | forwards `specstride-host-hermes doctor`; read-only |
| `register_skill` | `specstride-run`, `-status`, `-curate`, `-doctor`, `-reverse` (gated) | bundled `specstride:*` copies from the build |
| hooks | below | — |

Every command handler calls `_forward.run(argv)` = `subprocess.run(argv, shell=False, timeout=…, capture_output=True)` with `bin/` taken from `_paths.json` next to `__init__.py` (written by the installer; missing → reply `Specstride not installed — run specstride-host-hermes install`). Hooks spawn nothing. Python performs only file reads, equality checks and lookups in Node-written tables; it imports no `re` (a gate checks).

## Hooks: event → behaviour

Precomputed line: `$HERMES_HOME/specstride-host/status/<sha256(workspace)[:16]>.line` with its counter `….seq`, written by the watcher. Guard table: `$HERMES_HOME/specstride-host/guard.json`, written by Node (`src/guard.ts`). Silence (return `None`) when `HERMES_SESSION_SOURCE ∈ {kanban, cron}` or `SPECSTRIDE_CHILD=1`. Any exception → `None`. Internal bound 5 s (Hermes abandons at 30 s).

| Hook | Trigger | Returns | Subprocess |
|---|---|---|---|
| `pre_llm_call` (session start) | `is_first_turn` and a line file exists for `cwd` | `{"context": "Specstride: <line>"}` | none |
| `pre_llm_call` (prompt) | later turn and the `.seq` counter differs from the last one given in this `session_id` | `{"context": "Specstride: <line>"}` | none |
| `pre_tool_call` (launch guardrail) | terminal call whose command matches a rule of `guard.json` (literal `contains`/`absent` substrings: launch not via `specstride-hermes`, launch in the background), or any launch while `guard.json.blocking` is true | block directive with the rule's `reason` and `fix` | none |
| `on_session_end` (host limit) | `turn_exit_reason` is a provider usage limit and `SPECSTRIDE_CHILD=1` | `None`, after writing `inbox/<session-id>.json` atomically | none (the watcher forwards the request) |

The model sees the context line (P00 P4-1); the skills tell it to relay the line verbatim.

## Validation

`hermes plugins validate hermes-plugin/specstride` in the gate (H8, v3.1.1); pytest against `tests/glue-fixtures/`.
