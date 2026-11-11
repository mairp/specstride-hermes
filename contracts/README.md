# Runtime contracts (tracked)

Tracked mirrors of the contracts the build reads. The specs that own them (`specs/`) stay local
under the 2026-11-08 hygiene ruling; `specs/<feature>/contracts/` is the source, this folder is
the copy that enters git.

| Folder | Feature |
|---|---|
| `150-host-hermes/` | shim, installer CLI, doctor output (with the `host.kanban-plugin` facts added by 151 on 2026-11-11), plugin manifest, slash command, notice line, host facts (with the Kanban and dashboard rows added by 151 on 2026-11-11) |
| `151-hermes-kanban/` | card projection, lane map, sync sidecar, plugin API, tab manifest, workspace reader, card detail, presentation, closed sets (`closed-sets.json`, read by the build) |
