# Contract: Specstride dashboard tab (151)

F151-FR-018 to F151-FR-025, F151-FR-035, F151-FR-046 to F151-FR-050, F151-FR-052; research R7, R8,
R14, R15, R16. Amended 2026-11-11 (lessons L5, L7, L9 to L13, L15, L18): design direction B, the
source line, the strict SDK fake, the stylesheet, the drift check. Presentation values and scan
rules are in [presentation.md](presentation.md); the inspector in [card-detail.md](card-detail.md).

## `hermes-plugin/specstride/dashboard/manifest.json`

```json
{
  "name": "specstride",
  "label": "Specstride",
  "description": "Run view: lanes, attention, quota, approvals (read-only).",
  "icon": "Activity",
  "version": "<package version>",
  "tab": { "path": "/specstride", "position": "after:kanban" },
  "entry": "dist/index.js",
  "css": "dist/style.css",
  "api": "plugin_api.py"
}
```

No `tab.override`, no `hidden`, no slot into the Kanban tab.

## Bundle

`dist/index.js`: one IIFE built by `scripts/build-tab.ts` from `src/tab/client/*.ts` (type-strip + wrap). Uses `window.__HERMES_PLUGIN_SDK__` (`React`, `hooks`, `components`, `fetchJSON`), registers with `window.__HERMES_PLUGINS__.register("specstride", Component)`. Bundles no React, no other library; no `innerHTML`, no `Math.random`, no `Date.now` in renderers. `dist/style.css` is `src/tab/client/styles.css` with the generated prefix; the manifest's `css` field has Hermes inject it as a `<link>` (`extending-the-dashboard.md:776-788`).

- **Only `react-adapter.ts` reads the SDK.** The members it may read are the closed set "SDK members" (`web/src/plugins/registry.ts:118-191`, read 2026-11-11): `sdkVersion`, `React`, `hooks`, `api`, `fetchJSON`, `authedFetch`, `buildWsUrl`, `buildWsAuthParam`, `components`, `utils`, `useI18n`.
- **Strict fake** (F151-FR-050): `tests/helpers/sdk-fake.ts` is a `Proxy` over exactly those members (and, inside `hooks`, `components` and `utils`, exactly the names of that file); reading any other member throws `not a member of __HERMES_PLUGIN_SDK__: <name>`. One test loads the built `dist/index.js` through it and asserts one `register("specstride", …)` call.
- **Drift** (F151-FR-052): the committed `dist/index.js` and `dist/style.css` are byte-equal to a fresh build; `tests/static/bundle-drift.test.ts` fails otherwise.
- **Live lane** (F151-FR-050): `tests/live/tab.live.test.ts` starts a real Hermes 0.22.2 dashboard in a temporary `HERMES_HOME`, requests the plugin list and the bundle with the session token, asserts 401 without it, requests a route of a disabled plugin (U-151-12), and reports `skipped` when Hermes is absent. It calls no model.

## Rendering

Pure builders over an element tree; equal view and equal selected card give a byte-equal tree (F151-FR-020). Order of the board root's children:

1. **Banners** (direct children, `role="status"`): conditions `dead`, `stale`, `launch-abandoned`, then the client's own `Not updated since <time>`; the last is removed by the next good answer (F151-FR-039).
2. **Source line** (`data-view-source`): for a reader view `View from workspace files (the engine's view is absent or empty)`; nothing for an engine view (F151-FR-035).
3. **Markers**: `absent` (with reason), `no-run` (`No Specstride run in this workspace`).
4. **Run strip** (`data-summary`; omitted while a lane is windowed; F151-FR-046, F151-FR-048):
   - one chip per lane: glyph, label, card count (`data-tint="<lane>"`, `data-empty` at 0);
   - one row per feature, at most 4, then `and <N> more feature(s)`: the name as a heading, `<X> of <N> approved`, a track with one segment per card in phase order (`data-tint`, `aria-hidden`), and the run line `<run id> · <state> · phase <n> · last event <time>` when `featureDetails[<f>].run` exists;
   - order: features with a run first (a run that is `running` or `between passes` before an ended one, then the newest `lastAt`), then features never run in first-appearance order of `view.cards`;
   - it counts and tints what the view placed and assigns no lane.
5. **Attention list** (kind via the presentation table, text verbatim, `and <N> more`).
6. **Budget rows** with level and quota state; for a reader view the one line `quota: not reported`.
7. **Approvals**: per-phase `approved`/`feedback` and `rejects` where the view carries `phases[]`; `verdict ledger: not in the run view`.
8. **Body**: the lanes and, beside them, the inspector of the selected card.

Lanes (F151-FR-047): eight in `LANES` order, then one trailing column per unknown lane value. A column's place is `card.lane` and nothing else. Header: a pill (glyph, label) and the count. A lane with no card carries `data-empty="true"` and folds to a rail when at least one lane holds cards; lanes with cards share the width. Cards are grouped by feature under a heading. A titled phase card is two spans: the phase token (`data-card-part="phase"`) and the title (`data-card-part="title"`, truncating last, the full line `phase <n> — <title>` in its `title` attribute); a card with a detail is also a button (`role="button"`, `tabindex="0"`, `aria-pressed`).

Window (F151-FR-048): above the threshold (default 100, `specstride.kanban.laneThreshold`, 1..10 000; an invalid value falls back to 100 with one log line) a lane renders the contiguous slice around its scroll position, at most threshold + 2 × 20 card nodes, inside one scroll container (`data-window`); lanes with no card in the window are left out of the tree while it is windowed.

Presentation and styles: [presentation.md](presentation.md). Stop / stop-now / resume buttons only when the API reports actions enabled; each opens a confirm dialog (`SDK.components.ConfirmDialog`).

Not carried from dsh: the bottom padding that clears dsh's floating composer (not applicable: a Hermes plugin tab is a page of its own with nothing floating over it) and the orbit projection.
