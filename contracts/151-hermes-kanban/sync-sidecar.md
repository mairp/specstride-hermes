# Contract: the sync sidecar (151)

F151-FR-006, F151-FR-007, F151-FR-012, F151-FR-013, F151-FR-027, F151-FR-028; research R5, R6.

## Entry points

```
specstride-host-hermes kanban sync [--once] [--workspace <dir>]   # standalone / tests
specstride-host-hermes watch                                      # 150's unit; loads module kanban when installed
```

Runs in the dedicated profile (`hermes -p specstride kanban …`), as a systemd **user** unit (`specstride-hermes-watch.service`) — never a Kanban worker, gateway child or hook loop.

## Loop (per workspace in `watch.json`)

1. `specstride-hermes status --json` (first cycle) or `wait --until-change --cursor <c> --timeout 25`.
2. Exit 70 / no JSON body → write nothing for that workspace; record `absent` for the tab (U-8).
3. Validate with `isRunView`; invalid → write nothing, one log line.
4. Project the view to the wanted card set ([card-projection.md](card-projection.md), [lane-map.md](lane-map.md)).
5. Read back every known card: `hermes kanban show <id> --json`.
6. Diff wanted vs stored vs actual; emit the minimal verb list; execute in order; store the new state atomically.
7. Cards in the store whose key is no longer wanted → archive (or stale comment when `humanEdited`).

## Foreign writes

| Actual differs from stored in | Action |
|---|---|
| column | restore the mapped column (within this cycle, ≤ 60 s) |
| title or body | set `humanEdited`; one comment `stale — edited outside Specstride; column kept in sync`; stop editing text |
| assignee or tenant | restore both (guard A) |

No board write is ever forwarded to the engine.

## Failure handling

- Shim exit 127 / 4 → backoff 5 s, 10 s, … ≤ 5 min; no card touched.
- `hermes` non-zero → log one line, retry next cycle; never partial-store.
- Crash/restart → resume from the store; creates are idempotent by key.

## Never

`delete`, `claim`, `heartbeat`, `complete` on an attention card, `link`, `decompose`, `specify`, `swarm`, an engine verb.
