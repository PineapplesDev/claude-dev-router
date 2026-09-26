import { EXEC, ROUTERS, modeledLatency, modeledTokens, tokenCost } from "./catalog";
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
    cleared: !error && signals.confidence >= policy.floor && lane !== "review",
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

export function pickBeat(runs: RouterRun[], policy: Policy): RouterRun | null {
  const enabled = runs.filter((r) => policy.enabled.includes(r.routerId) && !r.error);
  if (policy.race === "all") return null;
  const cleared = enabled
    .filter((r) => r.cleared)
    .sort((a, b) => a.latencyMs - b.latencyMs || a.routerCostUsd - b.routerCostUsd);
  return cleared[0] ?? null;
}

export function fastestAny(runs: RouterRun[]): RouterRun | null {
  const ok = runs.filter((r) => !r.error);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => a.latencyMs - b.latencyMs)[0] ?? null;
}
