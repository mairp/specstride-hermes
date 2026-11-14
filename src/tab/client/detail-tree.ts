/**
 * The inspector tree of the dashboard tab (T070 — US6; contracts/card-detail.md;
 * F151-FR-043, F151-FR-044, F151-FR-045, F151-FR-047): the `aside` that shows
 * one card's detail — the five sections in the contract's order (Scope, Live,
 * Attempts, Launches, Cost and limits), badges that always carry a glyph, a
 * label and grayscale, the fixed texts (`not observable`, `not reported`,
 * `started by hand`), and the close control.
 *
 * Pure: no clock, no randomness, no I/O; every string enters the tree as a
 * text node through `el`/`txt`, never as markup (F151-FR-049). The view the
 * detail came from is only read.
 */
import type { ElementNode } from "./tree.ts";
import { el, txt } from "./tree.ts";
import { ALIVE_SET, LAUNCH_SET, OUTCOME_SET, badge } from "./presentation.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** One section: a `data-detail-section` node with its `h3` head. */
function section(kind: string, head: string, ...children: (ElementNode | string)[]): ElementNode {
  return el("section", { class: "sskh-detail-sec", "data-detail-section": kind }, el("h3", { class: "sskh-detail-head" }, head), ...children);
}

/** One labelled row: the badge (when the state is known) and the text. */
function row(label: string, value: string): ElementNode {
  return el("div", { class: "sskh-detail-row" }, el("span", { class: "sskh-detail-label" }, label), el("span", { class: "sskh-detail-value" }, value));
}

/** The Scope section: the phase's goal, test, checkpoint, tasks and files. */
function scopeSection(detail: Record<string, unknown>): ElementNode {
  const tasks = asList(detail.tasks);
  const files = Array.isArray(detail.files) ? (detail.files as unknown[]).filter((f): f is string => typeof f === "string") : [];
  const children: (ElementNode | string)[] = [
    row("goal", str(detail.goal) ?? "not reported"),
    row("independent test", str(detail.independentTest) ?? "not reported"),
    row("checkpoint", str(detail.checkpoint) ?? "not reported"),
    row(
      "tasks",
      `${String(num(detail.tasksDone) ?? 0)} of ${String(num(detail.tasksTotal) ?? 0)}${
        num(detail.tasksOmitted) !== null && (num(detail.tasksOmitted) as number) > 0 ? ` (and ${String(detail.tasksOmitted)} more)` : ""
      }`,
    ),
    row("files", files.length === 0 ? "not reported" : files.join(", ")),
  ];
  for (const task of tasks) {
    const verdict = str(task.verdict);
    children.push(
      el(
        "div",
        { class: "sskh-detail-task", "data-task-done": task.done === true ? "true" : "false" },
        badge(OUTCOME_SET, verdict, "sskh-task-verdict"),
        el("span", { class: "sskh-task-id" }, str(task.id) ?? "?"),
        el("span", { class: "sskh-task-text" }, str(task.text) ?? ""),
      ),
    );
  }
  return section("scope", "Scope", ...children);
}

/** The Live section: the run record, the agents and the phase's approval,
 * evidence, counters and units. */
function liveSection(detail: Record<string, unknown>, featureDetail: Record<string, unknown>): ElementNode {
  const run = asRecord(featureDetail.run);
  const children: (ElementNode | string)[] = [];
  if (run === null || Object.keys(run).length === 0) {
    children.push(row("run", "started by hand"));
  } else {
    children.push(row("run", str(run.id) ?? "?"));
    children.push(el("div", { class: "sskh-detail-row" }, el("span", { class: "sskh-detail-label" }, "state"), badge(OUTCOME_SET, str(run.state), "sskh-run-state")));
    children.push(run.launch === null || run.launch === undefined ? row("launch", "started by hand") : row("launch", String(run.launch)));
    children.push(row("last event", str(run.lastAt) ?? "not observable"));
  }
  const agents = asList(featureDetail.agents);
  for (const agent of agents.slice(0, 8)) {
    const alive = bool(agent.alive);
    children.push(
      el(
        "div",
        { class: "sskh-detail-agent" },
        el("span", { class: "sskh-agent-role" }, str(agent.role) ?? "agent"),
        badge(ALIVE_SET, alive === true ? "alive" : alive === false ? "gone" : "unknown", "sskh-agent-alive"),
        el("span", { class: "sskh-agent-what" }, str(agent.what) ?? ""),
      ),
    );
  }
  children.push(row("agents", str(featureDetail.agentsNote) ?? "not observable"));
  const approval = asRecord(detail.approval);
  children.push(
    approval === null || Object.keys(approval).length === 0
      ? row("approval", "not reported")
      : row("approval", `${str(approval.at) ?? "?"} · attempt ${String(num(approval.attempt) ?? "?")} · ${str(approval.critic) ?? "?"} · ${str(approval.commit) ?? "?"}`),
  );
  const evidence = asRecord(detail.evidence);
  children.push(
    evidence === null || Object.keys(evidence).length === 0
      ? row("evidence", "not reported")
      : row("evidence", `${str(evidence.name) ?? "?"} (${String(num(evidence.bytes) ?? 0)} bytes)`),
  );
  const counters = asRecord(detail.counters);
  if (Object.keys(counters).length > 0) {
    children.push(
      row("counters", `rejects ${String(num(counters.rejects) ?? 0)} · pass errors ${String(num(counters.passErrors) ?? 0)} · no progress ${String(num(counters.noProgress) ?? 0)} · cap hits ${String(num(counters.capHits) ?? 0)}`),
    );
  }
  children.push(row("units", detail.units === null || detail.units === undefined ? "not reported" : String(detail.units)));
  return section("live", "Live", ...children);
}

/** The Attempts section: one row per attempt, newest first. */
function attemptsSection(detail: Record<string, unknown>): ElementNode {
  const attempts = asList(detail.attempts);
  const children: (ElementNode | string)[] = [];
  if (attempts.length === 0) children.push(el("p", { class: "sskh-none" }, "no attempt recorded"));
  for (const attempt of attempts) {
    children.push(
      el(
        "div",
        { class: "sskh-detail-attempt", "data-attempt": String(num(attempt.attempt) ?? "?") },
        badge(OUTCOME_SET, str(attempt.outcome), "sskh-attempt-outcome"),
        el("span", { class: "sskh-attempt-run" }, str(attempt.run) ?? "?"),
        el("span", { class: "sskh-attempt-when" }, `${str(attempt.startedAt) ?? "?"} → ${str(attempt.endedAt) ?? "not observable"}`),
        el("span", { class: "sskh-attempt-counts" }, `passes ${String(num(attempt.passes) ?? 0)} · errors ${String(num(attempt.errors) ?? 0)}`),
      ),
    );
  }
  if (num(detail.attemptsOmitted) !== null && (num(detail.attemptsOmitted) as number) > 0) {
    children.push(el("p", { class: "sskh-omitted" }, `and ${String(detail.attemptsOmitted)} more`));
  }
  return section("attempts", "Attempts", ...children);
}

/** The Launches section: one row per launch, newest first, `current` flagged. */
function launchesSection(featureDetail: Record<string, unknown>): ElementNode {
  const launches = asList(featureDetail.launches);
  const children: (ElementNode | string)[] = [];
  if (launches.length === 0) children.push(el("p", { class: "sskh-none" }, "no launch recorded"));
  for (const launch of launches) {
    children.push(
      el(
        "div",
        { class: "sskh-detail-launch", "data-current": launch.current === true ? "true" : "false" },
        badge(LAUNCH_SET, str(launch.state), "sskh-launch-state"),
        el("span", { class: "sskh-launch-id" }, str(launch.launch) ?? "?"),
        el("span", { class: "sskh-launch-when" }, str(launch.at) ?? "not observable"),
        launch.current === true ? el("span", { class: "sskh-launch-current" }, "current") : null,
        str(launch.exit) !== null ? el("span", { class: "sskh-launch-exit" }, String(launch.exit)) : null,
      ),
    );
  }
  if (num(featureDetail.launchesOmitted) !== null && (num(featureDetail.launchesOmitted) as number) > 0) {
    children.push(el("p", { class: "sskh-omitted" }, `and ${String(featureDetail.launchesOmitted)} more`));
  }
  return section("launches", "Launches", ...children.filter((child): child is ElementNode | string => child !== null));
}

/** The Cost and limits section: the usage, the fixed cost and quota texts. */
function costSection(featureDetail: Record<string, unknown>): ElementNode {
  const usage = asRecord(featureDetail.usage);
  const hasUsage = Object.keys(usage).length > 0;
  const models = Array.isArray(usage.models) ? (usage.models as unknown[]).filter((m): m is string => typeof m === "string") : [];
  return section(
    "cost",
    "Cost and limits",
    hasUsage
      ? row(
          "usage",
          `${String(num(usage.calls) ?? 0)} calls · ${String(num(usage.tokensIn) ?? 0)} in · ${String(num(usage.tokensOut) ?? 0)} out · ${String(num(usage.retries) ?? 0)} retries (${String(num(usage.rateLimited) ?? 0)} rate limited)${models.length > 0 ? ` · ${models.join(", ")}` : ""}`,
        )
      : row("usage", str(featureDetail.usageNote) ?? "not reported"),
    row("cost", str(featureDetail.cost) ?? "not reported"),
    row("limits", str(featureDetail.limits) ?? "not reported"),
  );
}

export interface InspectorInput {
  /** The selected card (its id, lane, phase and title). */
  card: Record<string, unknown>;
  /** The card's phase detail (`cards[].detail`), when it carries one. */
  detail: Record<string, unknown>;
  /** The feature's detail (`featureDetails[<feature>]`), when it carries one. */
  featureDetail: Record<string, unknown>;
  /** The close handler, wired by the adapter (never called from the tree). */
  onClose?: () => void;
  onKeyDown?: (event: { key: string }) => void;
}

/**
 * The inspector `aside` of one card's detail: `data-kanban-detail` names the
 * card id, `role="region"`, `data-lane` the card's lane, the five sections
 * in the contract's order, and the close control.
 */
export function inspectorOf(input: InspectorInput): ElementNode {
  const { card, detail, featureDetail } = input;
  const id = str(card.id) ?? "?";
  const lane = str(card.lane) ?? "?";
  const phase = num(card.phase);
  const title = str(card.title);
  const head = phase !== null ? `Phase ${String(phase)}${title === null ? "" : ` — ${title}`}` : (title ?? id);
  return el(
    "aside",
    {
      class: "sskh-inspector",
      "data-kanban-detail": id,
      "data-lane": lane,
      role: "region",
      "aria-label": `detail of ${id}`,
      ...(input.onKeyDown ? { onKeyDown: input.onKeyDown } : {}),
    },
    el(
      "div",
      { class: "sskh-detail-bar" },
      el("h3", { class: "sskh-detail-title" }, head),
      el(
        "button",
        {
          class: "sskh-detail-close",
          "data-kanban-detail-close": "true",
          "aria-label": "close the detail",
          ...(input.onClose ? { onClick: input.onClose } : {}),
        },
        txt("×"),
      ),
    ),
    scopeSection(detail),
    liveSection(detail, featureDetail),
    attemptsSection(detail),
    launchesSection(featureDetail),
    costSection(featureDetail),
  );
}
