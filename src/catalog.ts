import type { Effort, Lane, Policy, RouterId } from "./types";

export type RouterSpec = {
  id: RouterId;
  label: string;
  short: string;
  modelId: string;
  effort: Effort | null;
  blurb: string;
  inputPerM: number;
  outputPerM: number;
  /** Modeled classify latency before length scaling. */
  baseMs: number;
  perCharMs: number;
  capMs: number;
  live: "anthropic" | "openrouter" | "local";
};

export const ROUTERS: Record<RouterId, RouterSpec> = {
  beat: {
    id: "beat",
    label: "Reflex",
    short: "On-device",
    modelId: "local-beat",
    effort: null,
    blurb: "Deterministic classifier in the page. The speed ceiling. No network.",
    inputPerM: 0,
    outputPerM: 0,
    baseMs: 0.8,
    perCharMs: 0.004,
    capMs: 4,
    live: "local",
  },
  haiku: {
    id: "haiku",
    label: "Haiku 4.5",
    short: "Fastest model",
    modelId: "claude-haiku-4-5",
    effort: null,
    blurb: "No effort knob. Built for classify-and-route. Cheapest Claude call.",
    inputPerM: 1,
    outputPerM: 5,
    baseMs: 170,
    perCharMs: 0.18,
    capMs: 520,
    live: "anthropic",
  },
  "opus-low": {
    id: "opus-low",
    label: "Opus 5.5 low",
    short: "Default bet",
    modelId: "claude-opus-5-5",
    effort: "low",
    blurb: "Flagship coder with effort pinned to low so the router stays short.",
    inputPerM: 4,
    outputPerM: 20,
    baseMs: 720,
    perCharMs: 0.4,
    capMs: 1600,
    live: "anthropic",
  },
  "fable-low": {
    id: "fable-low",
    label: "Fable 5.1 low",
    short: "Heavy classify",
    modelId: "claude-fable-5-1",
    effort: "low",
    blurb: "Frontier model asked to route, not to solve. Usually the wrong tool.",
    inputPerM: 10,
    outputPerM: 50,
    baseMs: 1600,
    perCharMs: 0.55,
    capMs: 3200,
    live: "anthropic",
  },
  jev: {
    id: "jev",
    label: "Jev",
    short: "System One",
    modelId: "typesafe/jev-1.13",
    effort: null,
    blurb: "Typed choice, score, and boolean. Output tokens are free. The bar to beat.",
    inputPerM: 0.042,
    outputPerM: 0,
    baseMs: 150,
    perCharMs: 0.09,
    capMs: 340,
    live: "openrouter",
  },
};

export const ROUTER_ORDER: RouterId[] = ["beat", "haiku", "opus-low", "fable-low", "jev"];

export type ExecModel = {
  id: string;
  label: string;
  lane: Lane;
  effort: Effort | null;
  inputPerM: number;
  outputPerM: number;
};

export const EXEC: Record<Exclude<Lane, "review"> | "review", ExecModel> = {
  fast: {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    lane: "fast",
    effort: null,
    inputPerM: 1,
    outputPerM: 5,
  },
  balanced: {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    lane: "balanced",
    effort: "low",
    inputPerM: 2,
    outputPerM: 10,
  },
  strong: {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    lane: "strong",
    effort: "medium",
    inputPerM: 4,
    outputPerM: 20,
  },
  frontier: {
    id: "claude-fable-5-1",
    label: "Fable 5.1",
    lane: "frontier",
    effort: "high",
    inputPerM: 10,
    outputPerM: 50,
  },
  review: {
    id: "human",
    label: "Human review",
    lane: "review",
    effort: null,
    inputPerM: 0,
    outputPerM: 0,
  },
};

/** Assumed downstream turn, same shape as the jev-model-router cost model. */
export const EXEC_INPUT_TOKENS = 8000;
export const EXEC_OUTPUT_TOKENS = 1200;

export const LANE_RANK: Record<Lane, number> = {
  fast: 0,
  balanced: 1,
  strong: 2,
  frontier: 3,
  review: 4,
};

export const LANE_LABEL: Record<Lane, string> = {
  fast: "Fast",
  balanced: "Balanced",
  strong: "Strong",
  frontier: "Frontier",
  review: "Review",
};

export const DEFAULT_POLICY: Policy = {
  floor: 0.75,
  allowFrontier: true,
  securityToReview: true,
  race: "beat",
  windowMs: 250,
  enabled: ["beat", "haiku", "opus-low", "fable-low", "jev"],
};

export function modeledLatency(id: RouterId, chars: number): number {
  const spec = ROUTERS[id];
  const ms = Math.min(spec.capMs, spec.baseMs + chars * spec.perCharMs);
  return Math.round(ms * 10) / 10;
}

export function modeledTokens(id: RouterId, chars: number): { input: number; output: number } {
  if (id === "beat") return { input: 0, output: 0 };
  const input = id === "jev" ? 280 + Math.round(chars / 3) : 360 + Math.round(chars / 4);
  const output = id === "jev" ? 0 : id === "fable-low" ? 160 : id === "opus-low" ? 110 : 80;
  return { input, output };
}

export function tokenCost(input: number, output: number, inputPerM: number, outputPerM: number): number {
  return (input / 1_000_000) * inputPerM + (output / 1_000_000) * outputPerM;
}

export function executionCost(lane: Lane): number {
  const model = EXEC[lane];
  return tokenCost(EXEC_INPUT_TOKENS, EXEC_OUTPUT_TOKENS, model.inputPerM, model.outputPerM);
}

/** Theo, DeepSWE, 20 tasks, 1 attempt. OpenRouter billed. Not measured here. */
export const DEEPSWE = [
  { id: "jev", label: "Jev Router", score: 16, cost: 1.5, minutes: 19.9 },
  { id: "astra-low", label: "GPT-6 Astra low", score: 16, cost: 1.46, minutes: 4.6 },
  { id: "astra-xhigh", label: "GPT-6 Astra xhigh", score: 17, cost: 4.42, minutes: 12.8 },
] as const;
