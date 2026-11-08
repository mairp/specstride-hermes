# Contract: Specstride dashboard tab (151)

F151-FR-018 to F151-FR-025; research R7, R8.

## `hermes-plugin/specstride/dashboard/manifest.json`

```json
{
  "name": "specstride",
  "label": "Specstride",
  "description": "Engine run view: lanes, attention, quota, approvals (read-only).",
  "icon": "Activity",
  "version": "<package version>",
  "tab": { "path": "/specstride", "position": "after:kanban" },
  "entry": "dist/index.js",
  "api": "plugin_api.py"
}
```

No `tab.override`, no `hidden`, no slot into the Kanban tab.

## Bundle

`dist/index.js`: one IIFE built by `scripts/build-tab.ts` from `src/tab/client/*.ts` (type-strip + wrap). Uses `window.__HERMES_PLUGIN_SDK__` (`React`, `components`, `fetchJSON`), registers with `window.__HERMES_PLUGINS__.register("specstride", Component)`. Bundles no React, no other library; no `innerHTML`, no `Math.random`, no `Date.now` in renderers.

## Rendering

- Eight lanes in `LANES` order, empty lanes shown; unknown lane values in a trailing `?` column.
- Attention list (kind via presentation table, text verbatim).
- Budget rows with level and quota state.
- "Approvals": per-phase `approved`/`feedback` and `rejects`; "verdict ledger: not in the run view".
- Conditions `dead`, `stale`, `launch-abandoned` as a text banner.
- Markers: `absent` (with reason), `stale since <lastGoodAt>`.
- Presentation: one pure table `{glyph, label, grayscale}` per lane, attention kind, budget level; unknown → `{?, raw, 128}`.
- SDK components and theme tokens only; no colour literal; styles scoped to the tab root.
- Stop / stop-now / resume buttons only when the API reports actions enabled; each opens a confirm dialog.
