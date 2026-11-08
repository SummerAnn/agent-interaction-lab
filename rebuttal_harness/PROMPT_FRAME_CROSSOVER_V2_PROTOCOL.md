# Prompt-frame crossover v2

## Why v2 is separate

The stopped v1 batch used a 384-token output limit. Two completed live-discussion runs reached that limit repeatedly:

- order 13, no repeating agents, live debate: 7 capped replies;
- order 18, causal explanation, live debate: 8 capped replies.

Several replies ended inside the final JSON object. The v1 output is therefore not used for results. V2 has new study ids, run ids, manifests, and output directories. Every v2 arm uses the same 1,024-token output limit.

## Frozen full study

- Study id: `prompt_frame_crossover_v2`
- 2 ways of showing earlier answers × 2 instruction sets × 2 source conditions
- 24 balanced speaking orders per arm
- 192 runs, 36 model calls per run, 6,912 calls total
- Claude Haiku 4.5, temperature 0
- Same order pairing and shuffled schedule as v1

The audit requires complete final JSON, exact agreement between the production parser and stored judgment, no reply at the token limit, exact source messages, protocol-specific visibility, exact first-turn request matching, identity-matched no-source baselines, source-adjusted protocol effects, and the protocol × instructions × source interaction.

## Stress smoke

- Study id: `prompt_frame_crossover_smoke_v2`
- All eight order-01 cells
- All four live-discussion cells for order 13
- All four live-discussion cells for order 18
- 16 runs and 576 model calls

Orders 13 and 18 are included because those were the known v1 cap failures. The smoke audit also requires the late-round live-debate calls to reach the full 33-message visible history.

## Commands

Generate and audit the frozen plans without making model calls:

```bash
/opt/homebrew/bin/node scripts/generate-prompt-frame-crossover-v2.mjs
/opt/homebrew/bin/node scripts/generate-prompt-frame-crossover-smoke-v2.mjs
/opt/homebrew/bin/node analysis/audit-prompt-frame-crossover-v2.mjs
/opt/homebrew/bin/node analysis/audit-prompt-frame-crossover-smoke-v2.mjs
```

Run and audit the stress smoke:

```bash
EXPERIMENT_CONCURRENCY=4 /opt/homebrew/bin/node --import tsx scripts/run-prompt-frame-crossover-smoke-v2.mjs
/opt/homebrew/bin/node analysis/audit-prompt-frame-crossover-smoke-v2.mjs
```

Only after the stress smoke passes, run and audit the full study:

```bash
EXPERIMENT_CONCURRENCY=4 /opt/homebrew/bin/node --import tsx scripts/run-prompt-frame-crossover-v2.mjs
/opt/homebrew/bin/node analysis/audit-prompt-frame-crossover-v2.mjs
```

Both runners resume from completed summaries in their own v2 output directory.
