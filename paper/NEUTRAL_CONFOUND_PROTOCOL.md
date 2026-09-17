# Identical-Target Confound Protocol

Last updated: 2026-09-09

This file freezes the design and audit rules for the identical-target experiments. It exists so that no executor can silently change the comparison while completing the runs.

## Paper-facing question

The causal comparison is whether a communication protocol changes target-agent adoption of a false claim. A target agent is any agent that is not assigned to be a persistent-false source. The outcome is

`FE_t = target agents endorsing the false claim / all target agents`.

The main comparison is shared memory against a matched personal-memory control. Fixed-round debate is a second communication comparison. All three protocols must use the same task, roster profiles, target prompt, source assignment, speaking order, model, call budget, and seed within a cohort.

## Frozen corrected runs

Only these `v2` manifests may complete the pending cross-model work:

| Manifest | Cells | Purpose |
| --- | ---: | --- |
| `part2-neutral-crossmodel-weak-memory-v2.json` | 96 | Sonnet and Opus on the two-item SciTaT core subset, shared and personal memory |
| `part2-neutral-crossmodel-weak-chat-v2.json` | 48 | Sonnet and Opus on the same two items, fixed-round debate |
| `part2-neutral-fairness-crossmodel-multitask-memory-v2.json` | 432 | Three open models on six one-claim tasks, shared and personal memory |
| `part2-neutral-fairness-crossmodel-multitask-chat-v2.json` | 216 | Three open models on the same tasks, fixed-round debate |

The runner is cache-aware. A cell with `summary.json` is skipped. An interrupted cell without a summary is rerun. Never delete cached output and never run the same manifest twice at the same time.

## Frozen design

- One focal claim per scenario.
- No evidence card is visible to an agent in the cross-model task grids.
- Both targets receive the same independent-analyst instruction.
- Targets receive no numeric susceptibility or social-weight profile text.
- Twelve balanced speaking orders are used for each task, model, and protocol. Every agent appears twice in every position.
- Every run makes 18 model calls. Each of the six agents receives three calls.
- Debate uses `chat_fully_connected_no_early_stop` and always completes three rounds.
- Shared and personal memory use the same 18-call budget.
- The model and role assignment remain fixed within every matched protocol comparison.
- Seed 0 selects the provider-call configuration. API calls at temperature 0 are still not assumed to be bitwise deterministic.

## Confounds and acceptance checks

### Prompt-induced susceptibility

The original regular-agent prompt mentioned being swayed by a majority. The neutral cohorts remove that language. A neutral result supports the communication claim without relying on that instruction. It does not prove that prompting never affects adoption.

### Unequal exposure and early stopping

All protocols use 18 calls and three calls per agent. Debate early stopping is disabled. A cell with a different budget cannot enter the matched comparison.

### Baseline willingness to endorse

Shared-memory FE_t alone is insufficient. Report personal-memory FE_t and the matched difference `shared FE_t - personal FE_t`. The open-model ego-depletion cohort demonstrates why: shared and personal FE_t are both 1.000, so the memory-associated difference is zero.

### Speaking order

Use all 12 balanced orders. Report the aggregate and check target adoption by target speaking position. Do not treat a convenient order as a replicate.

### Task difficulty and prior model belief

The six-task replication spans MMR, two corrected SciTaT items, and three GSM8K problems. Interpret model effects by task. Do not generalize an ego-depletion result to all tasks or a Haiku result to all models.

### Evidence visibility

Audit what the prompt exposes, not the number of evidence objects stored in scenario metadata. Some scenarios contain records used only by scheduled interventions. The valid statement is that no evidence card is visible to agents in the baseline condition.

### Source compliance

Report target adoption separately from source retention. A fall in all-agent false endorsement can come from persistent-false sources recanting even when no target was protected. FE_t is the primary outcome for contagion. The formal metric name for source retention is adversary retention rate (AR).

### Parser behavior

Malformed JSON may be recovered only when the response contains an explicit stance field or an explicit refusal. Generic keyword guessing is not accepted. FE_t must be recomputed from the final target-agent records, not copied from a console average.

### Cohort selection

Use a complete declared grid. Never combine completed cells from an interrupted grid with cells from another cohort. Keep provider-call repeats identifiable as separate cohorts and use block-aware uncertainty summaries where applicable.

### Scripted persistent-false sources

Scripted persistence creates exposure to a false claim. It does not guarantee target adoption. Personal-memory, debate, task, ratio, and model controls show when adoption appears or disappears. Claims should remain about behavior under this specified threat model.

## Superseded runs

Do not use any copied `part2_neutral_defense_*_v1` or `part2_neutral_fairness_*_v1` result in a paper table. Those runs used an older three-claim scenario, unequal memory call budgets, early-stopping chat, or mixed evidence visibility. Their traces are preserved only as diagnostics.

The only paper-facing neutral defense cohort is `part2_neutral_defense_suite_v2`. It has one focal claim, 12 balanced orders, 18 calls, and seven matched conditions.

## Completion gate

After all four pending grids produce their exact `*-grid-results.json` files, run:

```bash
cd /path/to/agent-interaction-lab
python3 scripts/analyze_neutral_confound_suite_v1.py --repo .
```

The analyzer must report 2,982 included runs, balanced orders, 18 calls per run, three calls per agent, standardized profiles, and zero heuristic stance classifications. It must count explicit stance and refusal recoveries separately. If an assertion fails, fix or rerun the affected cell. Do not hand-edit an average.

This gate passed on September 9, 2026. Only complete audited results may be added to the appendix and run manifest. A partial result must never change the abstract, introduction, or main claim.
