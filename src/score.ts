import { executionCost } from "./catalog";
import { decideRace, runModeled } from "./policy";
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
  /** "race" is the combined decision from decideRace, not a single model. */
  routerId: RouterId | "race";
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
  const jevExact = jevLanes.filter((lane, i) => lane === cases[i]?.gold).length;

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

/**
 * Scores the combined race, which is what a caller actually receives.
 * Every router runs on every case; decideRace picks the lane.
 */
export function scoreRace(cases: BenchCase[], policy: Policy, ids: RouterId[]): RouterScore {
  let exact = 0;
  let under = 0;
  let over = 0;
  let abstain = 0;
  let agreesJev = 0;
  let jevExact = 0;
  let cost = 0;
  let routed = 0;
  const times: number[] = [];

  for (const item of cases) {
    const runs = ids.map((id) => runModeled(id, item.task, item.context, policy));
    const decision = decideRace(runs, policy);
    const g = grade(item.gold, decision.lane);
    if (g === "exact") exact += 1;
    else if (g === "under") under += 1;
    else if (g === "over") over += 1;
    else abstain += 1;

    const jev = runs.find((r) => r.routerId === "jev");
    if (jev && jev.pick.lane === decision.lane) agreesJev += 1;
    if (jev && jev.pick.lane === item.gold) jevExact += 1;

    // Every enabled router is called, so the race pays for all of them.
    const racePaid = runs
      .filter((r) => policy.enabled.includes(r.routerId))
      .reduce((sum, r) => sum + r.routerCostUsd, 0);
    cost += racePaid;
    routed += racePaid + executionCost(decision.lane);
    times.push(decision.decidedAtMs);
  }

  const n = cases.length || 1;
  return {
    routerId: "race",
    exact,
    under,
    over,
    abstain,
    total: cases.length,
    medianMs: median(times),
    meanRouterCost: cost / n,
    meanRoutedCost: routed / n,
    beatsJevExact: exact - jevExact,
    agreesJev,
  };
}

export type CaseRow = {
  id: string;
  title: string;
  gold: Lane;
  lanes: Partial<Record<RouterId, Lane>>;
  grades: Partial<Record<RouterId, Grade>>;
  race: Lane;
  raceGrade: Grade;
  /** Routers whose confident answers were inside the race window. */
  raceConsidered: RouterId[];
};

export function caseRows(cases: BenchCase[], policy: Policy, ids: RouterId[]): CaseRow[] {
  return cases.map((item) => {
    const lanes: CaseRow["lanes"] = {};
    const grades: CaseRow["grades"] = {};
    const runs = ids.map((id) => runModeled(id, item.task, item.context, policy));
    for (const run of runs) {
      lanes[run.routerId] = run.pick.lane;
      grades[run.routerId] = grade(item.gold, run.pick.lane);
    }
    const decision = decideRace(runs, policy);
    return {
      id: item.id,
      title: item.title,
      gold: item.gold,
      lanes,
      grades,
      race: decision.lane,
      raceGrade: grade(item.gold, decision.lane),
      raceConsidered: decision.considered,
    };
  });
}
