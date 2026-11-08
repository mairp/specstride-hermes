# Contract: control CLI `specstride-host-hermes` — install and uninstall (150)

F150-FR-021 to F150-FR-024, F150-FR-031; research R3, R4, R5. Record schema: [data-model.md](../data-model.md) InstallRecord (dsh's, renamed).

## Commands

```
specstride-host-hermes install   [--profile <p> | --user | --project] [--with-kanban] # default: --profile specstride
specstride-host-hermes uninstall [--profile <p> | --user | --project]
specstride-host-hermes doctor    [--json]                               # contracts/doctor-output.md
specstride-host-hermes watch     [--once] [--print-unit]                # research R10
specstride-host-hermes eval      <suite> [--lane paid|local]            # person-started only
```

`--with-kanban` (151) adds `dashboard/` to the plugin and the `kanban` watcher module; it refuses with `--project` and across package versions. Two scope flags together refuse; an unknown scope refuses (exit 3).

## Roots per scope

| Scope | Plain skills | Bundled skills + plugin | Enable plugin |
|---|---|---|---|
| `profile <p>` | `~/.hermes/profiles/<p>/skills/specstride/` | `~/.hermes/profiles/<p>/plugins/specstride/` | runs `hermes -p <p> plugins enable specstride` |
| `user` | `~/.hermes/skills/specstride/` | `~/.hermes/plugins/specstride/` | **prints** `hermes plugins enable specstride` |
| `project` | `<git-root>/.hermes/skills/specstride/` | — (no project plugins) | prints `hermes skills trust <git-root>` |

`HERMES_HOME` overrides `~/.hermes` (tests always set it to a temporary directory).

## Skill set

`specstride-run`, `specstride-status`, `specstride-curate` plain **and** bundled; `specstride-doctor` bundled only; `specstride-reverse` plain and bundled only when the resolved CLI accepts `reverse` (probe: `reverse --help` exits 0, not 3). Skipped reverse prints `skip specstride-reverse — the CLI has no reverse verb`.

## Install outcomes

| Root state | Action | Output |
|---|---|---|
| absent | write files, then record (atomic) | one line per item |
| installed, all hashes match | nothing | `already installed, unchanged` |
| installed, a hash differs | refuse, write nothing | `refuse <path> — changed since install` |
| present, no record | refuse, write nothing | `refuse <dir> — no install record describes it` |

The installer never installs or updates the CLI or Hermes, never edits `config.yaml`, never writes the repository except the `project` skill root.

## Uninstall

Remove recorded files whose hash matches; keep and name changed ones; remove empty item directories; remove the record last. For `profile` scope run `hermes -p <p> plugins disable specstride`; otherwise print it.

## Exit codes

0 done or unchanged · 1 refused · 3 usage error · 127 `hermes` missing when the scope needs it to enable.
