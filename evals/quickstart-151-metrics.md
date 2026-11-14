# Quickstart 151 — recorded measurement (T082)

Recorded 2026-11-14 against this working tree, offline: no model call, no network, no
provider hostname. Every count below was observed by running the cited file with
`node --experimental-strip-types --test <file>` in this session. `tests/live/` lanes were
NOT run.

Environment note: `hermes --version` on this machine prints
`Hermes Agent v0.22.2 (2026.9.24) · stable · local d923a5eb487a` — the pinned Hermes
0.22.2 is present, so `tests/live/dispatcher.live.test.ts` would NOT skip here; the lane
was still not executed (its own header says "run it explicitly, not on every change", and
one run is ~300 dispatch ticks).

Whole per-change suite (`node scripts/run-tests.mjs`, includes
`tests/unit/quickstart-151.test.ts`): 608 tests, 606 pass, 0 fail, 2 skipped
(pre-existing skips elsewhere in the tree), ~5.5 min.

## F151-SC-001..F151-SC-010

- **F151-SC-001** (card in its mapped column within 60 s of a lane change; 0 board writes
  for an unchanged view) — carried by `tests/kanban/sync.test.ts` (9 tests, 9 pass,
  0 fail: exact verb list per transition, the signature short-cut, restart idempotency)
  and `tests/kanban/view-source.test.ts` (9 tests, 9 pass). Also observed offline by
  `tests/unit/quickstart-151.test.ts` (this task): a second `sync --once` over the
  `feature-150` fixture wrote 0 kanban verbs and left the projection store byte-equal.
  Deviation: the 60 s wall-clock claim needs the running watcher; the per-change suite
  proves the cycle logic, the quickstart step-2 recording proves the 0-write property.
- **F151-SC-002** (100 dispatcher ticks, 0 claims/spawns/promotions/decompositions) —
  carried by `tests/live/dispatcher.live.test.ts`. **Live lane, not run by this task
  (skipped without a full lane run).** Not observed; no deviation recorded because
  nothing was measured.
- **F151-SC-003** (dragged card back in its column within 60 s, 0 engine verbs) — carried
  by `tests/kanban/restore.test.ts` (6 tests, 6 pass, 0 fail: foreign write found by
  read-back, column and both guards restored, every call a `hermes … kanban …` verb, no
  engine verb in the stub log). Deviation: the literal drag is a dashboard action
  (quickstart step 4, person-run).
- **F151-SC-004** (CLI missing / engine down: dashboard and tab keep working, marker
  shown, 0 uncaught errors) — carried by `tests/tab/poller.test.ts` (7 tests, 7 pass:
  unavailable answers give one line and no partial board, nothing throws out of the
  poller, stale marker set) and `tests/tab/actions.test.ts` (7 tests, 7 pass). Deviation:
  "the dashboard keeps working with 0 uncaught errors" in a real dashboard is quickstart
  step 6, person-run.
- **F151-SC-005** (the per-change gate makes 0 model calls) — carried structurally by
  `scripts/run-tests.mjs` (spawns `node --test` over the non-live suites only; no model
  invocation anywhere in it) and by `tests/unit/suites.test.ts` (7 tests, 7 pass: no
  suite file holds a model id, tools restricted so no case can launch). Every test run
  in this task was offline. Deviation: none observed.
- **F151-SC-006** (newest alive run's cards within one sync cycle; pid-reuse fixtures,
  0 alive entries with a >1 s start difference, L2) — carried by
  `tests/kanban/reader/pick-run.test.ts` (6 tests, 6 pass: newest run by first event with
  an alive entry), `tests/kanban/reader/alive.test.ts` (10 tests, 10 pass: start-time
  match within the closed tolerance, pid reuse fails the check) and
  `tests/kanban/reader/ended.test.ts` (12 tests, 12 pass), over
  `tests/fixtures/workspaces/relaunch/` and `pid-reuse/`. Deviation: the board-visible
  half is quickstart step 5, person-run.
- **F151-SC-007** (voided-approval fixtures: re-worked phase on the run's live lane in
  100 % of cases, view state `running`, L4) — carried by
  `tests/kanban/reader/lane-rules.test.ts` (10 tests, 10 pass: "a voided approval is no
  approval; a live run's current phase beats everything") over
  `tests/fixtures/workspaces/voided-approval/`. Deviation: the 100 % claim is stated
  over the committed fixtures, which is exactly what the suite covers.
- **F151-SC-008** (at most 1 engine attempt per 60 s; stale line gone on the first good
  answer, L5) — carried by `tests/kanban/view-source.test.ts` (9 tests, 9 pass: the memo
  with an injected clock, at most one probe+call per `MEMO_MS`, the reader switch-off)
  and `tests/tab/poller.test.ts` (7 tests, 7 pass: the stale line REMOVED by the next
  good answer, F151-FR-039).
- **F151-SC-009** (redaction fixture: 0 strings above 240 bytes, 0 control characters,
  0 absolute paths, 0 salted forbidden items, lists within bounds, L6) — carried by
  `tests/kanban/reader/redaction.test.ts` (6 tests, 6 pass, 0 fail) over
  `tests/fixtures/workspaces/salted/`.
- **F151-SC-010** (42 features, 250 approved phase cards, one run feature: exactly
  1 feature on the board; threshold 100 → at most 140 card nodes and strip absent;
  threshold 250 → feature first in the strip, at most 4 rows, L10) — carried by
  `tests/tab/window.test.ts` (9 tests, 9 pass: generated 250-card/42-feature view, the
  ≤140 window, the dropped `data-summary`, the strip at threshold 250),
  `tests/kanban/sync.test.ts` (9 tests, 9 pass: "over corpus-42 the wanted set holds
  cards of exactly one feature — the one with a run", test at line 241 over
  `tests/fixtures/workspaces/corpus-42`) and `tests/tab/direction-b.test.ts` (8 tests,
  8 pass: strip chips and the windowed board).

## Quickstart steps 4 to 9 and the live probe — person-run, NOT run by this task

Steps 4–9 and the live probe of `specs/151-hermes-kanban/quickstart.md` are recorded as
person-run and were NOT executed by this task. Their per-change equivalents, verified by
reading the files:

- Step 4 (drag is undone) — `tests/kanban/restore.test.ts` (T072): the foreign write is
  restored within one cycle, 0 engine verbs.
- Step 5 (relaunch) — `tests/kanban/reader/pick-run.test.ts` and
  `tests/kanban/reader/ended.test.ts` (the newest alive run speaks for the feature),
  `tests/kanban/sync.test.ts` (archive on a run gone, restart idempotency) over
  `tests/fixtures/workspaces/relaunch/`.
- Step 6 (tab) — `tests/tab/window.test.ts`, `tests/tab/direction-b.test.ts`,
  `tests/tab/board-tree.test.ts` (2 tests, 2 pass: strip/attention/budget/approvals
  ordering), `tests/tab/handler.test.ts`, `tests/tab/poller.test.ts`.
- Step 7 (inspector) — `tests/kanban/reader/detail.test.ts` (13 tests, 13 pass: Scope,
  Live, Attempts, Launches, Cost and limits, fixed cost text, redacted detail) and
  `tests/tab/detail-tree.test.ts` (the inspector panel, section order, focus returns to
  the card).
- Step 8 (theme, person-run; U-151-13) — closest equivalents `tests/static/styles.test.ts`
  (theme tokens, brace balance) and the badge glyph+label+grayscale assertions of
  `tests/tab/detail-tree.test.ts`; the visual theme-follow check itself has no
  per-change equivalent.
- Step 9 (actions, optional) — `tests/tab/actions.test.ts` (7 tests, 7 pass: stop/resume
  behind the consented flag, confirmation, output verbatim).
- Live probe (person-started) — `tests/live/dispatcher.live.test.ts` (F151-SC-002) and
  `tests/live/hermes-lane.test.ts` (the 150 host-facts lane). Not run by this task; the
  pinned Hermes 0.22.2 is installed on this machine, so these lanes would run rather
  than skip — they were still left unexecuted.
