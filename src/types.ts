export type TaskKind =
  | "mechanical"
  | "bounded"
  | "cross_cutting"
  | "security_or_data"
  | "unclear";

export type Depth = "shallow" | "moderate" | "deep";

export type Lane = "fast" | "balanced" | "strong" | "frontier" | "review";

export type RouterId = "beat" | "haiku" | "opus-low" | "fable-low" | "jev";

export type Effort = "low" | "medium" | "high" | "xhigh";

export type Signals = {
  taskKind: TaskKind;
  reasoningDepth: Depth;
  highConsequence: boolean;
  confidence: number;
  why: string;
};

export type Policy = {
  floor: number;
  allowFrontier: boolean;
  securityToReview: boolean;
  /** "beat": decide once the window after the first confident answer closes. "all": wait for every router. */
  race: "beat" | "all";
  /** How long the race keeps listening after the first confident answer, in ms. */
  windowMs: number;
  enabled: RouterId[];
};

export type ExecPick = {
  lane: Lane;
  modelId: string;
  modelLabel: string;
  effort: Effort | null;
};

export type RouterRun = {
  routerId: RouterId;
  source: "modeled" | "live";
  signals: Signals;
  pick: ExecPick;
  latencyMs: number;
  routerCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cleared: boolean;
  error?: string;
};

export type BenchCase = {
  id: string;
  title: string;
  task: string;
  context: string;
  gold: Lane;
  note: string;
};
