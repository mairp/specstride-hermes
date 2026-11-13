/**
 * The lane rules of the workspace reader (T025; F151-FR-038, F151-FR-049).
 * This file is the ONLY place a lane is assigned: the ordered rules W0–W4
 * of the closed set `kanban-reader-lane-rules`, first match wins, rule id
 * `W-<lane>`. The end lane itself comes from the closed end rules (§5,
 * `endLaneOf`); a never-started feature gets one card, not one per phase.
 */
import { closedSetLaneRules, closedSetLiveLanes } from "../generated/closed-sets.ts";
import type { RunFacts } from "./events.ts";
import type { EndInfo } from "./launches.ts";
import { STALE_AFTER_MS, isoMs, type RunRecord } from "./runs.ts";

/** One row of the ordered rule table (the closed set, in order). */
export interface LaneRuleRow {
  rule: "W0" | "W1" | "W2" | "W3" | "W4";
  when: string;
  lane: string;
}

/** The ordered lane rules, verbatim from the generated closed set. */
export const LANE_RULES: readonly LaneRuleRow[] = Object.freeze(
  (closedSetLaneRules.members as { rule: LaneRuleRow["rule"]; when: string; lane: string }[]).map((member) => ({
    rule: member.rule,
    when: member.when,
    lane: member.lane,
  })),
);

/** The live lane of an activity NAME; an unknown name reads as proposing. */
export function liveLaneOf(activity: string | null): string {
  const name = activity ?? "proposing";
  return (closedSetLiveLanes.members as readonly string[]).includes(name) ? name : ((closedSetLiveLanes as { unknown: string }).unknown ?? "proposing");
}

/** The end lane of a recorded outcome (E0's rows; unknown → failed). */
export function endRuleLane(outcome: string | null): string | null {
  if (outcome === "blocked") return "blocked";
  if (outcome === "stopped") return "paused";
  if (outcome === "approved") return null;
  return "failed";
}

/** A minimal phase the rules read (ParsedPhase of tasks-md.ts). */
export interface LanePhase {
  number: number;
  title: string;
  tasks: { done: boolean }[];
}

/** One card of the view (data-model.md ReaderCard). */
export interface ReaderCard {
  id: string;
  lane: string;
  title: string;
  ruleId: string;
  flags: { dead: false; stale: boolean; yielded: boolean };
}

/** The inputs one feature's lane decision reads. */
export interface LaneContext {
  chosenRun: RunRecord | null;
  facts: RunFacts;
  end: EndInfo;
  /** Non-voided approval records of the feature, by phase. */
  approvals: ReadonlySet<number>;
  /** Gate approvals of the feature, by phase (`GATE<n>-APPROVED`). */
  gates: ReadonlySet<number>;
  nowMs: number;
}

/** Rule W0: nothing has started the feature — one card, not one per phase. */
function nothingStarted(ctx: LaneContext, phases: readonly LanePhase[]): boolean {
  if (ctx.chosenRun !== null) return false;
  if (ctx.approvals.size > 0 || ctx.gates.size > 0) return false;
  if (phases.some((phase) => phase.tasks.some((task) => task.done))) return false;
  if (ctx.facts.currentPhase !== null) return false;
  return true;
}

/** Rule W2: this phase is approved by any of its five signs. */
function phaseApproved(phase: LanePhase, ctx: LaneContext, run: RunRecord | null): boolean {
  if (ctx.end.ended && ctx.facts.outcome === "all_approved") return true;
  if (ctx.approvals.has(phase.number)) return true;
  if (ctx.gates.has(phase.number)) return true;
  if (run !== null && run.events.some((event) => event.type === "phase.ended" && event.fields.phase === phase.number && event.fields.outcome === "approved")) return true;
  if (phase.tasks.length > 0 && phase.tasks.every((task) => task.done)) return true;
  return false;
}

/**
 * The cards of one feature, in phase order. The rules are evaluated in the
 * order of LANE_RULES; a rule whose lane cannot be resolved (W3 with a
 * clean exit: no end lane) falls through to the next rule.
 */
export function featureCards(feature: string, phases: readonly LanePhase[], ctx: LaneContext): ReaderCard[] {
  if (nothingStarted(ctx, phases)) {
    return [
      {
        id: `${feature}#queued`,
        lane: "queued",
        title: `not started (${phases.length} phases)`,
        ruleId: "W-queued",
        flags: { dead: false, stale: false, yielded: false },
      },
    ];
  }
  const cards: ReaderCard[] = [];
  for (const phase of phases) {
    let lane: string | null = null;
    let rule: LaneRuleRow["rule"] = "W4";
    for (const row of LANE_RULES) {
      if (row.rule === "W0") continue; // handled above, per feature
      if (row.rule === "W1") {
        if (ctx.chosenRun !== null && !ctx.end.ended && ctx.facts.currentPhase === phase.number) {
          lane = liveLaneOf(ctx.facts.activity);
          rule = "W1";
          break;
        }
        continue;
      }
      if (row.rule === "W2") {
        if (phaseApproved(phase, ctx, ctx.chosenRun)) {
          lane = "approved";
          rule = "W2";
          break;
        }
        continue;
      }
      if (row.rule === "W3") {
        if (ctx.end.ended && ctx.facts.currentPhase === phase.number && ctx.end.endLane !== null) {
          lane = ctx.end.endLane;
          rule = "W3";
          break;
        }
        continue;
      }
      // W4
      lane = "queued";
      rule = "W4";
      break;
    }
    const stale = rule === "W1" && ctx.chosenRun !== null && (function () {
      const lastAtMs = isoMs(ctx.chosenRun?.lastAt ?? null);
      return lastAtMs !== null && ctx.nowMs - lastAtMs > STALE_AFTER_MS;
    })();
    cards.push({
      id: `${feature}#${phase.number}`,
      lane: lane ?? "queued",
      title: phase.title,
      ruleId: `W-${lane ?? "queued"}`,
      flags: { dead: false, stale, yielded: (lane ?? "queued") === "paused" },
    });
  }
  return cards;
}

/** One attention item of the view (data-model.md AttentionItem). */
export interface AttentionItem {
  kind: string;
  key: string;
  oneLine: string;
  need: string;
  next: string;
  since: string | null;
}

/** Cap of the one-line summary, in bytes. */
export const ONE_LINE_BYTES = 240;

/**
 * The one attention item a feature may raise: its run ended by the
 * outside world with a card on `failed` or `blocked`. One per feature,
 * never more; the one-line names no path and no pid.
 */
export function attentionOf(feature: string, cards: readonly ReaderCard[], ctx: LaneContext): AttentionItem | null {
  if (!ctx.end.ended) return null;
  const lane = ctx.end.endLane;
  if (lane !== "failed" && lane !== "blocked") return null;
  if (!cards.some((card) => card.lane === lane)) return null;
  const phase = ctx.facts.currentPhase;
  const title = phase !== null ? (cards.find((card) => card.id === `${feature}#${phase}`)?.title ?? null) : null;
  const where = phase !== null ? `phase ${phase}${title !== null ? ` (${title})` : ""}` : "the run";
  let oneLine = `${feature}: run ended ${lane} in ${where}`;
  if (ctx.end.why !== null) oneLine += ` — ${ctx.end.why}`;
  while (Buffer.byteLength(oneLine, "utf8") > ONE_LINE_BYTES) oneLine = oneLine.slice(0, -1);
  return {
    kind: "blocked-on-human",
    key: `${feature}#run`,
    oneLine,
    need: "read the run log, fix the cause, then relaunch",
    next: "relaunch",
    since: ctx.chosenRun?.lastAt ?? null,
  };
}
