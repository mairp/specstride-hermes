# Contract: card projection (151)

F151-FR-001 to F151-FR-008, F151-FR-014 to F151-FR-017, F151-FR-035, F151-FR-041; research R1, R4,
R10, R14. All writes through `hermes -p specstride kanban …`; never `kanban.db`. Amended 2026-11-11
(lessons L1, L2, L3, L4, L8, L10): the view source, the card volume rule, the reader's run id.

## Which cards exist

| View source | Root card | Stage cards | Attention cards |
|---|---|---|---|
| `engine` | one, for the view's run | one per entry of `cards[]` | one per entry of `attention[]` |
| `workspace-reader` | one per feature that has a run, for the run that speaks (`featureDetails[<f>].run.id`) | one per phase card of a feature that has a run | one per entry of `attention[]` (at most one per feature) |

A feature that was never run (the reader's single `<feature>#queued` card, rule `W0`) gets **no**
card on the native board (F151-FR-041, OD-151-9). When another run comes to speak for a feature,
the cards keyed by the old run id are archived and the new run's cards are created in the same
cycle; cards of two runs of one feature are never both live.

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
- Reader view: `<state>` is `featureDetails[<f>].run.state` as recorded (`running`, `between passes`, or the recorded outcome); a value outside the ten run states is written `[?<raw>]` and stays in `scheduled` (OD-151-10). Body lines: `run-state: <state>` · `launch: <launch id | started by hand>` · `phase: <n>` · `last-event: <ISO time>` · `agents: <n alive>` · `source: workspace-reader` · `status: /specstride status` · `projected-by: specstride-host-hermes <version>`. The live facts in these lines are part of the change signature, so the body is edited when one changes and only then (F151-FR-040).

## Stage card

- Key `specstride:<run-id>:<card-id>`; title `[<lane>] <feature> phase <n> · <card-id>`.
- Body: `engine-lane: <lane>` · `flags: dead=<b> stale=<b> yielded=<b>` · `run: specstride:<run-id>`.
- Reader view: the first line is `lane: <lane>`, and two lines are added: `rule: <W1..W4> (<ruleId>)` · `source: workspace-reader`. A phase a live run is re-working shows its live lane with `rule: W1`, whatever approval is on record (L4). The title carries the phase title after the card id, cut to 240 bytes.

## Attention card

- Key `specstride:<run-id>:attn:<item-id>`; title `[attention] <kind> · <run-id>`.
- Sequence: `create` → `promote <id>` → `block <id> --kind needs_input <the view's one-line text, verbatim>`. Never unblocked. Cleared item → `archive <id>`.
- Reader view: the item is the reader's one line for an ended run (`<feature>: run ended <lane> in phase <n> (<title>) — <why>`, key `<feature>#run`); the body adds `source: workspace-reader`. It clears when a newer run speaks for the feature or the card leaves `failed` and `blocked`.

## Write sequence per transition

| From → to | Verbs |
|---|---|
| new → `scheduled` | `create`, `schedule <id>` |
| `scheduled` → `scheduled` (value or a signature member of the body changed) | `edit <id> --title --body` (skipped when `humanEdited`) |
| unchanged signature | no verb at all |
| `scheduled` → `done` | `complete <id> --result "<value> (engine)"` |
| `scheduled` → `ready` (map v2 only) | `unblock <id>` |
| any → `archived` | `archive <id>` (or one stale comment when `humanEdited`) |

No `claim`, `heartbeat`, `request-review`, `link`, `delete`, `decompose`, `specify`, `swarm`.
