import { executionCost } from "./catalog";
import { runModeled } from "./policy";
import type { BenchCase, Lane, Policy, RouterId, RouterRun } from "./types";

export type Grade = "exact" | "under" | "over" | "abstain";

const RANK: Record<Lane, number> = {
  fast: 0,
  balanced: 1,
  strong: 2,
  frontier: 3,
  review: 4,
};

export function grade(gold: Lane, picked: Lane): Grade {
  if (gold === picked) return "exact";
  if (gold === "review" && picked !== "review") return "under";
  if (picked === "review" && gold !== "review") return "abstain";
  if (RANK[picked] < RANK[gold]) return "under";
  return "over";
}

export type RouterScore = {
  routerId: RouterId;
  exact: number;
  under: number;
  over: number;
  abstain: number;
  total: number;
  medianMs: number;
  meanRouterCost: number;
  meanRoutedCost: number;
  beatsJevExact: number;
  agreesJev: number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid] ?? 0;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function scoreSuite(cases: BenchCase[], policy: Policy, ids: RouterId[]): RouterScore[] {
  const byRouter = new Map<RouterId, RouterRun[]>();
  const jevLanes: Lane[] = [];
  for (const id of ids) byRouter.set(id, []);

  for (const item of cases) {
    for (const id of ids) {
      byRouter.get(id)?.push(runModeled(id, item.task, item.context, policy));
    }
  }

  const jevRuns = byRouter.get("jev") ?? [];
  for (const run of jevRuns) jevLanes.push(run.pick.lane);

  return ids.map((id) => {
    const runs = byRouter.get(id) ?? [];
    let exact = 0;
    let under = 0;
    let over = 0;
    let abstain = 0;
    let agreesJev = 0;
    let cost = 0;
    let routed = 0;
    runs.forEach((run, i) => {
      const item = cases[i];
      if (!item) return;
      const g = grade(item.gold, run.pick.lane);
      if (g === "exact") exact += 1;
      else if (g === "under") under += 1;
      else if (g === "over") over += 1;
      else abstain += 1;
      if (jevLanes[i] && run.pick.lane === jevLanes[i]) agreesJev += 1;
      cost += run.routerCostUsd;
      routed += run.routerCostUsd + executionCost(run.pick.lane);
    });
    const n = cases.length || 1;
    const jevExact = scoreExactOnly(cases, policy, "jev");
    return {
      routerId: id,
      exact,
      under,
      over,
      abstain,
      total: cases.length,
      medianMs: median(runs.map((r) => r.latencyMs)),
      meanRouterCost: cost / n,
      meanRoutedCost: routed / n,
      beatsJevExact: exact - jevExact,
      agreesJev,
    };
  });
}

function scoreExactOnly(cases: BenchCase[], policy: Policy, id: RouterId): number {
  return cases.reduce((n, item) => {
    const run = runModeled(id, item.task, item.context, policy);
    return n + (run.pick.lane === item.gold ? 1 : 0);
  }, 0);
}

export type CaseRow = {
  id: string;
  title: string;
  gold: Lane;
  lanes: Partial<Record<RouterId, Lane>>;
  grades: Partial<Record<RouterId, Grade>>;
};

export function caseRows(cases: BenchCase[], policy: Policy, ids: RouterId[]): CaseRow[] {
  return cases.map((item) => {
    const lanes: CaseRow["lanes"] = {};
    const grades: CaseRow["grades"] = {};
    for (const id of ids) {
      const run = runModeled(id, item.task, item.context, policy);
      lanes[id] = run.pick.lane;
      grades[id] = grade(item.gold, run.pick.lane);
    }
    return { id: item.id, title: item.title, gold: item.gold, lanes, grades };
  });
}
