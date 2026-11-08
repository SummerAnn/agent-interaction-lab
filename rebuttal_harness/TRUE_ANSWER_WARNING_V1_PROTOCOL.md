# True-answer warning mirror v1

## Status

This package is **prepared but not executed**. It is reserved for the reviewer question about whether the two highlighted warnings suppress a correct repeated answer. Do not run it unless the reviewer-response plan explicitly authorizes execution.

## Locked design

- Model and task: Claude Haiku 4.5 on ego depletion.
- Group: 12 agents, with 2 fixed sources and 10 neutral agents.
- Source message: `I reject this claim. The evidence does not support a strong, reliable ego-depletion effect.`
- Speaking orders: the same 24 content-factorial orders in every condition.
- Turns: 3 rounds, or 36 public turns and model calls per run.
- Batch: all 72 cells use one frozen shuffled order (`cellOrderSeed: 2026110601`).
- Temperature: 0.

The three locked cells are:

1. Standard shared memory (`agent_judgment`).
2. Shared memory with answer counts and a dependence warning (`independence_aware`).
3. Shared memory with earlier-statement links and a repetition warning (`provenance_aware`).

This is 3 conditions x 24 orders = 72 runs, with at most 2,592 model calls.

## Outcomes fixed before execution

The primary outcome is the number of correct rejections among the 240 neutral final judgments in each condition. The paired unit is speaking order. Report endorsements, rejections, and uncertain judgments for every cell, along with the number of orders in which each warning loses any correct rejection relative to the standard control. Paired sign tests compare correct-rejection counts by order, with Holm adjustment across the two warning comparisons.

The result must be reported regardless of direction. A warning preserves the correct repeated answer only if its correct-rejection count is not lower than the same-batch standard control. Any shift from rejection to uncertainty or endorsement is a cost and must be shown.

## Safe validation commands

These commands inspect configuration and code only. They do not call a model or API.

```bash
node scripts/run-true-answer-warning-v1.mjs
node --import tsx analysis/audit-true-answer-warning-v1.mjs --static
```

## Reserved execution command

Do not use this command unless execution is explicitly authorized:

```bash
node scripts/run-true-answer-warning-v1.mjs --execute
```

The runner rejects every other flag and performs the same preflight before execution. The exact `--execute` flag is the only path that launches the grid.

## Post-run audit

If execution is later authorized and completes, run:

```bash
node --import tsx analysis/audit-true-answer-warning-v1.mjs \
  output/true_answer_warning_haiku_v1-grid-results.json \
  analysis/true-answer-warning-v1-audit.json
```

The audit verifies the frozen design, all 72 trace databases, exact fixed-source turns, warning delivery, provenance markers, parsing, complete final judgments, and paired order-level comparisons.
