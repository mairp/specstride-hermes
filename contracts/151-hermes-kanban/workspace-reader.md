# Contract: the workspace reader (151)

F151-FR-033 to F151-FR-042; research R10, R11, R12; constitution v3.2.0 H2, H6. Added 2026-11-11
(lessons L1, L2, L3, L4, L5, L8, L10, L20). Ported from specstride-dsh `packages/dsh-kanban/src/server/`
`workspace-view.ts` and `run-detail.ts` at `ab8093e`; each rule cites its origin there. Code:
`src/kanban/reader/` (TypeScript). Values: [closed-sets.json](closed-sets.json).

The reader builds a `specstride.view/1` from files a Specstride workspace already holds. It is
read-only, spawns no process, writes nothing, and is not a channel to the CLI.

## 1. When it is called (F151-FR-033)

| Step | Condition | Result |
|---|---|---|
| 1 | The engine memo does not hold for the workspace (§8) | the engine is asked through the shim: `status --json`, or `wait --until-change` on an engine cursor |
| 2 | The engine view validates and carries ≥ 1 card | that view, `source: engine`; the reader is **not** called |
| 3 | The engine's answer is unavailable (probe refused, non-zero exit, body not JSON, invalid view), or is a valid view with 0 cards | the reader is called; a reader view with ≥ 1 card is the view, `source: workspace-reader` |
| 4 | The reader finds no card | the engine's own answer stands: a valid engine view is used as it is (`no-run` when its state is `none`; a run with no card yet keeps its root card); an unavailable answer gives `absent` |

Ground (probe of 2026-11-11, `research/E-dsh-kanban-lessons.md` §2.1, §2.6): engine `27e7d71b`
exits 0 with `state: "none"`, 0 cards, `runId: null` in three workspaces where the reader finds 10,
268 and 185 cards. dsh calls its reader only on `unavailable` (`route.ts:67-99`); step 3's second
half is added here.

## 2. Lane rules, in order (F151-FR-038)

Per phase of a feature; first match wins. `lanes.ts` is the only file that assigns a lane.

| Rule | Condition | Lane | `ruleId` |
|---|---|---|---|
| W0 | Nothing has started the feature: no run, no approval or gate, no ticked task | one card `<feature>#queued`, lane `queued`, title `not started (<n> phases)` | `W-queued` |
| W1 | The run that speaks is **not ended** and its current phase is this phase | the run's live lane: the lane of its newest activity event, `proposing` when it has none | `W-<lane>` |
| W2 | The run ended `all_approved`; or an approval record (`approvals/phase-<n>.json`) or a gate (`GATE<n>-APPROVED`) exists; or the run recorded `phase.ended` approved for it; or the phase has tasks and all are ticked | `approved` | `W-approved` |
| W3 | The run is ended and its current phase is this phase | the end lane of §5 | `W-<lane>` |
| W4 | Otherwise | `queued` | `W-queued` |

W1 is before W2 on purpose (dsh issue #23, commit `ab8093e`, `workspace-view.ts:242-252`): an
approval the engine voided (`integrity.noted`, `approval-invalid`) and re-opened must not pin the
card to `approved` while the proposer works. The reader does not parse `integrity.noted`; the order
covers every reason an approval stopped holding.

Activity → live lane: `phase.started`, `attempt.started`, `pass.started`, `iter_start`,
`run.resumed`, `unblocked`, `yield.ended` → `proposing`; `verification.started`, `check.started`,
`job.started` → `verifying`; `critic.started`, `critic.call`, `verdict.recorded` → `reviewing`;
`run.paused`, `yield.started` → `paused`; `blocked` → `blocked` (`workspace-view.ts:318-379`; the
bash stream: `:186-225`). An event type the table does not know changes nothing.

Flags: `stale` on a W1 card whose run had no event for 2 h; `yielded` when the lane is `paused`;
`dead` always `false`. View state: `none` with no card; `running` when a card sits on `proposing`,
`verifying` or `reviewing` and is not stale; else `idle` (`workspace-view.ts:856-857`).

## 3. The run that speaks (F151-FR-036)

1. The runs of a feature are the run directories of the control root whose every `phase.started`
   title is a phase title of the feature's `tasks.md`. When none qualifies, the run named by the
   feature's `loop.json` is taken (`workspace-view.ts:424-449`). This is the only use of `loop.json`.
2. Each run's alive entries: registry rows `run:<runId>:<kind>` of `procs.json` whose process is
   alive **and is the recorded one**: `/proc/<pid>/stat` exists; the state after the last `)` is
   neither `Z` nor `X`; `|btime·1000 + starttime·1000/CLK_TCK − startedAtMs| ≤ 1000`
   (`run-detail.ts:268, 276-287`). Without a recorded start, existence is the answer. A reused pid
   fails the check.
3. The run that speaks is the newest run by first event that has an alive entry; else the newest
   run by first event (`run-detail.ts:355-359`).
4. Where both engines left a run for a feature, the one with the newer last event speaks
   (`workspace-view.ts:824-825`).

## 4. The launch join (F151-FR-037)

A run belongs to the newest launch of its feature whose `createdAt ≤ firstEvent + 1000 ms`, unless
that launch's `endedAt + 1000 ms < firstEvent` (it had ended) or a later launch was created before
the run's first event (`run-detail.ts:439-453`). No such launch: the run is shown as
`started by hand`. The engine writes no id join; this is by time, and upstream row U-10 (U-151-09)
asks for the id.

Launch state (`run-detail.ts:381-431`): with an exit record, `signalled` when it names a signal,
else the pipeline's own `failed`, `completed` or `stopped` when it recorded one, else `exited`;
without an exit record, `running` when the lease owner (or the active launch's owner) is alive by
the check of §3, else `lost`.

## 5. Ended runs (F151-FR-037)

Applied in this order to a run whose own events hold no `run.ended`:

| # | Condition | Effect |
|---|---|---|
| E0 | The run's events hold a `phase.ended` for its current phase with an outcome other than approved | the end lane is set first: `blocked` → `blocked`, `stopped` → `paused`, else `failed` (the run is ended by E1 to E3 or by its own `run.ended`) |
| E1 | The feature's newest pipeline `state.json` is not `running`, not `dry-run`, and not older than the run's last event | the run is ended; outcome = that state; end lane `paused` for `stopped`, none for `completed`, else `failed`; the `exit_reason` joins the reason line |
| E2 | No alive entry, and the run's launch is not `running` | the run is ended; outcome = the launch state; end lane `paused` when the launch is `signalled`, `stopped` or stop-requested; none when it `exited` 0 or `completed`; else `failed` |
| E3 | No alive entry, no launch, `procs.json` exists in the control root, and no event for 120 s | the run is ended, outcome `lost`, end lane `failed` |
| — | No alive entry, launch `running` | not ended: the run is `between passes` |
| — | No alive entry, no launch, no `procs.json` | nothing is judged |

E0 is dsh `workspace-view.ts:304-315, 361-370`. For the bash engine's stream the end lane comes from
its `run_end.outcome`: one naming a yield, pause, stop or quota → `paused`; a human, halt or block →
`blocked`; else `failed` (`workspace-view.ts:227-232`).

**Attention.** Exactly one item per feature, and only when the run is ended **and** a card of the
feature sits on `failed` or `blocked`: kind `blocked-on-human`, key `<feature>#run`, line
`<feature>: run ended <lane> in phase <n> (<title>) — <why>` (≤ 240 bytes), need
`read the run log, fix the cause, then relaunch`, next `relaunch` (`workspace-view.ts:760-774`).
No path is written into the item.

## 6. Signature and cursor (F151-FR-040)

`signature.token = sha256(JSON.stringify([cards → [id, lane, flags.stale], attention → [key,
oneLine], churn]))`; `churn` = launches `[launchId, state]`, then per started feature the run
record, agents `[role, pid, what]`, launches `[launch, state]`, usage `[calls, retries]`, and per
phase `[tasksDone, attempts → outcome + passes, counters, units]` (`workspace-view.ts:739-743, 808,
859-861`). Cursor token: `<offset>.<lastSeq>.<first 8 hex>`. A reader view has no blocking wait: the
caller polls every 5 s and compares tokens.

## 7. Inputs — the closed list (F151-FR-034)

| # | Path | What it gives | Bound |
|---|---|---|---|
| 1 | `specs/<f>/tasks.md` | phases (`## Phase N: <title>`), ticks, scope | 2 MiB |
| 2 | `.specstride/workspace.json` | the workspace id | 256 KiB |
| 3 | `.specstride/events.jsonl` | the bash engine's stream | newest 8 MiB |
| 4 | `.specstride/features/<f>/gates/`, `…/evidence/` | gate names; evidence names and sizes, never text | names only |
| 5 | `.specstride/launches/launch-*/{launch,supervision,runtime.status}.json` | launches | 256 KiB each |
| 6 | `.specstride/active`, `.specstride/features/<f>/runs/run-launch-*/lease.json` | the launch owner's pid and start | 256 KiB each |
| 7 | `.specstride/state/pipeline/<f>/runs/<launch>/state.json` | the pipeline's end record | 256 KiB |
| 8 | Control root `~/.specstride/workspaces/<id16>/` (also `<full id>`, and both under `$XDG_STATE_HOME/specstride/workspaces/`): `runs/*/events.jsonl`, `procs.json`, `features/<f>/{approvals,bound,micro,feedback,set-aside}/`, `features/<f>/{ledger,loop}.json` | the TS engine's runs, registry, approvals, counters, units, the `T<n>: MET\|UNMET` lines of the newest feedback | events newest 8 MiB; 256 KiB per record |
| 9 | `/proc/<pid>/{stat,cmdline}` for recorded pids; `/proc/stat` | liveness; harness, profile, model, role | — |
| 10 | `~/.dsh/sessions/<cwd-slug>/`, worker roots named after the feature's runs | usage | only when the run's proposer harness is dsh |

Not in the list, and never opened: `runtime.log` and any other log; `kanban.db` and any Hermes
database; Hermes session records (U-151-10); evidence and feedback text beyond the verdict lines;
anything under `$HERMES_HOME`. The test port records every path and throws on one outside the list;
a guard fails the test on any `child_process` use from `src/kanban/reader/`.

## 8. Engine memo (F151-FR-039)

Held by the caller (`view-source.ts`), not by the reader: after an engine answer for a workspace
that is unavailable, **or is a valid view with no card while the reader gave cards**, the engine is
not asked for 60 000 ms; at most 64 workspaces; an engine view that carries a card deletes the
entry. dsh memoizes only `unavailable` (`route.ts:58-60, 70-83`); the empty answer is added because
at engine `27e7d71b` it is the standing answer, and asking every 5 s would be the spawn-per-poll
fault the memo exists to stop. Consequence: the engine starting to describe a run is seen within
60 s.

## 9. Marking and retirement (F151-FR-035, F151-FR-041, F151-FR-042)

- The view carries `source: "workspace-reader"`, `laneTable: {id: "workspace-reader", version: "1"}`;
  each card `ruleId: W-<lane>` and `rule: W0…W4`.
- The projector writes `source: workspace-reader` in every card body it projects from the view and
  records the source in its store; the tab shows the source line. A never-run feature (W0) is in
  the view and the tab, and not on the native board.
- **Switched off** per workspace by step 2 of §1 with the first engine view that carries a card (asked at most every 60 s, §8); by
  `specstride.kanban.reader: off` (then step 3 is skipped and the answer is `absent`).
- **Removed** from the product when the pinned engine's `status --json` carries, for a
  pipeline-launched run, the cards and `cards[].detail` (upstream U-10, U-151-09). Until then
  `host.kanban-plugin` reports `view-source` and `engine-view-has-cards`, so the day the engine
  starts to answer is visible.

## Tests

`tests/kanban/reader/`: `inputs` (path list, no spawn, bounds, torn input), `tasks-md`, `events`,
`pick-run` (relaunch; `loop.json` names the old run), `alive` (gone, zombie, reused pid, no recorded
start), `ended` (E1 to E3, between passes, no registry, clean exit, the one attention item),
`lane-rules` (a golden per rule in order; the voided approval), `real-150` (the fixture recorded
from this repository's feature 150: 10 cards, all `approved`, run state as recorded). `tests/kanban/`
`view-source` (the four steps, the memo with an injected clock), `signature`.
