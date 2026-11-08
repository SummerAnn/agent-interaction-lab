# Fixed-explanation batch divergence audit

This is a descriptive audit of the six Haiku shared-memory batches behind the paper's 139--185/240 range. It does not treat batches as randomized contrasts.

## Data-quality checks

| Batch | Runs | Orders | Final E | Expected | Prompt-audit runs | Complete | Window |
|---|---:|---:|---:|---:|---:|:---:|---|
| content_factorial_2026_10_21 | 24 | 24 | 139 | 139 | 0/24 | yes | 2026-10-21 18:00:37 to 2026-10-21 19:44:52 |
| recording_rule_2026_10_22 | 24 | 24 | 185 | 185 | 0/24 | yes | 2026-10-22 02:15:17 to 2026-10-22 02:54:40 |
| debate_visibility_2026_10_31 | 24 | 24 | 178 | 178 | 0/24 | yes | 2026-10-31 05:03:13 to 2026-10-31 05:58:27 |
| same_batch_methods_2026_10_31 | 24 | 24 | 171 | 171 | 0/24 | yes | 2026-10-31 05:01:26 to 2026-10-31 05:41:27 |
| instruction_crossover_2026_10_31 | 24 | 24 | 155 | 155 | 24/24 | yes | 2026-10-31 17:11:48 to 2026-10-31 18:02:36 |
| confidence_display_2026_11_07 | 24 | 24 | 182 | 182 | 24/24 | yes | 2026-11-07 01:55:05 to 2026-11-07 02:41:42 |

All six batches use the same scenario ID, pinned Haiku model, two initial liar-agent identities, ten initially uncertain neutral agents, 36 calls, and the same fixed source text. The analysis aligns actual speaking sequences. It does not assume that roster filenames identify the executed order.

The batches were run at different times and were embedded in different grids. Only the instruction-crossover and confidence-display traces retain complete prompt audits. Cross-batch differences therefore cannot by themselves be attributed to provider drift.
The six source artifacts do not expose one uniform cryptographic trace-hash field. This audit therefore identifies traces by the artifact paths and run IDs, then checks their schema, counts, orders, source text, and reported outcomes directly.

## Judgments by response number

| Batch | Response 1 E/R/U | Response 2 E/R/U | Final E/R/U | First neutral E/R/U |
|---|---:|---:|---:|---:|
| content_factorial_2026_10_21 | 0/0/240 | 9/0/231 | 139/0/101 | 0/0/24 |
| recording_rule_2026_10_22 | 0/0/240 | 40/0/200 | 185/0/55 | 0/0/24 |
| debate_visibility_2026_10_31 | 0/0/240 | 32/0/208 | 178/1/61 | 0/0/24 |
| same_batch_methods_2026_10_31 | 0/0/240 | 32/0/208 | 171/1/68 | 0/0/24 |
| instruction_crossover_2026_10_31 | 0/8/232 | 29/10/201 | 155/12/73 | 0/0/24 |
| confidence_display_2026_11_07 | 0/0/240 | 35/0/205 | 182/0/58 | 0/0/24 |

## Early-record summary

| Batch | Round-1 record L-E/N-E/N-R | Mean neutral E after round 2 | final | r(round-1, final) |
|---|---:|---:|---:|---:|
| content_factorial_2026_10_21 | 48/0/0 | 0.38 | 6.17 | NA |
| recording_rule_2026_10_22 | 48/0/0 | 1.67 | 9.38 | NA |
| debate_visibility_2026_10_31 | 48/0/0 | 1.33 | 8.75 | NA |
| same_batch_methods_2026_10_31 | 48/0/0 | 1.33 | 8.46 | NA |
| instruction_crossover_2026_10_31 | 48/0/8 | 1.21 | 7.67 | NA |
| confidence_display_2026_11_07 | 48/0/0 | 1.46 | 9.04 | NA |

The first saved entry is written by a liar agent in 143/144 aligned runs. After the first round, five batches contain only the two liar endorsements per run. The instruction-crossover batch additionally saves eight neutral rejections. No batch has a saved neutral endorsement after round 1.

## What the timing does and does not show

Across all 144 order-by-batch observations, the correlation between the number of first-response endorsements and final endorsements is undefined (all first-response endorsement counts are zero). The correlation between second-response and final endorsements is 0.604.
These correlations are descriptive. The 144 observations are 24 speaking orders repeated across six batches, not 144 independent draws.

No neutral agent endorses on its first response in any batch. Five batches have 240/240 uncertain first responses; the instruction-crossover batch instead has 232 uncertain and 8 rejecting judgments. Among the other five batches, aligned trajectories first diverge no earlier than neutral response 16, in the second round. Second-response endorsement totals then span 9 to 40, before widening to 139 to 185 at the final response. The variation therefore does not begin in the first neutral judgments. It first appears during the second response, and the between-batch range is larger by the final response.

The analysis locates the first observable divergence but cannot identify its external cause. Different execution dates and grid contexts remain confounded, and the trace databases do not store complete provider requests. A locked replay is needed to test current-provider drift.

## Exact saved-prompt comparison

The saved system and user prompts match for all aligned first-neutral calls, but the older crossover used maxTokens=1024 and the confidence-display batch used maxTokens=384. They are prompt-text matched, not exact request-contract replicates.
Across the 24 aligned orders, the system and user prompt text for the first neutral call matches in 24/24 pairs. The full request contract matches in 0/24 because the token cap differs. The first differing neutral output is elicited by identical system and user prompt text in 8/8 orders that differ at all. No observed completion reaches the smaller 384-token cap, but the cap remains a request-contract difference.

## Locked replay candidates

The JSON report contains 24 candidates selected without looking at replay outcomes: the first neutral response in each executed speaking order from the 2026-10-31 instruction-crossover assess/shared-memory version. Each candidate contains the saved prompt audit and request hash, so it can be replayed without reconstructing an old prompt. The older 139, 171, and 178 batches must not be called exact-input replay sources because their traces lack prompt audits.

Because all six batches agree on these first responses, that replay checks the stability of starting judgments but cannot explain the 139--185 range. The JSON therefore includes a separate exploratory set at neutral-response rank 16, the earliest aligned divergence among the five non-crossover batches. That later set targets the observed divergence but was selected after seeing this audit and must be labeled exploratory.

## Reproduction

```bash
python3 rebuttal_harness/analysis/analyze-fixed-explanation-batch-divergence-v1.py
```

The machine-readable output is `fixed-explanation-batch-divergence-v1-results.json` in the same analysis directory.
