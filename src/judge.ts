import type { Depth, RouterId, Signals, TaskKind } from "./types";

type Features = {
  mechanical: number;
  bounded: number;
  cross: number;
  security: number;
  deep: number;
  consequence: number;
  vague: boolean;
  chars: number;
};

function count(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
}

export function featuresOf(task: string, context: string): Features {
  const text = `${task}\n${context}`.toLowerCase();
  const vague =
    text.trim().length < 48 &&
    !/typo|test|endpoint|rename|stripe|credential|index|reducer|footer/.test(text);
  return {
    mechanical: count(text, [
      /\btypo\b/,
      /misspell/,
      /button label/,
      /copyright year/,
      /footer/,
      /pr description/,
      /button color/,
      /do not change it/,
      /don't change it/,
    ]),
    bounded: count(text, [
      /one component/,
      /unit test/,
      /only that route/,
      /client only/,
      /one hook/,
      /three forms/,
      /no behavior change/,
      /40-line/,
      /existing test/,
    ]),
    cross: count(text, [
      /across the/,
      /public api/,
      /\bsdk\b/,
      /internal services/,
      /monolith/,
      /own service/,
      /four services/,
      /dual-write/,
      /schema migration/,
    ]),
    security: count(text, [
      /credential/,
      /webhook/,
      /stripe/,
      /invoice paid/,
      /delete all/,
      /retention/,
      /maintenance window/,
      /production database/,
      /rotate the production/,
    ]),
    deep: count(text, [
      /nobody knows/,
      /find the race/,
      /flaky/,
      /migration plan/,
      /rollback/,
      /backfill/,
      /root cause/,
      /in parallel/,
    ]),
    consequence: count(text, [
      /credential/,
      /delete all/,
      /retention/,
      /invoice paid/,
      /maintenance window/,
      /mark unpaid/,
      /rotate the production/,
      /production users/,
      /could mark/,
    ]),
    vague,
    chars: text.length,
  };
}

function kindOf(f: Features): TaskKind {
  if (f.vague && f.mechanical === 0 && f.security === 0 && f.cross === 0) return "unclear";
  if (f.security > 0 && f.security >= f.cross) return "security_or_data";
  if (f.cross >= 1 && f.mechanical === 0) return "cross_cutting";
  if (f.mechanical > 0 && f.cross === 0 && f.security === 0 && f.deep === 0) return "mechanical";
  if (f.deep > 0 && f.bounded === 0 && f.cross === 0 && f.security === 0) return "bounded";
  if (f.bounded > 0 || f.mechanical > 0) return f.cross > 0 ? "cross_cutting" : "bounded";
  if (f.chars < 80) return "unclear";
  return "bounded";
}

function depthOf(f: Features, kind: TaskKind): Depth {
  if (kind === "mechanical") return "shallow";
  if (kind === "unclear") return "shallow";
  if (f.deep >= 2 || (kind === "cross_cutting" && f.deep >= 1)) return "deep";
  if (f.deep >= 1) return "deep";
  if (kind === "security_or_data") return "moderate";
  if (kind === "cross_cutting") return "moderate";
  return "moderate";
}

function confidenceOf(f: Features, kind: TaskKind): number {
  if (kind === "unclear") return 0.41;
  const competing = [f.mechanical, f.bounded, f.cross, f.security].filter((n) => n > 0).length;
  if (competing >= 3) return 0.64;
  if (kind === "mechanical") return 0.94;
  if (kind === "security_or_data" && f.consequence > 0) return 0.9;
  if (competing === 2) return 0.8;
  return 0.87;
}

function whyOf(kind: TaskKind, depth: Depth, harm: boolean): string {
  const harmBit = harm ? " Wrong result is hard to undo." : " Blast radius looks contained.";
  if (kind === "mechanical") return `Tiny deterministic edit. Shallow check is enough.${harmBit}`;
  if (kind === "unclear") return "Not enough scope to pick a model. Hold for a human.";
  if (kind === "security_or_data")
    return `Touches secrets, money, or production data.${harmBit}`;
  if (kind === "cross_cutting")
    return `Work crosses an API or service boundary. Depth ${depth}.${harmBit}`;
  if (depth === "deep") return `Localized, but the cause or design is not obvious.${harmBit}`;
  return `Bounded change with a clear edge. Depth ${depth}.${harmBit}`;
}

export function judge(task: string, context: string): Signals {
  const f = featuresOf(task, context);
  const taskKind = kindOf(f);
  const reasoningDepth = depthOf(f, taskKind);
  const highConsequence = f.consequence > 0 || (taskKind === "security_or_data" && f.security >= 2);
  return {
    taskKind,
    reasoningDepth,
    highConsequence,
    confidence: confidenceOf(f, taskKind),
    why: whyOf(taskKind, reasoningDepth, highConsequence),
  };
}

function bumpDepth(d: Depth): Depth {
  if (d === "shallow") return "moderate";
  if (d === "moderate") return "deep";
  return "deep";
}

/** Stable, explainable bias per router. Opus low tracks the base judge. */
export function signalsFor(id: RouterId, task: string, context: string): Signals {
  const base = judge(task, context);
  const f = featuresOf(task, context);

  if (id === "opus-low") {
    return { ...base, confidence: Math.min(0.96, base.confidence + 0.02) };
  }

  if (id === "jev") {
    const conservative = /design the|do not run|migration plan/i.test(task);
    const confidence =
      base.taskKind === "unclear" ? 0.46 : conservative ? 0.71 : Math.min(0.97, base.confidence + 0.03);
    return {
      ...base,
      confidence,
      why: conservative
        ? "Jev stayed conservative on a design-scale change and missed the frontier cutoff."
        : `Jev signals: ${base.taskKind}, ${base.reasoningDepth}, harm ${base.highConsequence ? "yes" : "no"}.`,
    };
  }

  if (id === "haiku") {
    let taskKind = base.taskKind;
    let reasoningDepth = base.reasoningDepth;
    let highConsequence = base.highConsequence;
    if (taskKind === "cross_cutting" && f.cross < 3) taskKind = "bounded";
    if (reasoningDepth === "deep" && f.deep < 2) reasoningDepth = "moderate";
    if (highConsequence && f.consequence < 2) highConsequence = false;
    if (taskKind === "unclear" && f.chars > 20) {
      taskKind = "bounded";
      reasoningDepth = "shallow";
    }
    const confidence = Math.max(0.42, base.confidence * 0.9);
    return {
      taskKind,
      reasoningDepth,
      highConsequence,
      confidence,
      why: "Haiku kept the short read. Subtle harm and cross-module scope get flattened.",
    };
  }

  if (id === "fable-low") {
    const reasoningDepth = base.taskKind === "mechanical" ? base.reasoningDepth : bumpDepth(base.reasoningDepth);
    let taskKind = base.taskKind;
    if (taskKind === "bounded" && reasoningDepth === "deep" && f.cross > 0) taskKind = "cross_cutting";
    return {
      taskKind,
      reasoningDepth,
      highConsequence: base.highConsequence || f.security > 0,
      confidence: Math.max(base.confidence, 0.88),
      why: "Fable low still escalates depth. It would rather over-route than miss.",
    };
  }

  const mixed = [f.mechanical, f.cross, f.security, f.deep].filter((n) => n > 0).length >= 2;
  let confidence = base.confidence * 0.84;
  if (mixed) confidence *= 0.78;
  if (base.taskKind === "unclear") confidence = 0.38;
  return {
    ...base,
    confidence: Math.round(confidence * 100) / 100,
    why: mixed
      ? "Reflex sees mixed cues and will not clear the floor."
      : "On-device rules matched a clean pattern.",
  };
}
