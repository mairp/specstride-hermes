# Contract: the sync sidecar (151)

F151-FR-006, F151-FR-007, F151-FR-012, F151-FR-013, F151-FR-027, F151-FR-028, F151-FR-033,
F151-FR-039, F151-FR-040, F151-FR-041; research R5, R6, R10, R12. Amended 2026-11-11 (lessons L1,
L2, L5, L8, L10): the read path, the signature, the engine memo, the card volume.

## Entry points

```
specstride-host-hermes kanban sync [--once] [--workspace <dir>]   # standalone / tests
specstride-host-hermes watch                                      # 150's unit; loads module kanban when installed
```

Runs in the dedicated profile (`hermes -p specstride kanban …`), as a systemd **user** unit (`specstride-hermes-watch.service`) — never a Kanban worker, gateway child or hook loop.

## Loop (per workspace in `watch.json`)

1. Unless the engine memo holds for the workspace: `specstride-hermes status --json` (first cycle, and every cycle while the last view was reader-sourced) or `wait --until-change --cursor <c> --timeout 25` (while the last view was engine-sourced).
2. An engine view that validates (`isRunView`) and carries a card is the view (`source: engine`) and clears the memo. A non-zero exit, a refused probe, no JSON body, an invalid view or a view of an unsupported schema major sets the memo (60 s) and one log line; a valid view with no card sets the memo when step 3 gives cards.
3. Otherwise call the workspace reader in-process ([workspace-reader.md](workspace-reader.md)). A reader view with a card is the view (`source: workspace-reader`). With no card from either: a valid engine view is projected as it is (its root card, if it names a run); otherwise nothing is written for that workspace; `no-run`, `refused-schema` or `absent` (the answer of [workspace-reader.md](workspace-reader.md) §1 step 4) is recorded in the store for the doctor.
3a. Compare the view's change signature with the stored one. Equal → no read-back, no write, sleep (engine view: the next `wait`; reader view: 5 s).
4. Project the view to the wanted card set ([card-projection.md](card-projection.md), [lane-map.md](lane-map.md)): for a reader view, only features that have a run.
5. Read back every known card: `hermes kanban show <id> --json`.
6. Diff wanted vs stored vs actual; emit the minimal verb list; execute in order; store the new state, the view source and the signature atomically; clear the stale mark.
7. Cards in the store whose key is no longer wanted → archive (or stale comment when `humanEdited`). This covers a relaunch: when another run speaks for a feature, the old run's cards leave and the new run's arrive in one cycle.

Foreign writes are still found within 60 s: the read-back of step 5 runs at least every 60 s even when the signature is unchanged.

## Foreign writes

| Actual differs from stored in | Action |
|---|---|
| column | restore the mapped column (within this cycle, ≤ 60 s) |
| title or body | set `humanEdited`; one comment `stale — edited outside Specstride; column kept in sync`; stop editing text |
| assignee or tenant | restore both (guard A) |

No board write is ever forwarded to the engine.

## Failure handling

- Shim exit 127 / 4 → the engine is unavailable: the memo is set, the reader is tried; with no reader view the cycle backs off 5 s, 10 s, … ≤ 5 min and no card is touched.
- A reader input that is torn, oversized or unreadable is skipped; the view is still built (F151-FR-034).
- `hermes` non-zero → log one line, set `stale: true` in the store, retry next cycle; never partial-store. A cycle that completes clears the mark (F151-FR-039); the doctor's `projector-alive` reads it.
- Crash/restart → resume from the store; creates are idempotent by key.

## Never

`delete`, `claim`, `heartbeat`, `complete` on an attention card, `link`, `decompose`, `specify`, `swarm`, an engine verb, a card for a feature that was never run, a spawn from the reader.
