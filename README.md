# claude-dev-router

Confident answers vote inside a short window. The most cautious one wins.

A coding-task router that races **Opus 5.5 low**, **Fable 5.1 low**, and **Haiku 4.5** against **Jev** (`typesafe/jev-1.13`). Policy stays in your code. The model only returns signals.

This is the routing core. The lab around it lets you swap routers, edit the floor, and bench 20 labeled dev tasks. It is not a DeepSWE rerun.

## Why

Theo's DeepSWE chart (20 tasks, 1 attempt, OpenRouter billed):

| | Score | Cost / task | Time / task |
| --- | --- | --- | --- |
| Jev Router | 16/20 | $1.50 | 19.9 min |
| GPT-6 Astra low | 16/20 | $1.46 | 4.6 min |
| GPT-6 Astra xhigh | 17/20 | $4.42 | 12.8 min |

Jev Router tied Astra low and took about four times as long. This repo asks a narrower question: can a low-effort Claude classify call pick the lane faster than Jev, without under-routing the dangerous tasks?

## Race

Entrants:

| Id | Call | Effort |
| --- | --- | --- |
| `beat` | Reflex, on-device | none |
| `haiku` | `claude-haiku-4-5` | none (Haiku has no effort parameter) |
| `opus-low` | `claude-opus-5-5` | `low` |
| `fable-low` | `claude-fable-5-1` | `low` |
| `jev` | `typesafe/jev-1.13` via OpenRouter decisions | n/a |

`decideRace` runs the race:

1. Every enabled router answers. An answer is **confident** when it clears the floor (default 0.75). A confident "review" counts. It is a decision, not a non-answer.
2. The first confident answer opens a window of `windowMs` (default 250 ms).
3. Every confident answer inside the window votes. The **most cautious lane wins**: Review, then Frontier, Strong, Balanced, Fast.
4. If nothing clears the floor, the task goes to Review.

A fast answer never beats a more cautious one by arriving first. Low confidence never keeps a Fast lane, and a shaky Frontier call drops to Strong.

`race: "all"` waits for every router. `pickBeat` is kept as a deprecated wrapper that returns the winning run.

## Lanes

| Lane | Executes |
| --- | --- |
| Fast | Haiku 4.5 |
| Balanced | Sonnet 5, effort low |
| Strong | Opus 5.5, effort medium |
| Frontier | Fable 5.1, effort high |
| Review | Human |

## Modeled bench

`src/judge.ts` is a deterministic stand-in so the lab works with no key. Opus low tracks the base judge. Haiku flattens cross-module scope and soft harm. Fable low escalates depth. Jev holds the frontier cutoff on design-scale tasks. Reflex is the same judge with a lower ceiling when cues mix.

On the 20 hand-labeled tasks in `src/suite.ts`, `npm run bench` prints:

| Router | Exact | Under | Over | Median decision |
| --- | --- | --- | --- | --- |
| Reflex | 18/20 | 2 | 0 | ~1 ms |
| Haiku 4.5 | 16/20 | 4 | 0 | ~190 ms |
| Opus 5.5 low | 20/20 | 0 | 0 | ~760 ms |
| Fable 5.1 low | 14/20 | 0 | 6 | ~1.7 s |
| Jev | 18/20 | 2 | 0 | ~160 ms |
| **Race (250 ms window)** | **18/20** | **2** | **0** | ~410 ms |

The race is what a caller receives, so it is the row that matters. Both remaining misses send a Frontier design task to Strong (Opus 5.5 medium). No task that needs human review is under-routed.

Window size is the speed and depth trade-off:

| Window | Exact | Under | Over | Median decision |
| --- | --- | --- | --- | --- |
| 0 ms | 18/20 | 2 | 0 | ~160 ms |
| 250 ms (default) | 18/20 | 2 | 0 | ~410 ms |
| 800 ms | 20/20 | 0 | 0 | ~960 ms |
| All routers | 14/20 | 0 | 6 | ~1.7 s |

Waiting for every router over-routes: Fable low escalates depth, and the most cautious vote wins. An 800 ms window catches Opus low and gets the Frontier cases right.

None of these numbers is a live model measurement. Every router shares one deterministic base judge in `src/judge.ts`, which matches phrases from the suite, so the bench shows how the policy and race behave, not how the models compare. Use a real Anthropic key and an OpenRouter key before quoting them.

## Live

Claude: `POST https://api.anthropic.com/v1/messages` with `output_config.effort = "low"` on Opus 5.5 and Fable 5.1. Omit effort for Haiku.

Jev: `POST https://openrouter.ai/api/alpha/decisions` model `typesafe/jev-1.13`, one choice, one score, one boolean.

Prices used for estimates, per million tokens: Haiku $1/$5, Sonnet 5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 $10/$50, Jev about $0.042 input and free output.

A route is not permission to edit production, spend budget, or skip review.
