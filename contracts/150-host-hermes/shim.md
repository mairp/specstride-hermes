# Contract: the shim `specstride-hermes` (150)

F150-FR-011 to F150-FR-014; research R6, R7. Built from the host-kit shim renderer; the only
channel to the CLI for skills, plugin glue, watcher and 151's projector and tab API (H2).

## Invocation

```
specstride-hermes <cli-argv…>
```

Every argument is passed to the CLI unchanged. The shim is never installed or linked as `specstride`.

## Resolution

1. `SPECSTRIDE_BIN` if set and executable.
2. The first `specstride` on `PATH` (the shim's own directory excluded).
3. Otherwise: exit **127**, stderr one line naming the engine's documented install command. Nothing is fetched or installed.

## Protocol check

`<cli> --protocol` → integer. Inside `package.json#specstride.protocol {min, max}` (1..1) → continue.
Outside → stdout `[SPECSTRIDE-REFUSE] action=protocol reason=protocol-mismatch`, exit **4**. A differing package version alone never refuses.

## Gateway-cgroup escape (`launch`, `resume` only)

When `/proc/self/cgroup` contains the unit of host fact `HF-GW-UNIT` (`hermes-gateway.service`):

- `systemd-run --scope --collect --quiet --unit=specstride-<8-hex> [--user when uid≠0] -- <cli> <argv…>`.
- `systemd-run` missing → stderr `[SPECSTRIDE-WARN] action=launch reason=gateway-cgroup`, run the CLI directly.

Outside the gateway cgroup the CLI runs directly. Engine detach does the rest (feature 122).

## Watch list

On `launch` exit 0 the shim appends the absolute working directory to `$HERMES_HOME/specstride-host/watch.json` (atomic; set semantics). This is host state, not the repository.

## Environment

| Variable | Use |
|---|---|
| `SPECSTRIDE_BIN` | CLI location (step 1) |
| `HERMES_HOME` | host-state root (default `~/.hermes`) |
| `SPECSTRIDE_CHILD` | passed through; hooks read it (R9) |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | CLI exit 0 |
| 4 | protocol mismatch (shim) |
| 127 | CLI missing (shim) |
| any other | the CLI's own exit, passed through (e.g. 3 "not in this build", 70 internal) |

## Tests

PT-150-011 (resolution order, no install), PT-150-012 (range in/out, version-only difference), PT-150-013 (cgroup fixture file → `systemd-run` argv; missing `systemd-run` → warning), PT-150-014 (no read of engine state files; a scan proves no other file spawns the CLI).
