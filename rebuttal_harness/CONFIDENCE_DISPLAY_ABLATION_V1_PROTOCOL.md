# Confidence-display ablation v1

## Question

Does showing numeric confidence scores on saved shared-memory judgments change false endorsement?

This is a post-hoc control motivated by reviewer qZ9z's question about confidence scores. It is not a preregistered test from the original submission.

## Design frozen before launch

- Model: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Task: ego depletion
- Group: 12 agents, comprising 2 fixed liar agents and 10 neutral agents
- Interaction: 3 rounds under shared memory
- Source message: the fixed mechanism explanation used in the paper's message-content comparison
- Speaking orders: the same 24 position-balanced orders used in the paper
- Execution: both versions run together in random order in one batch
- Temperature: 0
- Planned size: 48 executions and at most 1,728 model calls

The two versions differ in one field only:

1. **Standard shared memory:** later agents see the numeric confidence attached to each retrieved judgment.
2. **Confidence hidden:** later agents see the same saved stance and reasoning, but no numeric confidence attached to any retrieved judgment.

Agents in both versions must still report their own numeric confidence. The hidden values remain stored for analysis and are removed only when saved judgments are displayed on later turns. The separate sentence giving an agent its own immediately prior stance and confidence is unchanged. The experiment therefore tests confidence displayed in the shared record, not all possible verbal or private confidence cues.

## Frozen outcomes

Speaking order is the statistical unit. Individual judgments are not treated as independent replicates.

Primary outcome:

- paired difference, by speaking order, in the final false-endorsement rate among the 10 neutral agents

Secondary outcomes:

- final endorse, reject, and uncertain counts
- orders with any neutral false endorsement
- orders in which all 10 neutral agents falsely endorse
- paired exact sign test across non-tied orders
- a seeded speaking-order resampling interval for the paired rate difference

The audit will also report confidence trajectories descriptively, but these are not the primary outcome.

## Validity and stopping rules

- All 48 planned executions must finish before outcome analysis.
- Only invalid executions may be repeated, with the same configuration.
- Every valid execution must contain 36 turns, 36 model calls, and three calls per agent.
- The two fixed liar agents must produce the exact frozen message on all six of their turns.
- No parser or heuristic fallbacks are allowed.
- In the hidden arm, every retrieved shared judgment prompt must omit its numeric confidence score.
- In the standard arm, retrieved shared judgment prompts must retain numeric confidence scores.
- The batch will be interpreted narrowly because the saved reasoning can still express confidence in words.

## Frozen inputs

- Manifest: `experiments/confidence-display-ablation-haiku-scale12-v1.json`
- Standard version: `conditions/content-factorial-v1/content_mechanism_shared_memory.yaml`
- Hidden version: `conditions/content-factorial-v1/content_mechanism_shared_memory_confidence_hidden.yaml`
- Scenario: `scenarios/blind_ego_depletion_scale12_a2_v1.yaml`
- Rosters: `rosters/content-factorial-v1/content_order_01.json` through `content_order_24.json`
