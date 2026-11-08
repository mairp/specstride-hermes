# Contract: lane-to-column map (151)

F151-FR-003, F151-FR-005, F151-FR-009 to F151-FR-011; research R2, R3. Source of truth:
`src/kanban/map.ts`; mirrored here. Total over `LANES` and `RUN_STATES` of `@specstride/contracts`
0.1.0 — a missing member fails the build.

## Stage cards (engine lanes)

| Lane | v1 (default) | v2 (opt-in, gated) |
|---|---|---|
| `queued` | `scheduled` | `scheduled` |
| `proposing` | `scheduled` | `ready` |
| `verifying` | `scheduled` | `ready` |
| `reviewing` | `scheduled` | `scheduled` |
| `approved` | `done` | `done` |
| `blocked` | `scheduled` | `scheduled` |
| `paused` | `scheduled` | `scheduled` |
| `failed` | `scheduled` | `scheduled` |
| unknown | `scheduled`, label `?` | same |

## Root cards (run states)

`created, starting, running, paused-quota, relaunching, stopping, blocked-on-human, stopped, failed` → `scheduled`; `finished` → `done`; unknown → `scheduled`, label `?`.

## Forbidden targets

| Column | Why (pinned Hermes 0.22.2) |
|---|---|
| `triage` | auto-decomposed by a model each tick (`config_defaults.py:1941`) |
| `todo` | promoted to `ready` when parents are done, including no parents (`kanban_db.py:2063-2110`) |
| `running` | without a claim, reconciled to `ready` (`kanban_db_dispatch.py:846-862`) |
| `review` | dispatched to review workers by default; reachable only by a worker's `request-review` |
| `blocked` for root/stage | a second block of the same kind routes to `triage` (`kanban_db.py:114, 3239-3264`) |

## Guards

- **A** assignee `specstride-projection` → nonspawnable in every lane (`kanban_db_dispatch.py:2042-2061`).
- **B** the column above. v1 cards are safe by B alone; v2's `ready` relies on A.
- v2 is enabled only when `specstride.kanban.map: v2` **and** `$HERMES_HOME/specstride-host/kanban/dispatcher-test.json` records a pass of `dispatcher.live.test.ts` for the installed Hermes version.

## Tests

`map.test.ts`: totality over the pinned enums, determinism, unknown → `?`, no forbidden target. `dispatcher.live.test.ts`: 100 ticks, 0 claims/spawns/decompositions/promotions out of the mapped column.
