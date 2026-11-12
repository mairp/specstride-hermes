# Contract: dashboard API `/api/plugins/specstride/` (151)

F151-FR-019 to F151-FR-023, F151-FR-026, F151-FR-033, F151-FR-039; research R7, R10, R12, R16.
`plugin_api.py` exports `router`; every route forwards argv to `specstride-host-hermes tab <op> …`
(Node) and returns its stdout and status. No logic in Python. Amended 2026-11-11 (lessons L1, L5,
L8, L16, L17): the answers, the reader fallback, the engine memo, how a non-JSON answer reads, the
shim's probe.

## CLI calls and the shim's probe (L17; F151-FR-051)

The handler spawns only 150's shim, with the argv of the closed set `kanban-cli-verbs`. The shim
itself probes `--protocol` before every call (150's check). That probe is not a verb of this
feature: the stub CLI of the tests answers it (default `1`) and logs it with `probe: true`, and
every "no verb outside the closed set" assertion counts verbs, not probes. A stub that refused the
probe would fail every test through the shim (dsh 121 analyze finding A-1).

## Auth

1. Hermes session auth (header token on loopback, cookie in gated mode) — enforced by Hermes for `/api/*`; the handler also refuses when Hermes passes no authenticated session.
2. A run-bound view token from `GET session`, required by every other route. Missing/foreign/expired token → 401, 0 CLI calls. For an engine view the token binds to the view's `runId`. For a reader view it binds to `workspace:<workspaceId>` (the reader view spans the features of a workspace): a relaunch changes the cards and the run line, not the binding, and the reader never mixes two runs of one feature (workspace-reader.md §3).

## Routes

| Method | Path | Query/body | Node op | CLI verb via shim |
|---|---|---|---|---|
| GET | `session` | `ws=<workspaceKey>` | `tab session` | `status --json` (to bind the run id), then the reader if needed |
| GET | `view` | `ws`, `token` | `tab view` | `status --json`, then the reader if needed |
| GET | `wait` | `ws`, `token`, `cursor` | `tab wait` | engine view: `wait --until-change --cursor <c> --timeout 25`; reader view: no CLI call, the reader's signature is compared with the cursor |
| GET | `workspaces` | — | `tab workspaces` | none (reads `watch.json`) |
| POST | `action` | `{token, verb, confirm: true}` | `tab action` | `stop` \| `stop --now` \| `resume` — only when `specstride.kanban.actions: true` |

With actions off the POST route is not registered (404).

## How a view is obtained (F151-FR-033)

Every read route calls `viewOf` of `src/kanban/view-source.ts`, the function the projector uses:
engine through the shim (skipped while the memo holds) → an engine view with a card wins → else the
workspace reader, in the handler's own process → else the engine's own answer. The reader is never
a CLI call and never a subprocess.

## Responses

Every 200 body is a JSON object with an `answer` of the closed set "API answers":

| `answer` | Body | When |
|---|---|---|
| `view` | `{answer, view, source, cursor, lastGoodAt}` | a view to show; `source` is `engine` or `workspace-reader` |
| `unchanged` | `{answer, cursor}` | the cursor's signature equals the view's |
| `no-run` | `{answer}` | the engine answered a valid view with state `none` and the reader found no card |
| `absent` | `{answer, reason}` | no usable engine answer and no reader card (CLI missing, non-zero exit including the `no-feature` / `no-state` envelopes, invalid view, reader off) |
| `refused-schema` | `{answer, line}` | the engine answered a view outside the supported schema major and the reader found no card |
| `unavailable` | `{answer, line}` | the handler itself failed; the line names the doctor |
| `run-changed` | `{answer}` (409) | the token is bound to another run |

Other statuses: `401` (no session or no token) · `400` (unknown verb, missing confirm, bad cursor) · `504` (CLI timeout). Never 500 from a CLI failure: failures are answers.

**What the client reads as unavailable** (F151-FR-023): any status outside 2xx except the ones it
handles (`401`, `409`); a content type that is not JSON; a body that does not parse; an object
without a known `answer`; a thrown `fetchJSON`. On Hermes 0.22.2 a route that is not mounted, and
the routes of a `plugin_api.py` that failed to import, answer **404 JSON**
(`hermes_cli/web_server_dashboard.py:227-233, 943-960, 1045-1047`, read 2026-11-11; U-151-12); an
HTML answer can still come from a proxy. All of them show the one line
`Specstride view unavailable — run specstride-host-hermes doctor`, with no partial board. A
`view`, `unchanged` or `no-run` answer clears the stale line (F151-FR-039).

`GET session` answers `{token, expiresAt, actions, laneThreshold}` beside the view answer:
`actions` is `specstride.kanban.actions` (default `false`; the tab shows buttons only when it is
`true`), `laneThreshold` is `specstride.kanban.laneThreshold` (default 100, 1..10 000; an invalid
value is sent as 100 and logged once).

## Engine memo (F151-FR-039)

After an engine answer for a workspace that is unavailable, is a view of an unsupported schema major, or is a valid view with no card
while the reader gave cards, the handler does not ask the engine for that workspace for 60 s and answers
from the reader at once. At most 64 workspaces; an engine view that carries a card deletes the
entry. Beside the newest view per token this memo is the only state the handler
holds; it writes no file.

## Limits

`status --json` 10 s; `wait` 25 s + 5 s grace; one outstanding request per token; client cadence
5 s after a good answer, backoff 1, 2, 4, 8, 16, 30 s after a failed one; no answer is awaited
past 35 s.
