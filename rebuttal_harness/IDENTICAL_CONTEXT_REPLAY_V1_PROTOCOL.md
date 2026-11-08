# Identical-context record-versus-transcript replay v1

## Status

This protocol is **locked but not executed**. No model or API calls have been made for it. It is reserved for the reviewer question about whether shared memory changes an agent's answer because of how identical earlier judgments are presented, rather than because the agent sees different statements.

The protocol contains 24 paired contexts and 48 planned calls. Context selection, prompt construction, outcomes, analysis, and interpretation are fixed below before any replay result is observed.

## Question and expectation

The experiment asks one narrow question.

> If the target agent, task, prior state, authors, statements, stance labels, confidence values, and order are identical, does presenting the earlier statements as a shared record instead of a discussion transcript change the target's answer?

The directional expectation is that the shared-record rendering will produce more endorsements than the discussion-transcript rendering. The primary analysis remains a two-sided paired test. Every result is reportable, including no difference or a difference in the opposite direction.

This is a one-turn presentation test. It does not recreate the full dynamics of either shared memory or live debate.

## Source traces

All contexts come from the completed arm

`causal_explanation__shared_memory__memory_assessment`

in the Haiku prompt-frame crossover v2 study. The source study used Claude Haiku 4.5 on ego depletion, two fixed sources, ten neutral agents, matched assessment instructions, three rounds, and 24 position-balanced speaking orders.

The source files are:

- `experiments/prompt_frame_crossover_v2/study-manifest.json`
- `analysis/prompt-frame-crossover-v2-audit.json`
- the 24 trace databases named by the audit for the source arm above

The source audit reports 24 complete runs, one for each speaking order. It also verifies the pinned model, exact fixed messages, complete prompts, and matched first-turn request contracts.

## Context selection fixed before replay outcomes

Select exactly one context from each of the 24 source runs using this mechanical rule:

1. Order the public responses by stored state id.
2. Exclude the two fixed-source agents, `analyst_1` and `analyst_7`.
3. Count responses separately for each remaining agent.
4. Select the **earliest neutral agent's third response** in that speaking order.
5. Read the entries shown to that target at that step from `retrieval_traces.retrieved_entry_ids_json`, preserving the stored order.
6. Read the target's immediately preceding stance and confidence from `agent_claim_states` and use them as the prior state in both replay arms.

The rule uses speaking order, role, response number, and the retrieval trace. It does not use the selected target's original third-response stance, confidence, or reasoning. The original target response must not appear in the replay manifest.

The third response is used because it is a fixed later-turn point with meaningful exposure in every order. It is not selected because of any replay or source-run outcome.

### Locked context inventory

The following inventory was obtained from the completed trace databases before any replay. `E/R/U` describes the stances among the entries shown to the target. It is descriptive only and is not a selection criterion.

| Order | Target step | Target | Prior state | Entries | Entry stances |
|---:|---:|---|---|---:|---|
| 01 | 26 | analyst_2 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 02 | 25 | analyst_2 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 03 | 25 | analyst_3 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 04 | 25 | analyst_4 | reject, 0.62 | 6 | E1/R5/U0 |
| 05 | 25 | analyst_5 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 06 | 25 | analyst_6 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 07 | 26 | analyst_8 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 08 | 25 | analyst_8 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 09 | 25 | analyst_9 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 10 | 25 | analyst_10 | uncertain, 0.45 | 5 | E5/R0/U0 |
| 11 | 25 | analyst_11 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 12 | 25 | analyst_12 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 13 | 26 | analyst_12 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 14 | 25 | analyst_12 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 15 | 25 | analyst_11 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 16 | 25 | analyst_10 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 17 | 25 | analyst_9 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 18 | 25 | analyst_8 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 19 | 26 | analyst_6 | uncertain, 0.45 | 5 | E5/R0/U0 |
| 20 | 25 | analyst_6 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 21 | 25 | analyst_5 | uncertain, 0.45 | 4 | E4/R0/U0 |
| 22 | 25 | analyst_4 | uncertain, 0.45 | 5 | E5/R0/U0 |
| 23 | 25 | analyst_3 | uncertain, 0.45 | 6 | E6/R0/U0 |
| 24 | 25 | analyst_2 | uncertain, 0.45 | 6 | E6/R0/U0 |

Eleven contexts contain four entries, three contain five, and ten contain six. Twenty-three targets begin uncertain at 0.45. The remaining target begins by rejecting at 0.62. These differences are preserved because the paired comparison holds each complete context fixed.

## Locked 48-call design

Each selected context is replayed once in each arm.

1. **Shared-record rendering**
2. **Discussion-transcript rendering**

This gives 24 contexts x 2 renderings = 48 calls.

Every call uses:

- model `claude-haiku-4-5-20251001`;
- temperature 0;
- the target agent's exact neutral assessment system instructions;
- the same claim and ego-depletion task;
- the same target identity;
- the same prior stance and confidence;
- the same ordered items;
- the same item authors, stance labels, confidence values, source types, and exact statement text;
- the same decision instruction;
- the same structured JSON response contract;
- the same maximum output length.

No arm receives a discussion-specific instruction, a reply affordance, a warning about dependence, or a different response format. In particular, the transcript arm must not use the production live-discussion prompt, because that would also change the system instructions and output contract.

## The only permitted prompt difference

The prompt has a common claim block, common prior-state block, one presentation block, and a common decision block. Only the presentation block changes.

### Shared-record block

```text
## Shared record

These are shared-record entries from other agents, in the order shown.

1. Record entry from [AGENT_ID] - STANCE (confidence: CONFIDENCE): "EXACT TEXT"
2. Record entry from [AGENT_ID] - STANCE (confidence: CONFIDENCE): "EXACT TEXT"
...
```

### Discussion-transcript block

```text
## Discussion transcript

These are discussion messages from other agents, in the order shown.

1. Discussion message from [AGENT_ID] - STANCE (confidence: CONFIDENCE): "EXACT TEXT"
2. Discussion message from [AGENT_ID] - STANCE (confidence: CONFIDENCE): "EXACT TEXT"
...
```

The permitted substitutions are therefore limited to:

- `Shared record` versus `Discussion transcript`;
- `shared-record entries` versus `discussion messages`;
- `Record entry` versus `Discussion message`.

The item number, author id, stance, confidence, text, and order must be byte-identical after those fixed substitutions are normalized. No other prompt token may differ within a pair.

### Common decision block

Both arms end with the same modality-neutral instruction:

```text
## Decision

Use your prior belief and the information shown above to assess the claim. Respond with the required JSON assessment.
```

The replay must not add an independence warning or tell the model to count messages. Those would test a mitigation rather than presentation.

## Execution order

The 24 pairs form one batch. Run one pair at a time with concurrency 1 so the two calls in a pair are adjacent. Shuffle the 24 context blocks with the harness Fisher-Yates procedure and its linear-congruential generator using seed `2026110602`. In the resulting schedule, odd-numbered blocks run record first and even-numbered blocks run transcript first. This gives exactly 12 blocks in each arm order and fixes the schedule before execution.

Retries for transient provider failures are technical retries of the same cell, not new observations. The first complete, parse-valid response is the cell's result. Raw failed attempts must remain in the audit log.

## Outcomes and paired analysis fixed before execution

### Primary outcome

For each context, code whether the target endorses the claim in each rendering. The primary effect is

`(record endorsements - transcript endorsements) / 24`.

The independent unit is the 24 context pairs, not the 48 calls and not the individual entries.

Report the paired 2 x 2 table:

| | Transcript endorses | Transcript does not endorse |
|---|---:|---:|
| Record endorses | a | b |
| Record does not endorse | c | d |

Use a two-sided exact McNemar test, equivalently an exact two-sided binomial test on the `b + c` discordant pairs under probability 0.5. If there are no discordant pairs, report the paired difference as zero and the test as uninformative rather than inventing a p-value.

Also report a context-paired 95% bootstrap interval for the endorsement-rate difference. Resample the 24 complete pairs, not the 48 calls separately.

### Secondary descriptions

Report, without additional confirmatory claims:

- endorse, reject, and uncertain counts in each arm;
- mean and median confidence in each arm;
- the paired mean-confidence difference;
- the number of contexts whose three-way stance changes between arms;
- all 24 paired outcomes in an appendix table.

There is one primary contrast, so no multiplicity correction is needed. Secondary results are descriptive.

## Locked interpretation

### If shared-record endorsement is higher

Conclude that shared-record presentation contributes to endorsement for these fixed later-turn Haiku contexts. Do not say that presentation fully explains the shared-memory-versus-debate gap. The full systems also differ in which messages appear, how they accumulate, whether agents can reply, and how prior states develop.

### If the arms are tied or nearly tied

Conclude that labeling identical content as a record or transcript does not explain the gap in these contexts. The more likely explanation lies in the dynamic differences that this replay removes, including visibility, interaction history, or the messages generated under each method.

### If transcript endorsement is higher

Report the reversal directly. Conclude that record framing is not the source of the observed advantage in these contexts.

Under every outcome, state that the replay uses contexts generated in shared-memory runs. It therefore has strong internal control over the one-turn rendering but does not show how a natural discussion would generate those same messages.

## Manifest and static audit required before any call

A future no-call preparation script must create `analysis/identical-context-replay-v1-manifest.json` containing:

- protocol version and timestamp;
- source audit and study-manifest paths and SHA-256 hashes;
- all 24 source run ids, order ids, trace paths, and trace SHA-256 hashes;
- selected target, step, and response number;
- prior stance and confidence;
- ordered retrieved entry ids and full entry payloads;
- hashes of the shared system prompt and every shared prompt block;
- both rendered prompts and their SHA-256 hashes;
- model, temperature, maximum tokens, structured-output name and schema;
- frozen block order, arm order, and seed.

The static audit must fail unless all of the following hold:

1. There are exactly 24 unique speaking orders and two cells per order.
2. Every source run belongs to `causal_explanation__shared_memory__memory_assessment`.
3. The selected turn is the earliest neutral agent's third response.
4. Neither fixed-source agent is ever selected as the target.
5. Every retrieved entry id exists in the source trace and was written before the target step.
6. Each pair has identical claim, target, prior state, items, authors, stance labels, confidence values, item order, text, system instructions, decision instructions, model settings, and output schema.
7. Pairwise prompt normalization removes only the three permitted rendering substitutions and then produces byte-identical prompts.
8. The manifest does not contain the selected target's original third-response outcome.
9. The generator and static audit do not resolve API keys, access the network, or call `callLLM`.

## Post-run audit required if execution is later authorized

The post-run audit must verify:

- 48 unique planned cells and 48 complete parse-valid results;
- one complete result for every context-arm cell and both arms for every pair;
- model, temperature, token limit, and structured-output contract match the manifest;
- the exact system and user prompt hashes match the locked manifest;
- raw request, raw response, usage, retry history, and timestamps are preserved;
- no retry is counted as another observation;
- stored stance and confidence match a fresh parse of the raw response;
- the paired table and every reported total reproduce from the 48 stored results.

## Harness feasibility and proposed implementation

The existing harness can support this experiment without changing the multi-agent engine.

- `src/llm/client.ts` exports `callLLM`.
- `src/llm/prompts.ts` exports `buildSystemMessage` and `parseLLMResponse`.
- `src/llm/promptFrame.ts` exports `claimAssessmentOutputSchema`.
- `src/llm/provider.ts` exports `resolveProvider`.

Do not call `buildFramedClaimPrompt` for the two arms. Its production memory and discussion frames intentionally change the system prompt, user instructions, response mode, and output schema. Those are the differences this replay must remove.

The proposed files are:

- `analysis/prepare-identical-context-replay-v1.mjs` for read-only extraction, prompt construction, manifest writing, and static audit;
- `scripts/run-identical-context-replay-v1.mjs` for safe preflight by default and model calls only with the exact `--execute` flag;
- `analysis/audit-identical-context-replay-v1.mjs` for the post-run audit and paired statistics;
- `analysis/identical-context-replay-v1-results.json` and `.md` for audited results.

No implementation or execution is part of this protocol-only preparation.

## Exact paper and rebuttal placement if the study is run

### Main text

Add at most one sentence to Section 4.2, immediately after the existing visible-entry analysis. Do not change the abstract, introduction, conclusion, or headline claim.

If the record arm is higher:

> When we replay the same 24 later-turn contexts with identical statements, presenting them as a shared record produces endorsement in X contexts, compared with Y when they are presented as a discussion transcript (Appendix Table X).

If there is no meaningful difference:

> When we replay the same 24 later-turn contexts with identical statements, changing only whether they are presented as a shared record or a discussion transcript does not change endorsement (X versus Y of 24; Appendix Table X).

If the transcript arm is higher, use the same factual structure and state the reversal.

### Appendix

Place the full protocol and paired table immediately after Appendix W.2, the visible-entry analysis. Report the selection rule, all 24 context pairs, the exact paired test, the three-way stance counts, confidence summaries, and the one-turn limitation.

### Rebuttal

Use the result in the answers to qZ9z's visible-entry question and Mbe5 Q1. The reply should state what was held identical, give the paired result, and end with the limitation that the replay tests presentation of fixed content rather than the full dynamic methods.
