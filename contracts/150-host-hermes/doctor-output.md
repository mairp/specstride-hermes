# Contract: doctor output (150)

F150-FR-015 to F150-FR-019. Run by `specstride-host-hermes doctor`, `/specstride doctor`, the
tool `specstride_doctor` and the bundled `specstride:specstride-doctor` skill, after
`specstride doctor`. U-3 fallback: no external doctor registry in core 0.1.0, so the checks run
in this package's runner in the kit's `DoctorCheck` shape.

## Line grammar

```
<severity> <check> — <fix or message>
```

`severity ∈ {ok, info, warn, fail}` (unknown → `warn`). One line per check, in the order below. `--json` prints the EP-14 shape. No model call; total ≤ 2 s; fixes are printed, never run.

## Checks

| # | id | Probe | Severity rule | Launch-blocking | Fix line |
|---|---|---|---|---|---|
| 1 | `host.cli-found` | shim resolution steps 1–2 | absent → `fail` | **yes** (only this) | the engine's install command |
| 2 | `host.protocol-supported` | `--protocol` via the shim | in range `ok`; out `fail`; unprobeable `warn` | no | kit fix text |
| 3 | `host.hermes-version` | `hermes --version` | inside `HF-VERSION` range (`>=0.22.2 <0.23.0`) `ok`; outside `warn`; absent `warn` | no | `pin hermes-agent 0.22.2 or re-verify the host facts` |
| 4 | `host.skills-installed` | records + frontmatter `metadata.specstride.version` in every scope root | all present, current, unshadowed `ok`; stale/shadowed `warn`; missing `fail`; reverse skipped `info` | no | the install command for the scope |
| 5 | `host.state-root-writable` | create+remove a probe file under `$XDG_STATE_HOME/specstride/`; `terminal.backend` | local and writable `ok`; non-local backend `warn`; not writable `warn` | no | names the setting; never "move state into the repo" |
| 6 | `host.permission-mode` | profile in force; `approvals.mode`; headless deny defaults; `HERMES_YOLO_MODE`; gateway cgroup + `systemd-run` presence | dedicated profile, no yolo `ok`; default profile `warn`; yolo `warn`; headless deny would block launch `warn`; gateway without `systemd-run` `warn` | no | `hermes -p specstride …` / the setting to change |
| 7 | `host.plugin-enabled` | `hermes -p <p> plugins list --json` | enabled `ok`; installed not enabled `warn`; absent `info` | no | `hermes -p <p> plugins enable specstride` |
| 8 | `host.kanban-plugin` | Hermes kanban enabled; 151 projector module and tab present (when 151 installed) | informational: `ok` / `info` | no | 151's install line |

## Exit codes

Kit `DOCTOR_EXITS`: 0 no `fail`; 1 a `fail` or a throwing check; 3 unknown id in a filter.
