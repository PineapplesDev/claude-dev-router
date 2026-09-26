# claude-dev-router

Fastest confident call wins.

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

`pickBeat` keeps the earliest result that clears the confidence floor and is not a human review. A faster reply that misses the floor does not win. Low confidence never keeps a Fast lane, and a shaky Frontier call drops to Strong.

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

On the 20 hand-labeled tasks in `src/suite.ts`, that produces roughly:

| Router | Exact | Under | Over | Median hop |
| --- | --- | --- | --- | --- |
| Reflex | 18/20 | 2 | 0 | ~1 ms |
| Haiku 4.5 | 16/20 | 4 | 0 | ~190 ms |
| Opus 5.5 low | 20/20 | 0 | 0 | ~760 ms |
| Fable 5.1 low | 14/20 | 0 | 6 | ~1.7 s |
| Jev | 18/20 | 2 | 0 | ~160 ms |

Those Opus and Jev exact-counts are **not** a live model measurement. They share a base judge. Use a real Anthropic key and an OpenRouter key before quoting them.

## Live

Claude: `POST https://api.anthropic.com/v1/messages` with `output_config.effort = "low"` on Opus 5.5 and Fable 5.1. Omit effort for Haiku.

Jev: `POST https://openrouter.ai/api/alpha/decisions` model `typesafe/jev-1.13`, one choice, one score, one boolean.

Prices used for estimates, per million tokens: Haiku $1/$5, Sonnet 5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 $10/$50, Jev about $0.042 input and free output.

A route is not permission to edit production, spend budget, or skip review.
