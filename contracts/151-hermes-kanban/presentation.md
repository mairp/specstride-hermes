# Contract: presentation, styles and the scan (151)

F151-FR-024, F151-FR-025, F151-FR-049; research R14, R15; OD-151-7. Added 2026-11-11 (lessons L9,
L11, L12). Source of truth for the values: [closed-sets.json](closed-sets.json); code
`src/tab/client/presentation.ts` and `src/kanban/generated/closed-sets.ts` are held equal to it.
Glyphs, labels and grayscale are those of specstride-dsh `contracts/kanban-closed-sets.json` and
`packages/dsh-kanban/src/shared/presentation.ts:61-93` at `ab8093e`; the token column is this
feature's.

## Rules

- Every member has four channels that travel together: **glyph** (the badge text), **label**
  (`aria-label`, and visible text in pills and chips), **grayscale** (`data-gray`, 0..255) and a
  **theme token** (the tint). Glyph and label are present wherever a tint is; colour carries no
  state alone.
- Within a set, its unknown member included, glyphs and labels are pairwise distinct and any two
  grayscale values differ by at least 24.
- A member the table does not know shows `?`, its raw value as the label, the set's unknown
  grayscale and `--color-border`.
- The table maps members to presentation. It maps nothing to a lane.
- Tokens are Hermes theme tokens only (`web/src/index.css:154-181`, hermes-agent 0.22.2, read
  2026-11-11). `mix` means `color-mix(in srgb, var(<token>) <percent>%, var(<with>))`.

## Lanes

| Lane | Glyph | Label | Grayscale | Theme token |
|---|---|---|---|---|
| `queued` | `·` | Queued | 232 | `--color-muted-foreground` |
| `proposing` | `▶` | Proposing | 160 | `--color-primary` |
| `verifying` | `◇` | Verifying | 184 | `--color-primary` 60 % mixed with `--color-success` |
| `reviewing` | `◎` | Reviewing | 136 | `--color-primary` 60 % mixed with `--color-warning` |
| `approved` | `✓` | Approved | 88 | `--color-success` |
| `blocked` | `⏸` | Blocked | 208 | `--color-warning` |
| `paused` | `‖` | Paused | 64 | `--color-warning` 50 % mixed with `--color-muted-foreground` |
| `failed` | `✗` | Failed | 40 | `--color-destructive` |
| unknown | `?` | the raw value | 112 | `--color-border` |

## Attention kinds

| Kind | Glyph | Label | Grayscale | Theme token |
|---|---|---|---|---|
| `blocked-on-human` | `!` | Needs you | 40 | `--color-warning` |
| `source-changed` | `△` | Source changed | 88 | `--color-primary` |
| `dead-run` | `†` | Run is dead | 16 | `--color-destructive` |
| `launch-abandoned` | `⊘` | Launch abandoned | 64 | `--color-destructive` |
| `quota-pause` | `‖` | Paused for quota | 136 | `--color-warning` |
| `budget-alert` | `$` | Budget alert | 112 | `--color-warning` |
| `stale-run` | `⌛` | View is stale | 160 | `--color-muted-foreground` |
| `orphan-processes` | `◌` | Orphan processes | 208 | `--color-muted-foreground` |
| `unknown-state` | `⁇` | Unknown state | 232 | `--color-border` |
| unknown | `?` | the raw value | 184 | `--color-border` |

## Budget levels

| Level | Glyph | Label | Grayscale | Theme token |
|---|---|---|---|---|
| `unknown` | `–` | Unknown | 232 | `--color-border` |
| `ok` | `✓` | OK | 200 | `--color-success` |
| `info` | `i` | Info | 136 | `--color-primary` |
| `warn` | `!` | Warn | 104 | `--color-warning` |
| `loud` | `‼` | Loud | 72 | `--color-warning` |
| `over` | `✗` | Over | 40 | `--color-destructive` |
| unknown member | `?` | the raw value | 168 | `--color-border` |

## Detail states

| Set | Member | Glyph | Label | Grayscale | Theme token |
|---|---|---|---|---|---|
| task | `done` | `✓` | done | 232 | `--color-success` |
| task | `met` | `◆` | critic: met | 200 | `--color-success` |
| task | `open` | `○` | open | 160 | `--color-muted-foreground` |
| task | `unmet` | `✗` | critic: unmet | 112 | `--color-destructive` |
| task | unknown | `?` | the raw value | 88 | `--color-border` |
| alive | `alive` | `●` | alive | 232 | `--color-success` |
| alive | `unknown` | `◌` | not observable | 176 | `--color-muted-foreground` |
| alive | `gone` | `○` | gone | 120 | `--color-muted-foreground` |
| alive | unknown member | `?` | the raw value | 64 | `--color-border` |
| outcome | `approved` | `✓` | approved | 232 | `--color-success` |
| outcome | `open` | `▶` | in progress | 184 | `--color-primary` |
| outcome | `rejected` | `✗` | rejected | 136 | `--color-destructive` |
| outcome | `ended` | `■` | ended | 112 | `--color-muted-foreground` |
| outcome | `interrupted` | `‖` | interrupted | 88 | `--color-warning` |
| outcome | unknown | `?` | the raw value | 64 | `--color-border` |
| launch | `running` | `▶` | running | 208 | `--color-primary` |
| launch | `completed` | `✓` | completed | 184 | `--color-success` |
| launch | `exited` | `■` | exited | 160 | `--color-muted-foreground` |
| launch | `stopped` | `⏸` | stopped | 136 | `--color-warning` |
| launch | `signalled` | `‖` | stopped by a signal | 112 | `--color-warning` |
| launch | `failed` | `✗` | failed | 88 | `--color-destructive` |
| launch | `lost` | `⚠` | lost (no exit record) | 64 | `--color-destructive` |
| launch | unknown | `?` | the raw value | 232 | `--color-border` |

## Styles

- One stylesheet, `src/tab/client/styles.css`, shipped as `dist/style.css`. Every selector starts
  with the generated prefix class `.sskh-<8 hex of the package version hash>`.
- A colour-bearing property (`color`, `background`, `background-color`, `border*`, `outline*`,
  `fill`, `stroke`, `box-shadow`, `text-decoration*`, `caret-color`, `accent-color`) takes only:
  `var(--color-…)` of the closed set "Theme tokens"; a plugin-local `var(--sskh-…)`, which may be
  declared only with a value that passes this same rule; or `color-mix(in srgb, …)` whose operands
  are only those and percentages. `transparent`, `currentColor` and `inherit` are admitted keywords.
- Tints are set per `[data-lane]` and `[data-tint]` from the table above through `--sskh-tint`.
  Grayscale is the badge's opacity: the build generates one rule per distinct value,
  `[data-gray="<v>"] { opacity: <v/255, 3 decimals> }`, so every member keeps its own step when
  colour is removed.
- A theme switch sets the tokens on the document root (`web/src/themes/context.tsx:349-386`), so
  the subtree follows by inheritance with no reload and no script of ours (read 2026-11-11; the
  live switch is person-run, U-151-13).
- Fonts are inherited from the dashboard; ids use the dashboard's monospace stack.

## Scan (`scripts/scan-kanban.ts`, run by the build; F151-FR-049)

| Rule | Fails the build on |
|---|---|
| `no-lane-assignment` | a lane assigned in source (`lane: "<literal>"`, `.lane =`, a `case "<lane>":` branch) anywhere but `src/kanban/reader/lanes.ts` and generated files; in `src/tab/client/board-model.ts`, a `columnOf` that reads anything but `card.lane` |
| `css-colour` | a hex colour; a colour function other than the admitted `color-mix`; a named colour; a `var()` that is neither a theme token of the closed set nor `--sskh-…`; a custom property of ours not named `--sskh-…` |
| `css-selector` | a selector without the `.sskh-<8 hex>` prefix; `:root`, `html`, `body`, `*` at the top level; `@import`; `@font-face`; `@media (prefers-color-scheme…)` |
| `markup-sink` | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, `document.write`, `eval`, `new Function` |
| `nondeterminism` | `Math.random`, `Date`, `performance.now` in `src/tab/client/{tree,board-model,board-tree,detail-tree,presentation,window}.ts` and in `src/kanban/{map,signature}.ts` |

Each rule has a fixture that must be flagged and one that must pass (`tests/static/scan-kanban.test.ts`).
Origin: dsh `packages/dsh-kanban/scripts/scan.ts:19, 83-91, 122-152, 194-207, 229-258`.

## Brace balance (`tests/static/styles.test.ts`; F151-FR-049)

With comments removed, the depth of `{` and `}` over `styles.css` and over the built
`dist/style.css` is never below 0 and is 0 at the end; depth above 1 is allowed only inside an
`@media`, `@supports` or `@layer` block. One stray brace makes a browser drop every rule after it
while the element-tree tests still pass (dsh `tests/static/theme.test.ts:139-148`).

## Tests

`tests/contract/kanban-closed-sets.test.ts` (totality over the pinned enums; pairwise distinct
glyph and label; grayscale ≥ 24 apart per set, unknown included; every token in the closed set;
the generated file equals this contract), `tests/tab/presentation.test.ts` (lookups, unknown
members), `tests/static/scan-kanban.test.ts`, `tests/static/styles.test.ts`.
