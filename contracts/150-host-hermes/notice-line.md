# Contract: Telegram notice line (150)

F150-FR-034 to F150-FR-037; research R10.

## Producer

`specstride-host-hermes watch` (systemd user unit `specstride-hermes-watch.service`, dedicated profile). Per workspace in `watch.json`: `specstride-hermes wait --until-change --cursor <c> --timeout 25` in that workspace.

## Line

```
[specstride] <run-id> <change> — <next>
```

| Part | Source | Rule |
|---|---|---|
| `<run-id>` | `run=` key of the status line | verbatim |
| `<change>` | `st=` value on a state change; `attn=<kind>: <attention one-line>` for a new attention item | verbatim; one item per notice |
| `<next>` | `next=` key, else `/specstride status` | verbatim |

Whole line ≤ 240 bytes (cut at a UTF-8 boundary with `…`). No model text, no repository text.

## Delivery

`hermes -p specstride send --to <specstride.notify.telegram> --subject "[specstride] <run-id>" --file -` with the line on stdin. Unset target → no delivery, one log line, the status line is still precomputed.

## Dedupe

Key `<run-id>:<cursor>` stored in `$HERMES_HOME/specstride-host/notify/seen.json` (atomic, last 1,000 keys). A key already present → skip. Restarting the watcher sends nothing for a cursor already seen.

## Failure

Non-zero `hermes send` → one log line, key recorded, continue. The watcher never retries in a way that delays its next `wait`. No run depends on the watcher (H5).

## Triggers

State change (`st=` differs) · new attention item of kind `blocked-on-human`, `quota-pause`, `dead-run`, `launch-abandoned`, `budget-alert`, or a run entering `failed`. Other kinds are precomputed into the status line only.
