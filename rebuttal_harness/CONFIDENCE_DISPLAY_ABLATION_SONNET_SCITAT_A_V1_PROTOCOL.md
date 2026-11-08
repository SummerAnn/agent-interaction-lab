# Sonnet/SciTaT-A confidence-display ablation v1

## Question

Does showing numeric confidence scores beside saved shared-memory judgments change false endorsement for Claude Sonnet 4.6 on SciTaT-A?

This is a post-hoc supporting control motivated by reviewer qZ9z's question about confidence scores. The earlier comparison used Haiku on ego depletion. This comparison tests a second model and task.

## Design frozen before launch

- Model: Claude Sonnet 4.6 (`claude-sonnet-4-6`), called directly through Anthropic
- Task: SciTaT-A
- Group: 12 agents, comprising 2 fixed liar agents and 10 neutral agents
- Interaction: 3 rounds under shared memory
- Source message: the fixed SciTaT-A explanation used in the paper's earlier Sonnet comparison
- Speaking orders: the same 24 position-balanced Sonnet orders used in the earlier comparison
- Execution: both versions are rerun together in one frozen random order
- Run seed: 720, which preserves the prior order rotation because both 720 and 708 are divisible by 12
- Cell-order seed: 20261107
- Temperature: 0
- Planned size: 48 executions and 1,728 logical model calls

The two versions differ in one field only:

1. **Confidence shown:** later agents see the numeric confidence attached to each retrieved saved judgment.
2. **Confidence hidden:** later agents see the same saved stance and reasoning, but no numeric confidence attached to a retrieved judgment.

Agents in both versions still report their own numeric confidence. Hidden values remain stored for analysis and are removed only when saved judgments are displayed on later turns. The sentence reminding an agent of its own prior judgment and confidence is unchanged. The experiment therefore tests numeric confidence displayed in the shared record, not private confidence or verbal expressions of certainty.

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

## Validity and stopping rules

- All 48 planned executions must finish before outcome analysis.
- Only invalid executions may be repeated, with the same frozen configuration.
- Every valid execution must contain 36 turns, 36 logical model calls, and three calls per agent.
- The two liar agents must produce the exact fixed message on all six of their turns.
- No parser or heuristic fallbacks are allowed.
- In the hidden version, every retrieved shared-judgment prompt must omit both displayed score forms and score-specific guidance.
- In the shown version, every prompt that retrieves saved judgments must retain both displayed score forms and score-specific guidance.
- The executed cell sequence and actual speaker orders must match the frozen schedule.
- Physical API requests may exceed 1,728 only through the harness's bounded retries for transient failures.
- The comparison will be interpreted narrowly because SciTaT-A has no task evidence and saved reasoning can still express confidence in words.

## Frozen inputs

- Manifest: `experiments/confidence-display-ablation-sonnet-scitat-a-v1.json`
- Shown version: `conditions/crossmodel-recording-rule-v1/scitat_a_fixed_explanation_omit_uncertain.yaml`
- Hidden version: `conditions/crossmodel-recording-rule-v1/scitat_a_fixed_explanation_omit_uncertain_confidence_hidden.yaml`
- Scenario: `scenarios/blind_scitat_a_scale12_a2_v1.yaml`
- Rosters: `rosters/content-factorial-v1-sonnet/content_order_01_sonnet.json` through `content_order_24_sonnet.json`
