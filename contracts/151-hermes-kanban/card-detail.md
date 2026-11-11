# Contract: the card detail and the inspector (151)

F151-FR-043 to F151-FR-045; research R13. Added 2026-11-11 (lessons L6, L7). Ported from
specstride-dsh `packages/dsh-kanban/src/server/run-detail.ts` and `src/shared/detail-tree.ts` at
`ab8093e`. Code: `src/kanban/reader/{detail,redact}.ts` (server side), `src/tab/client/detail-tree.ts`
(element tree). Values: [closed-sets.json](closed-sets.json).

The detail is optional and additive: `cards[].detail` (PhaseDetail) and `featureDetails[<feature>]`
(FeatureDetail). An engine view has neither today; a card without a detail is not a button. A
detail that cannot be built leaves its card without one and never fails the view.

## Opening and closing (F151-FR-043)

- A card with a detail carries `role="button"`, `tabindex="0"`, `aria-pressed`, `data-has-detail`.
- Click, Enter or Space opens the inspector; a second activation, the Close control
  (`data-kanban-detail-close`) or Escape closes it and returns the focus to the card.
- Open state is client state (`selectedCardId`). Opening or closing sends no request, changes no
  lane, and the inspector assigns no lane.
- The inspector is an `aside` beside the lanes (`data-kanban-detail="<card id>"`, `data-lane`,
  `role="region"`), with a header (lane pill, feature, Close) and an `h3` `Phase <n> — <title>`.

## Sections, in order

| # | Section (`data-detail-section`) | Rows | Source |
|---|---|---|---|
| 1 | `scope` — Scope | Goal; Independent test; Checkpoint; `Tasks <done>/<total> done`; the task list (tick, id, `[P]`, `[USn]`, text, the newest critic verdict `MET` / `UNMET`); Files | `specs/<f>/tasks.md`; the verdict lines of the newest feedback file |
| 2 | `live` — Live | Run: id, launch or `started by hand`, state, phase; Last event; the agents (role, what it does, model, harness and profile, pid, since) each with a liveness badge; the note on what leaves no live record | control root events, `procs.json`, `/proc` |
| 3 | `attempts` — Attempts | per attempt: outcome badge, number, run, launch or `by hand`, strategy, passes, errors, start → end; Counters (rejects, pass errors, no-progress, cap hits); Micro units; Approved (time, attempt, critic model, commit ≤ 12 hex); Evidence (name, size) | events of every run of the feature; `ledger.json`, `micro/`, `approvals/`, `bound/`; evidence name and size |
| 4 | `launches` — Launches | per launch, newest first: state badge, id, reason, state, exit or signal, the run it started or `no engine run`, `current`, start → end. Omitted when the feature has no launch | `.specstride/launches/`, the pipeline record |
| 5 | `cost` — Cost and limits | This phase (usage); Whole feature (usage); Cost; Limits; the usage note | dsh session records when the proposer harness is dsh; else fixed texts |

Every state shown has glyph, label and grayscale together (sets `task`, `alive`, `outcome`,
`launch` of [presentation.md](presentation.md)); an unknown member shows `?` with its raw value.

## Fields

| Record | Field | Type and cap |
|---|---|---|
| PhaseDetail | `goal`, `independentTest`, `checkpoint` | string ≤ 240 bytes, or null |
| | `tasksDone`, `tasksTotal` | integers |
| | `tasks[]` | ≤ 60 of `{id, text ≤ 160, done, parallel, story, verdict: MET \| UNMET \| null}`; `tasksOmitted` |
| | `files[]` | ≤ 12 workspace-relative names ≤ 160; `filesOmitted` |
| | `approval` | `{at ≤ 40, attempt ≤ 40, critic ≤ 80, commit ≤ 12}` or null |
| | `evidence` | `{name (workspace-relative), bytes}` or null |
| | `attempts[]` | ≤ 12 (newest kept) of `{attempt, run ≤ 12, launch, strategy, startedAt, endedAt, outcome ≤ 40, passes, errors}`; `attemptsOmitted` |
| | `counters`, `units` | integers, or null |
| | `usage` | DetailUsage or null |
| | `current` | boolean |
| FeatureDetail | `run` | `{id ≤ 40, launch, state ≤ 40, phase, startedAt, lastAt}` or null |
| | `agents[]` | ≤ 8 of `{role ≤ 40, what ≤ 240, since, pid, alive: true \| false \| null, harness ≤ 40, profile ≤ 60, model ≤ 80}` |
| | `agentsNote` | string or null |
| | `launches[]` | ≤ 12 (newest kept) of `{launch, reason, state, at, endedAt, exit ≤ 60, run ≤ 12, current}`; `launchesOmitted` |
| | `usage`, `cost`, `limits`, `usageNote` | DetailUsage or null; strings ≤ 240 |
| DetailUsage | `sessions`, `calls`, `tokensIn`, `tokensOut`, `retries`, `rateLimited`, `backoffMs`, `models[] ≤ 6 × 80` | integers and names |

Run state values: `running` (an alive entry), `between passes` (not ended, no alive entry, launch
running), else the recorded outcome, as recorded.

## Caps and redaction (F151-FR-044)

1. **Strings.** `capText`: control characters `U+0000–0008, 000A–001F, 007F–009F` → a space;
   whitespace runs collapsed; cut to the cap in UTF-8 bytes with `...`, never splitting a character
   (`run-detail.ts:40-46`). Default cap 240.
2. **Lists.** Bounded as above, each with its omitted count; the tree shows `and <n> more <what>`.
3. **Paths.** `safePath`: under the workspace → relative; under the home → `~/…`; any other
   absolute path → its base name (`run-detail.ts:49-55`).
4. **Command lines.** `/proc/<pid>/cmdline` is read only by `describeProcess`, which returns the
   harness base name, `--profile`, `--model` and a role matched by pattern; the argv is discarded
   (`run-detail.ts:289-313`).
5. **Never in a view** (closed set): an absolute path, a prompt, a reply, a tool argument, a command
   line, a signature, a key, a log line. dsh's launch-log tail (`run-detail.ts:456-464`) is **not**
   carried.
6. **Text only.** Every string enters the tree as a text node; there is no markup path.

The redaction test builds the view from a workspace salted with each forbidden item (an absolute
path in a launch record and a task, a prompt body and a key in a fake `cmdline`, control characters
and a 2 000-byte title in `tasks.md`, 500 tasks, 40 launches) and asserts over the **whole view the
API returns**: 0 strings above their cap, 0 control characters, 0 strings starting with `/` that
are a path, 0 salted markers, every list within its bound with the right omitted count.

## What the inputs cannot say (F151-FR-045)

| Fact | Shown as | When |
|---|---|---|
| An agent's liveness | `not observable` (`alive: null`) | the events say it is at work and no registry entry names it |
| Critic and verifier calls | the note `critic and verifier calls leave no live record in this engine; they show as the lane only` | a run that is not ended |
| Cost | `not reported` | always (no input carries a cost) |
| Usage | `not reported` | the proposer harness is not dsh, or no session of the feature is found |
| Quota | `quota: not reported` | a reader view (no budget rows) |
| A run state | the recorded text | always; never corrected (feature 150 here reads `crash` with every phase approved) |

Whether Hermes's own session records (`sessions.input_tokens`, `output_tokens`,
`estimated_cost_usd`) can be named for a run is U-151-10; they are not read.

## Tests

`tests/kanban/reader/detail.test.ts` (fields, bounds, omitted counts, usage only for dsh),
`tests/kanban/reader/redaction.test.ts` (the salted workspace), `tests/tab/detail-tree.test.ts`
(five sections in order, badges, the fixed texts, open and close, focus return, no fetch, no lane
change).
