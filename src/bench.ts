import { DEFAULT_POLICY, LANE_LABEL, ROUTERS, ROUTER_ORDER } from "./catalog";
import { caseRows, scoreRace, scoreSuite, type RouterScore } from "./score";
import { SUITE } from "./suite";
import type { Policy } from "./types";

/**
 * Prints the modeled bench as markdown. Every number comes from src/judge.ts,
 * which is a deterministic stand-in, not a live model call.
 *
 *   npm run bench
 */

const policy: Policy = DEFAULT_POLICY;

function row(s: RouterScore): string {
  const label = s.routerId === "race" ? "**Race**" : ROUTERS[s.routerId].label;
  const ms = s.medianMs < 10 ? `${s.medianMs.toFixed(1)} ms` : `${Math.round(s.medianMs)} ms`;
  return `| ${label} | ${s.exact}/${s.total} | ${s.under} | ${s.over} | ${s.abstain} | ${ms} |`;
}

const out: string[] = [];
out.push(`Policy: floor ${policy.floor}, window ${policy.windowMs} ms, race "${policy.race}".`, "");
out.push("| Router | Exact | Under | Over | Abstain | Median decision |");
out.push("| --- | --- | --- | --- | --- | --- |");
for (const s of scoreSuite(SUITE, policy, ROUTER_ORDER)) out.push(row(s));
out.push(row(scoreRace(SUITE, policy, ROUTER_ORDER)));

out.push("", "Race by window size:", "");
out.push("| Window | Exact | Under | Over | Abstain | Median decision |");
out.push("| --- | --- | --- | --- | --- | --- |");
const windows: Array<[string, Policy]> = [
  ["0 ms (fastest confident)", { ...policy, windowMs: 0 }],
  ["100 ms", { ...policy, windowMs: 100 }],
  ["250 ms (default)", { ...policy, windowMs: 250 }],
  ["800 ms", { ...policy, windowMs: 800 }],
  ["all routers", { ...policy, race: "all" }],
];
for (const [name, p] of windows) {
  const s = scoreRace(SUITE, p, ROUTER_ORDER);
  const ms = s.medianMs < 10 ? `${s.medianMs.toFixed(1)} ms` : `${Math.round(s.medianMs)} ms`;
  out.push(`| ${name} | ${s.exact}/${s.total} | ${s.under} | ${s.over} | ${s.abstain} | ${ms} |`);
}

out.push("", "Race per case (default policy):", "");
out.push("| Case | Gold | Race | Grade | Voted inside window |");
out.push("| --- | --- | --- | --- | --- |");
for (const r of caseRows(SUITE, policy, ROUTER_ORDER)) {
  out.push(
    `| ${r.id} | ${LANE_LABEL[r.gold]} | ${LANE_LABEL[r.race]} | ${r.raceGrade} | ${r.raceConsidered.join(", ") || "none"} |`,
  );
}

console.log(out.join("\n"));
