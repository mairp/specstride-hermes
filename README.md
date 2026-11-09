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
