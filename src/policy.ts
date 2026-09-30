import { EXEC, LANE_RANK, ROUTERS, modeledLatency, modeledTokens, tokenCost } from "./catalog";
import { signalsFor } from "./judge";
import type { ExecPick, Lane, Policy, RouterId, RouterRun, Signals } from "./types";

export function laneFromSignals(signals: Signals, policy: Policy): Lane {
  const { taskKind, reasoningDepth, highConsequence } = signals;

  if (taskKind === "unclear") return "review";

  if (taskKind === "security_or_data") {
    if (policy.securityToReview && (highConsequence || signals.confidence >= policy.floor)) {
      return highConsequence ? "review" : "strong";
    }
    return highConsequence ? "review" : "strong";
  }

  if (taskKind === "mechanical" && reasoningDepth !== "deep" && !highConsequence) {
    return reasoningDepth === "shallow" ? "fast" : "balanced";
  }

  if (taskKind === "bounded") {
    if (reasoningDepth === "deep") return "strong";
    return "balanced";
  }

  if (taskKind === "cross_cutting") {
    if (reasoningDepth === "deep" && policy.allowFrontier) return "frontier";
    return "strong";
  }

  return "balanced";
}

export function applyPolicy(signals: Signals, policy: Policy): Lane {
  let lane = laneFromSignals(signals, policy);
  const shaky = signals.confidence < policy.floor;

  if (shaky) {
    if (
      signals.highConsequence ||
      signals.taskKind === "unclear" ||
      signals.taskKind === "security_or_data"
    ) {
      lane = "review";
    } else if (lane === "fast") {
      lane = "balanced";
    } else if (lane === "frontier") {
      lane = "strong";
    }
  }

  if (!policy.allowFrontier && lane === "frontier") lane = "strong";
  return lane;
}

export function toPick(lane: Lane): ExecPick {
  const model = EXEC[lane];
  return {
    lane,
    modelId: model.id,
    modelLabel: model.label,
    effort: model.effort,
  };
}

export function runFromSignals(
  id: RouterId,
  source: RouterRun["source"],
  signals: Signals,
  policy: Policy,
  latencyMs: number,
  routerCostUsd: number,
  inputTokens: number,
  outputTokens: number,
  error?: string,
): RouterRun {
  const lane = error ? "review" : applyPolicy(signals, policy);
  return {
    routerId: id,
    source,
    signals,
    pick: toPick(lane),
    latencyMs,
    routerCostUsd,
    inputTokens,
    outputTokens,
    // A confident "review" is a decision, not a non-answer, so it clears too.
    cleared: !error && signals.confidence >= policy.floor,
    error,
  };
}

export function runModeled(id: RouterId, task: string, context: string, policy: Policy): RouterRun {
  const signals = signalsFor(id, task, context);
  const chars = task.length + context.length;
  const tokens = modeledTokens(id, chars);
  const spec = ROUTERS[id];
  return runFromSignals(
    id,
    "modeled",
    signals,
    policy,
    modeledLatency(id, chars),
    tokenCost(tokens.input, tokens.output, spec.inputPerM, spec.outputPerM),
    tokens.input,
    tokens.output,
  );
}

export type RaceDecision = {
  lane: Lane;
  /** The run whose lane was taken. Null when nothing cleared and the race fell back to review. */
  run: RouterRun | null;
  /** When the race stopped listening, in modeled ms. */
  decidedAtMs: number;
  /** Routers that answered confidently inside the window. */
  considered: RouterId[];
  reason: string;
};

/**
 * Cautious race. The first confident answer opens a window of `policy.windowMs`.
 * Every confident answer that lands inside the window gets a vote, and the most
 * cautious lane wins (review > frontier > strong > balanced > fast). A faster
 * answer never beats a more cautious one just by arriving first.
 *
 * `race: "all"` waits for every enabled router. If nothing clears the floor,
 * the task goes to review.
 */
export function decideRace(runs: RouterRun[], policy: Policy): RaceDecision {
  const live = runs.filter((r) => policy.enabled.includes(r.routerId) && !r.error);
  const lastArrival = live.reduce((max, r) => Math.max(max, r.latencyMs), 0);
  const cleared = live
    .filter((r) => r.cleared)
    .sort((a, b) => a.latencyMs - b.latencyMs || a.routerCostUsd - b.routerCostUsd);

  const first = cleared[0];
  if (!first) {
    return {
      lane: "review",
      run: null,
      decidedAtMs: lastArrival,
      considered: [],
      reason: "No router cleared the confidence floor. Hold for a human.",
    };
  }

  const close = policy.race === "all" ? Number.POSITIVE_INFINITY : first.latencyMs + policy.windowMs;
  const inWindow = cleared.filter((r) => r.latencyMs <= close);
  // Strict ">" keeps the earlier arrival when two runs pick the same lane.
  const winner = inWindow.reduce((best, r) =>
    LANE_RANK[r.pick.lane] > LANE_RANK[best.pick.lane] ? r : best,
  );

  return {
    lane: winner.pick.lane,
    run: winner,
    decidedAtMs: Math.min(close, lastArrival),
    considered: inWindow.map((r) => r.routerId),
    reason:
      inWindow.length > 1
        ? `Most cautious of ${inWindow.length} confident answers inside the window.`
        : "Only confident answer inside the window.",
  };
}

/** @deprecated Use decideRace. Kept so existing callers still compile. Returns the winning run, or null when the race fell back to review. */
export function pickBeat(runs: RouterRun[], policy: Policy): RouterRun | null {
  return decideRace(runs, policy).run;
}

export function fastestAny(runs: RouterRun[]): RouterRun | null {
  const ok = runs.filter((r) => !r.error);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => a.latencyMs - b.latencyMs)[0] ?? null;
}
