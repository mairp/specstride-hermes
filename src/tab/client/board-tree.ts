/**
 * The element tree of the board (T049, T058 — US4; contracts/tab-manifest.md
 * root order; F151-FR-019, F151-FR-046, F151-FR-047): `boardTreeOf` builds
 * the root element of the Specstride tab from a `BoardModel`.
 *
 * Child order of the root: the condition banners (role=status, direct
 * children), the source line (a reader view only) with its "quota: not
 * reported" line, the absent/no-run marker, the run strip (`data-summary`,
 * absent while a lane is windowed), the attention section, the budget
 * section, the per-phase approvals, and last the body — the lanes container
 * (`data-lanes`, one column per lane carrying `data-lane`, empty ones folded
 * with `data-empty` only when the board holds cards) and the inspector
 * (`data-inspector`) as siblings inside the body.
 *
 * Pure: no clock, no randomness, no I/O, no DOM; every string enters the
 * tree as a text node through `el`/`txt`, never as markup (F151-FR-049).
 * Origin: dsh `packages/dsh-kanban/src/shared/board-tree.ts` at `ab8093e`,
 * without the orbit and without the composer padding.
 */
import type { BoardModel } from "./board-model.ts";
import { el, type ElementNode } from "./tree.ts";
import { ATTENTION_SET, BUDGET_SET, badge, laneOf } from "./presentation.ts";
import { inspectorOf } from "./detail-tree.ts";

function asRecordTree(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The titled phases of the view, by number. */
function phaseTitles(board: BoardModel): Map<number, string> {
  const out = new Map<number, string>();
  const phases = Array.isArray(board.approvals) ? board.approvals : [];
  for (const phase of phases) {
    const record = asRecordTree(phase);
    const number = typeof record.number === "number" ? record.number : null;
    const title = typeof record.title === "string" ? record.title : null;
    if (number !== null && title !== null) out.set(number, title);
  }
  return out;
}

/** One card of a lane column: the phase token and the title span when the
 * card's phase carries a title, the full line in the title attribute. A card
 * whose phase has no title renders no `data-card-part` anywhere. */
function cardNode(card: Record<string, unknown>, titles: ReadonlyMap<number, string>, selection: string | null = null): ElementNode {
  const id = typeof card.id === "string" ? card.id : "?";
  const phase = typeof card.phase === "number" ? card.phase : null;
  const ownTitle = typeof card.title === "string" ? card.title : null;
  const phaseTitle = phase !== null ? (titles.get(phase) ?? null) : null;
  const title = ownTitle ?? phaseTitle;
  const hasDetail = typeof card.detail === "object" && card.detail !== null;
  const selected = selection !== null && selection === id;
  const children: (ElementNode | string)[] = [];
  if (phase !== null && title !== null) {
    children.push(el("span", { class: "sskh-phase", "data-card-part": "phase" }, `phase ${String(phase)}`));
    children.push(
      el(
        "span",
        { class: "sskh-title", "data-card-part": "title", title: `phase ${String(phase)} — ${title}` },
        title,
      ),
    );
  } else if (phase !== null) {
    children.push(el("span", { class: "sskh-phase" }, `phase ${String(phase)}`));
  } else {
    children.push(id);
  }
  return el(
    "div",
    {
      class: "sskh-card",
      "data-card-id": id,
      "data-kanban-card-id": id,
      "data-tint": typeof card.lane === "string" ? card.lane : "?",
      // A card that carries a detail is a toggle button (F151-FR-047); one
      // without stays a plain div.
      role: hasDetail ? "button" : undefined,
      tabindex: hasDetail ? "0" : undefined,
      "aria-pressed": hasDetail ? (selected ? "true" : "false") : undefined,
      "data-has-detail": hasDetail ? "true" : undefined,
    },
    ...children,
  );
}

/** One lane column: header with glyph and count, then its cards. The header
 * badge is tinted by `data-tint` — `data-lane` on this board stays on the
 * column node itself. `data-empty` only folds a lane when the board holds at
 * least one card (F151-FR-047). */
function laneColumn(
  lane: BoardModel["lanes"][number],
  titles: ReadonlyMap<number, string>,
  boardHasCards: boolean,
  selection: string | null,
): ElementNode {
  const name = String(lane.lane);
  const p = laneOf(name);
  return el(
    "div",
    {
      class: "sskh-col",
      "data-lane": name,
      "data-empty": boardHasCards && lane.empty ? "true" : undefined,
    },
    el(
      "div",
      { class: "sskh-col-head" },
      el(
        "span",
        {
          class: "sskh-badge",
          "aria-label": p.label,
          "data-gray": String(p.grayscale),
          "data-tint": name,
          title: p.label,
        },
        p.glyph,
      ),
      ` ${String(lane.cards.length)}`,
    ),
    ...lane.cards.map((card) => cardNode(card, titles, selection)),
  );
}

/** The attention section: one row per item, the kind as a badge, the view's
 * text verbatim beside it (an unknown kind renders `?` with the raw label). */
function attentionSection(board: BoardModel): ElementNode {
  const items = Array.isArray(board.attention) ? board.attention : [];
  return el(
    "section",
    { class: "sskh-section", "data-section": "attention" },
    el("h2", { class: "sskh-section-head" }, "Attention"),
    ...(items.length === 0
      ? [el("p", { class: "sskh-none" }, "nothing needs you")]
      : items.map((item) => {
          const record = asRecordTree(item);
          const kind = typeof record.kind === "string" ? record.kind : "?";
          const text = typeof record.text === "string" ? record.text : kind;
          return el(
            "div",
            { class: "sskh-attn-item", "data-kind": kind },
            badge(ATTENTION_SET, kind),
            el("span", { class: "sskh-attn-text" }, text),
          );
        })),
  );
}

/** The budget section: one row per row of the view's budget (an unknown
 * level renders `?` with the raw label). */
function budgetSection(board: BoardModel): ElementNode {
  const rows = Array.isArray(board.budget) ? board.budget : [];
  return el(
    "section",
    { class: "sskh-section", "data-section": "budget" },
    el("h2", { class: "sskh-section-head" }, "Quota and budgets"),
    ...(rows.length === 0
      ? [el("p", { class: "sskh-none" }, "not reported")]
      : rows.map((row) => {
          const record = asRecordTree(row);
          const level = typeof record.level === "string" ? record.level : "?";
          const scope = typeof record.scope === "string" ? record.scope : "?";
          const quota = record.quota;
          return el(
            "div",
            { class: "sskh-budget-row", "data-level": level },
            badge(BUDGET_SET, level),
            el(
              "span",
              { class: "sskh-budget-text" },
              `${scope}: ${quota === null || quota === undefined ? "not reported" : String(quota)}`,
            ),
          );
        })),
  );
}

/** The approvals section: the per-phase approvals as the view carries them,
 * plain text (no `data-card-part`, no card chrome). */
function approvalsSection(board: BoardModel): ElementNode {
  const phases = Array.isArray(board.approvals) ? board.approvals : [];
  return el(
    "section",
    { class: "sskh-section", "data-section": "approvals" },
    el("h2", { class: "sskh-section-head" }, "Approvals"),
    ...(phases.length === 0
      ? [el("p", { class: "sskh-none" }, "no phase recorded")]
      : phases.map((phase) => {
          const record = asRecordTree(phase);
          const number = typeof record.number === "number" ? record.number : null;
          const title = typeof record.title === "string" ? record.title : null;
          const approved = record.approved === true;
          const label =
            title === null
              ? `phase ${number === null ? "?" : String(number)}`
              : `phase ${number === null ? "?" : String(number)} — ${title}`;
          return el(
            "div",
            { class: "sskh-approval-row", "data-approved": approved ? "true" : "false" },
            label,
          );
        })),
  );
}

/** The labels of the three consented verbs (F151-FR-026; the closed set). */
const ACTION_LABELS: readonly { verb: string; label: string }[] = [
  { verb: "stop", label: "Stop" },
  { verb: "stop-now", label: "Stop now" },
  { verb: "resume", label: "Resume" },
];

/**
 * The actions section (US5, T073; F151-FR-026): rendered only when the
 * profile turned `specstride.kanban.actions` on — otherwise the board holds
 * no button at all. Each verb is a button that only opens the confirmation
 * dialog (`data-kanban-confirm`); the dialog's confirm control is the only
 * thing that sends the verb, whose output is then shown verbatim as text.
 * Pure: no fetch, no lane change, nothing is derived.
 */
function actionsSection(board: BoardModel): ElementNode | null {
  if (!board.actionsEnabled) return null;
  const children: (ElementNode | string)[] = ACTION_LABELS.map((action) =>
    el(
      "button",
      {
        class: "sskh-action",
        "data-kanban-action": action.verb,
        role: "button",
        tabindex: "0",
      },
      action.label,
    ),
  );
  if (board.pendingVerb !== null) {
    const label = ACTION_LABELS.find((action) => action.verb === board.pendingVerb)?.label ?? String(board.pendingVerb);
    children.push(
      el(
        "div",
        { class: "sskh-confirm", "data-kanban-confirm": board.pendingVerb, role: "dialog" },
        `Confirm: ${label} the run?`,
        el(
          "span",
          { class: "sskh-confirm-row" },
          el("button", { class: "sskh-confirm-yes", "data-kanban-confirm-verb": board.pendingVerb, role: "button", tabindex: "0" }, "Confirm"),
          el("button", { class: "sskh-confirm-no", "data-kanban-cancel": "", role: "button", tabindex: "0" }, "Cancel"),
        ),
      ),
    );
  }
  if (board.actionOutput !== null) {
    children.push(el("span", { class: "sskh-action-output", "data-action-output": "" }, board.actionOutput));
  }
  return el("section", { class: "sskh-section", "data-section": "actions" }, el("h2", { class: "sskh-section-head" }, "Actions"), ...children);
}

/** The root element of the board tree, a pure function of the board. */
export function boardTreeOf(board: BoardModel): ElementNode {
  const titles = phaseTitles(board);
  const isReader = board.viewSource === "workspace-reader";
  const boardHasCards = board.lanes.some((lane) => lane.cards.length > 0);
  const lanesContainer = el(
    "div",
    { class: "sskh-lanes", "data-lanes": "" },
    ...board.lanes.map((lane) => laneColumn(lane, titles, boardHasCards, board.selectedCardId)),
  );
  // The inspector: the selected card's detail (the five sections of the
  // detail contract), else the placeholder (F151-FR-043, F151-FR-047).
  const inspector =
    board.selectedCard !== null && board.detail !== null && board.selectedCardId !== null
      ? inspectorOf({
          card: board.selectedCard,
          detail: board.detail,
          featureDetail: board.featureDetail ?? {},
        })
      : el(
          "aside",
          { class: "sskh-inspector", "data-inspector": "" },
          "select a card to see its detail",
        );
  const children: (ElementNode | string | null)[] = [
    ...board.banners,
    isReader
      ? el(
          "div",
          { class: "sskh-source-line", "data-view-source": "" },
          "View from workspace files (the engine's view is absent or empty)",
        )
      : el("div", { class: "sskh-source-line" }, "View from the engine"),
    isReader ? el("div", { class: "sskh-quota-line" }, "quota: not reported") : null,
    board.marker === null ? null : el("div", { class: "sskh-marker", role: "status" }, board.marker),
    board.strip,
    actionsSection(board),
    attentionSection(board),
    budgetSection(board),
    approvalsSection(board),
    el("div", { class: "sskh-body", "data-body": "" }, lanesContainer, inspector),
  ];
  return el(
    "div",
    { class: "sskh-root", "data-board": "" },
    ...children.filter((child): child is ElementNode | string => child !== null),
  );
}
