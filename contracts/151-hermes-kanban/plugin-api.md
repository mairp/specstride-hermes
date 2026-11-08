# Contract: dashboard API `/api/plugins/specstride/` (151)

F151-FR-019 to F151-FR-023, F151-FR-026; research R7. `plugin_api.py` exports `router`; every route
forwards argv to `specstride-host-hermes tab <op> …` (Node) and returns its stdout and status. No
logic in Python.

## Auth

1. Hermes session auth (header token on loopback, cookie in gated mode) — enforced by Hermes for `/api/*`; the handler also refuses when Hermes passes no authenticated session.
2. A run-bound view token from `GET session`, required by every other route. Missing/foreign/expired token → 401, 0 CLI calls.

## Routes

| Method | Path | Query/body | Node op | CLI verb via shim |
|---|---|---|---|---|
| GET | `session` | `ws=<workspaceKey>` | `tab session` | `status --json` (to bind the run id) |
| GET | `view` | `ws`, `token` | `tab view` | `status --json` |
| GET | `wait` | `ws`, `token`, `cursor` | `tab wait` | `wait --until-change --cursor <c> --timeout 25` |
| GET | `workspaces` | — | `tab workspaces` | none (reads `watch.json`) |
| POST | `action` | `{token, verb, confirm: true}` | `tab action` | `stop` \| `stop --now` \| `resume` — only when `specstride.kanban.actions: true` |

With actions off the POST route is not registered (404).

## Responses

`200 {view, lastGoodAt}` · `200 {marker: "absent", reason}` (CLI missing, exit 70, invalid view) · `200 {marker: "stale", lastGoodAt}` · `401` · `400` (unknown verb, missing confirm) · `504` (CLI timeout). Never 500 from a CLI failure: failures are markers.

## Limits

`status --json` 10 s; `wait` 25 s + 5 s grace; one outstanding `wait` per token.
