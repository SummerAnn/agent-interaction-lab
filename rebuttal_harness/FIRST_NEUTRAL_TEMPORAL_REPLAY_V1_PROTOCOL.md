# Exact-request temporal replays v1

## Status

This protocol is **locked but not executed**. No model or API calls are made by
the preparation or static-audit scripts. Execution requires a separate command
and an explicit approval environment variable.

## Question

The paper reports that otherwise matched Haiku batches can produce different
amounts of false endorsement. Two separately labeled replays ask related
data-quality questions.

The **first-neutral repeatability cohort** asks:

> When the exact saved provider request for the first neutral judgment in each
> speaking order is sent to the same pinned model again, does the returned
> judgment remain the same?

The **exploratory rank-16 cohort** replays neutral-response rank 16 in every
speaking order. The batch audit selected rank 16 after observing that it was the
earliest aligned response at which the five non-crossover batches differed.
This cohort is therefore exploratory and must not be presented as prespecified
or combined inferentially with the first-neutral cohort.

Each cohort can show whether its saved requests are stable over time. A changed
response is consistent with temporal provider variation or nondeterminism. It
does not prove that the provider changed model weights, and an unchanged response
does not rule out variation at another time or later in a multi-agent run.

## Source batch

All 48 selected requests come from the 24 completed runs in the prompt-frame crossover v2 arm
`causal_explanation__shared_memory__memory_assessment`, run on 31 October 2026.
That arm used Claude Haiku 4.5, ego depletion, shared memory, assess
instructions, two fixed liar agents, ten neutral agents, and 24 speaking orders.

The controlling source audit is
`analysis/prompt-frame-crossover-v2-audit.json`. The source traces store the
complete request in `retrieval_traces.context_json.promptAudit`, including the
system prompt, user prompt, model, temperature, maximum tokens, response mode,
structured-output name, and structured-output schema.

The older 21 October traces are not used for this replay because they do not
store complete prompt audits. Reconstructing their prompts would not support an
exact-request claim.

## First-neutral selection rule fixed before replay outcomes

For each of the 24 completed source runs:

1. Read public judgments in stored state order.
2. Exclude the two fixed liar-agent IDs recorded by the source audit.
3. Select the first remaining judgment, which is the first neutral response in
   that executed speaking order.
4. Read the complete saved request and raw response from that step's retrieval
   trace.

The rule uses the role and response position only. It does not use the original
stance, confidence, reasoning, final run outcome, or any replay outcome. The 24
executed first-round order keys must be unique.

## Exploratory rank-16 selection

For each of the same 24 source runs, order neutral judgments by stored state
order and select the 16th one. This is neutral-response rank 16, not model-call
step 16. The agent and stored step can therefore differ across speaking orders.

The descriptive batch audit selected this rank after examining where aligned
batch trajectories first differed. The rule is locked before replay outcomes,
but not before the source divergence analysis. Its results are exploratory.

## Locked 48-call design

Replay each selected request once, giving 24 calls in each cohort and 48 calls
in total. Every call preserves
the source request exactly:

- model `claude-haiku-4-5-20251001`;
- direct Anthropic provider;
- temperature 0;
- maximum output length 1,024 tokens;
- saved system prompt and user prompt;
- saved structured JSON response contract.

The 48 calls run serially in a deterministic shuffled schedule fixed in the
manifest. The runner makes no automatic retries. A provider or parse failure
stops execution, and retrying the missing request requires a separately
authorized invocation. Completed results are preserved so a resumed run skips
them.

## Outcomes

The independent unit is the saved request. Report separately for each cohort:

- original and replay endorse, reject, and uncertain counts;
- the 3 by 3 original-to-replay stance transition table;
- exact stance agreement out of 24;
- changes in confidence for each request and the mean paired change;
- all 24 original and replay judgments.

Do not pool the cohorts. No population-level significance test is prespecified.
Each set of 24 requests is the complete selected set from one controlled batch,
not a random sample of prompts.

## Interpretation fixed before execution

- **If every first-neutral stance is unchanged:** the saved starting requests
  are stable in this replay. This does not identify the cause of the later batch
  divergence.
- **If any stance changes:** identical saved requests can return different
  judgments across time. This supports temporal instability as a possible
  contributor, but does not identify whether the cause is provider-side model
  changes, serving nondeterminism, or another unobserved provider factor.
- **For the exploratory rank-16 cohort:** describe its changes separately as a
  targeted repeatability check at the earliest observed divergence rank. Do not
  claim confirmatory evidence because the rank was chosen after examining the
  batch trajectories.
- **Under every result:** do not infer the cause of later-turn amplification
  from request replay alone.

## Required audit trail

Before execution, the manifest and static audit must verify 24 unique source
runs and executed order keys in each cohort, both selection rules, complete
prompt audits, parse-valid original responses, exact agreement between original
parsed responses and stored states, the pinned request contract, and source-file
hashes. It must also preserve the batch-analysis file that motivated the
exploratory rank.

After execution, the audit must verify 48 unique complete results, exact prompt
and request hashes, the direct provider and pinned model, raw responses, retry
history, usage, timestamps, and fresh parsing of every stored response.

## Commands

Safe preparation and audit, with no API calls:

```bash
node analysis/prepare-first-neutral-temporal-replay-v1.mjs
node analysis/audit-first-neutral-temporal-replay-v1.mjs --static
node scripts/run-first-neutral-temporal-replay-v1.mjs
```

Execution is deliberately gated:

```bash
FIRST_NEUTRAL_TEMPORAL_REPLAY_APPROVED=YES \
  node --import tsx scripts/run-first-neutral-temporal-replay-v1.mjs --execute
```
