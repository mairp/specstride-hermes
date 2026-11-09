# Release notes — @specstride/host-hermes

Template for a release of the Hermes host package (F150-FR-026, F150-FR-027).
A release is cut from a protected branch only, never from a working copy, and
MUST name the exact engine version it was built and tested with. Replace every
`<…>` before publishing; delete nothing.

```markdown
# @specstride/host-hermes <version>

- Engine (specstride): 0.1.0 — built and tested against the pin in
  `core-pin.json` (`coreCommit` abdfc7b59dcd8167553d0d731e029dab4c78dc4f);
  every `@specstride/*` dependency is that
  exact `file:vendor/core/*.tgz` tarball. A release built against any other
  engine version MUST refresh this line and `core-pin.json` together.
- Hermes tested against: hermes-agent 0.22.2 (d923a5eb48, Python 3.14.7) —
  the pin of the host-facts table (F150-FR-020).
- Built from: <protected branch> @ <commit sha> (F150-FR-027: never a working
  copy).
- Gate: `npm run gate` (pin:check, build, test, conformance,
  `hermes plugins validate hermes-plugin/specstride`) — 0 model calls.
- Skills shipped: <list — specstride-reverse only where the CLI has `reverse`>
- Settled U-items changed since the last release: <list or "none">
- Known blockers: <U-150-04, U-150-05, U-150-08 as still open>
```
