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
| 6 | `host.permission-mode` | profile in force; `approvals.mode` (HF-CONFIG-GET); headless deny defaults; `HERMES_YOLO_MODE`; gateway cgroup + `systemd-run` presence (and `--user` reachable when uid ≠ 0) | dedicated profile, no yolo `ok`; default profile `warn`; yolo `warn`; headless deny would block launch `warn`; gateway without `systemd-run` `warn` | no | `hermes -p specstride …` / the setting to change |
| 7 | `host.plugin-enabled` | `hermes -p <p> plugins list --json` (HF-PLUGINS-LIST) | enabled `ok`; installed not enabled `warn`; absent `info` | no | `hermes -p <p> plugins enable specstride` |
| 8 | `host.kanban-plugin` | Hermes kanban enabled; 151 projector module and tab present (when 151 installed) | informational: `ok` / `info` | no | 151's install line |

## Exit codes

Kit `DOCTOR_EXITS`: 0 no `fail`; 1 a `fail` or a throwing check; 3 unknown id in a filter.

## `host.kanban-plugin` facts (added by 151, 2026-11-11)

Appended for feature 151 (F151-FR-030, F151-FR-053; `specs/151-hermes-kanban/data-model.md` "DoctorFacts"). Row 8 of the table above is unchanged: the check stays informational (`ok` / `info`), is not launch-blocking, and its id is not new. When 151 is installed its one line carries these facts after the dash, and `--json` carries them as members of the finding. A fact that could not be observed reads `unknown`; the severity is then `info`, never `ok`. Each fact is implemented by a task of 151.

| Fact (added by 151, 2026-11-11) | Values | Probe | Why (dsh lesson) |
|---|---|---|---|
| `kanban-enabled` | `yes` / `no` / `unknown` | `hermes -p <p> plugins list --json` | the fact row 8 already reported |
| `projector-alive` | `yes` / `no` / `unknown` | the watcher unit's state; the projector store's `lastGoodAt` | F151-FR-030 |
| `tab-enabled` | `yes` / `no` / `unknown` | the dashboard files present; the plugin enabled | F151-FR-030 |
| `map-version` | `v1` / `v2` / `unknown` | configuration; `dispatcher-test.json` | F151-FR-030 |
| `shim-on-unit-path` | `yes` / `no` / `unknown` | `specstride-hermes` is an executable in a directory of the watcher unit's `PATH` (the unit's environment, not the caller's shell) | L14: the doctor said `ok` while the shim was not on the PATH of the process that runs it |
| `engine-answers-protocol` | `yes` / `no` / `unknown` | the engine that environment resolves, `--protocol` through the shim | L14: an engine on PATH that answers no `--protocol` |
| `engine-path` | a `~`-rooted path / `unknown` | shim resolution steps 1–2 in the unit's environment | L19: which engine the unit resolves must be visible |
| `engine-matches-pin` | `yes` / `no` / `unknown` | the resolved engine's version against `package.json` `specstride.engineVersion`; its commit against `core-pin.json` only where that file is readable beside the package (the installed package does not ship it) | L19 |
| `host-cli-runs-installed` | `yes` / `no` / `unknown` | `specstride-host-hermes` resolves its modules from the installed package | L14: the host CLI not runnable from the installed package |
| `engine-view-has-cards` | `yes` / `no` / `unknown` | the projector's last cycle | L1: an engine that answers is not an engine that describes the run |
| `view-source` | `engine` / `workspace-reader` / `none` / `unknown` | the projector store | L1, L20: the day the engine starts to answer is visible |
