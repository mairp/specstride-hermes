# Contract: card projection (151)

F151-FR-001 to F151-FR-008, F151-FR-014 to F151-FR-017; research R1, R4. All writes through
`hermes -p specstride kanban …`; never `kanban.db`.

## Common fields

| Field | Value |
|---|---|
| `--tenant` | `specstride` |
| `--assignee` | `specstride-projection` (not a profile — guard A) |
| `--idempotency-key` | the card key |
| `--workspace` | `scratch` |
| `--body-file -` | the body below, on stdin |
| `--json` | always, to read the Hermes id |

## Root card

- Key `specstride:<run-id>`; title `[<state>] <feature> · <run-id>` (`<state>` verbatim; unknown → `[?<raw>]`).
- Body lines: `engine-state: <state>` · `display: <display>` · `phase: <phase>/<phases> pass <pass> rejects <rejects>` · `conditions: dead=<b> stale=<b> launch-abandoned=<b>` · `status: /specstride status` · `projected-by: specstride-host-hermes <version>`.

## Stage card

- Key `specstride:<run-id>:<card-id>`; title `[<lane>] <feature> phase <n> · <card-id>`.
- Body: `engine-lane: <lane>` · `flags: dead=<b> stale=<b> yielded=<b>` · `run: specstride:<run-id>`.

## Attention card

- Key `specstride:<run-id>:attn:<item-id>`; title `[attention] <kind> · <run-id>`.
- Sequence: `create` → `promote <id>` → `block <id> --kind needs_input <engine one-line text, verbatim>`. Never unblocked. Cleared item → `archive <id>`.

## Write sequence per transition

| From → to | Verbs |
|---|---|
| new → `scheduled` | `create`, `schedule <id>` |
| `scheduled` → `scheduled` (value changed) | `edit <id> --title --body` (skipped when `humanEdited`) |
| `scheduled` → `done` | `complete <id> --result "<value> (engine)"` |
| `scheduled` → `ready` (map v2 only) | `unblock <id>` |
| any → `archived` | `archive <id>` (or one stale comment when `humanEdited`) |

No `claim`, `heartbeat`, `request-review`, `link`, `delete`, `decompose`, `specify`, `swarm`.
