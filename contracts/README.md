# Runtime contracts (tracked)

Tracked mirrors of the contracts the build reads. The specs that own them (`specs/`) stay local
under the 2026-11-08 hygiene ruling; `specs/<feature>/contracts/` is the source, this folder is
the copy that enters git.

| Folder | Feature |
|---|---|
| `150-host-hermes/` | shim, installer CLI, doctor output, plugin manifest, slash command, notice line, host facts |
| `151-hermes-kanban/` | card projection, lane map, sync sidecar, plugin API, tab manifest |
