# specstride-hermes

The Hermes host of Specstride: `specs/150-host-hermes`. It is the third
implementation of the host port EP-01 (`specstride.host/1`), after the Claude
plugin and the dsh host. From a Hermes chat, the TUI or Telegram, a user
derives, dry-runs, launches, supervises, stops, resumes and curates Spec Kit
features through the pinned engine, with the same safety rules as the other
hosts. It adds two things the other hosts do not have: push notices to
Telegram when a run needs its owner, and plugin hooks so the status line
appears without being asked for. Neither ever carries a run (H5): a run
survives the session, the TUI and a gateway restart, because the engine
starts it detached and the host launches it outside the gateway's cgroup.

The package adds no product logic and copies no engine source (H1, H9): every
fact it shows is a line of the CLI, reached only through the shim
`specstride-hermes`, and the engine arrives as sha256-pinned tarballs under
`vendor/core/` (`core-pin.json`). The skills are rendered from
`@specstride/host-kit` so the three hosts cannot drift; Python exists only as
thin plugin glue that forwards to Node (H3).

## Quickstart — five commands

On a machine with Hermes 0.22.2 and Node ≥ 22 (full guide:
`specs/150-host-hermes/quickstart.md`):

```sh
specstride-host-hermes install --profile specstride   # 1 — skills + plugin, install record
specstride-host-hermes install --profile specstride   #    → "already installed, unchanged"
specstride-host-hermes doctor                         # 2 — eight host.* findings, no model
hermes -p specstride                                  # 3 — the dedicated profile (H7)
/specstride-run dry-run                               # 4 — derive, validate, print the plan, launch nothing
/specstride-run                                       # 5 — launch; the CLI's outcome line, then supervise
```

`install` never touches the default profile: `--user` writes files and prints
the enable command instead of running it; `--project` writes to
`<git-root>/.hermes/skills` and prints the `hermes skills trust` command.

## The watcher unit

`systemd/specstride-hermes-watch.service` is a user unit (printed, installed
by a person). It polls `wait --until-change` through the shim, precomputes
the status line the hooks read, and sends one Telegram line per state change
or attention item (gate, park, quota pause, failure) through `hermes send` —
never through a model turn, deduplicated by the CLI's cursor, delivered
within 60 s, and never gating a run: a failed delivery is one log line.

```sh
systemctl --user status specstride-hermes-watch
```

## Doctor checks

`specstride-host-hermes doctor` (and `/specstride doctor`) prints, after
`specstride doctor`, one `<severity> <check> — <fix>` line per finding:

`host.cli-found` (the only blocker) · `host.protocol-supported` ·
`host.hermes-version` · `host.skills-installed` · `host.state-root-writable` ·
`host.permission-mode` · `host.plugin-enabled` · `host.kanban-plugin`
(informational).

It calls no model, finishes within 2 s on the reference machine, and never
installs, enables, configures or changes anything.

## Kanban and dashboard tab

`install --with-kanban` installs the projector module — `src/kanban`, `src/tab`
and the dashboard assets of the package — under
`<home>/specstride-host/kanban/module`, recorded by a `kanban.json` marker that
carries the package version; a module of another version is refused, and the
install must equal this package's own (`src/installer.ts`,
`installKanbanModule`). When that module is in place, 150's watcher unit runs
one sync cycle per workspace of `watch.json` at the end of each watch cycle;
without it, nothing is registered and the watcher stays unchanged
(`src/kanban/register.ts`).

What appears on the board is fixed by contract
(`specs/151-hermes-kanban/contracts/card-projection.md`): one root card per run
(key `specstride:<run-id>`), one stage card per phase of that run, and one
`blocked` card per attention item. A feature that was never run produces
nothing — there is no card for it. A board write made by a person (a moved
column, a changed assignee) is undone by the restore guard within one cycle;
the read-back runs at least every 60 s, and a human-edited title or body is
kept and gets one stale comment instead (`tests/kanban/restore.test.ts`,
`contracts/sync-sidecar.md` "Foreign writes").

Every view names its origin. A view the workspace reader built carries the
body line `source: workspace-reader` and the rule id that placed each card
(`src/kanban/view-source.ts`, `src/kanban/reader/`); it is used only where the
engine's `status --json` answer is unavailable or carries no card, and an
engine view with at least one card always wins over it. A card with a detail
opens an inspector beside the lanes, with five sections in order — Scope, Live,
Attempts, Launches, Cost and limits. It shows no absolute path (paths are
reduced to workspace-relative, `~/…` or a base name) and marks what the inputs
cannot say as `not observable` or `not reported`
(`specs/151-hermes-kanban/contracts/card-detail.md`).

`specstride-host-hermes doctor` appends to `host.kanban-plugin` one line with
eleven observed facts, from `kanban-enabled` to `view-source`
(`src/doctor.ts`, `specs/150-host-hermes/contracts/doctor-output.md`). A fact
that could not be observed reads `unknown` and makes the line informational
(`info`, never `ok`); the check never blocks a launch.

The reader is a stand-in. It is retired when the engine's `status --json`
carries, for a pipeline-launched run, the cards and their detail (upstream row
U-151-09, F151-FR-042); until then `specstride.kanban.reader: off` in the
specstride profile configuration disables it, leaving the absent marker where
the engine gives no view
(`specs/151-hermes-kanban/spec.md` U-151-09 / F151-FR-042).

## Out of scope

| Not here | Owner |
|---|---|
| Hermes as an engine proposer or critic (`hermes:<provider>/<model>`) | specstride-core `152-adapter-hermes` |
| Batch, campaign and worktree lanes | follow-up `153` |
| The Kanban projection and the *Specstride* dashboard tab | `151-hermes-kanban` |
| The engine's CLI verbs, detached start and survival | engine features (100, 102, 107, 108, 112, 122, 123, 129) |

Development: `npm run gate` is the per-change gate (pin:check, build, test,
conformance, plugin validation; 0 model calls). The prompts that produced
this feature stay in the git-ignored `prompts/`.
