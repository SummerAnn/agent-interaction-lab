# Four-arm personal-history component follow-up

> **Do not run until the four-arm preflight and tests pass and execution is explicitly confirmed.**

This protocol is prepared but unexecuted. It separates the two components bundled together as personal history in the paper.

## Question

After the shared record is removed, do agents return to the false answer because they can read their own earlier entries, because the prompt separately states their prior stance, or because either source of history is enough?

## Frozen design

All arms reuse the existing Haiku ego-depletion persistence setup. Two fixed-message sources write for the first 36 turns and then leave. Ten neutral agents receive three follow-up turns each. The 24 position-balanced speaking orders and all four versions are shuffled into one batch before outcomes are inspected.

| Follow-up arm | Self-authored entries | Explicit prior stance |
| --- | --- | --- |
| Personal + prior | Yes | Yes |
| Entries only | Yes | No |
| Reminder only | No | Yes |
| No history | No | No |

The entries-only version uses `memory.omitPriorBeliefFromStep`, which removes the separate prior-judgment sentence while preserving personal retrieval. The reminder-only version uses `memory.reminderOnlyFromStep`, which preserves that sentence while hiding every stored entry and suppressing follow-up memory writes.

- Manifest: `experiments/lockin-entries-only-v2/record-removal-entries-only-haiku-v2.json`
- Component conditions: `conditions/lockin-entries-only-v2/`
- Orders: 24
- Conditions: 4
- Planned runs: 96
- Calls per run: 66
- Planned model calls: 6,336
- Estimated cost: $6.40--$10.47 under the harness token assumptions
- Temperature: 0
- Shared run seed: `732` (unchanged from the original persistence experiment)
- Same-batch shuffle seed: `2026110701`

## Safe preflight

This command only reads and validates configuration. It cannot launch the grid because `--execute` is absent.

```bash
node scripts/run-lockin-entries-only-v2.mjs
```

The expected report says `mode: "preflight-only"`, `plannedRuns: 96`, `plannedModelCalls: 6336`, and `executionBlocked: true`.

## Reserved execution command

> **Do not run this command until execution has been explicitly confirmed after preflight.**

```bash
node scripts/run-lockin-entries-only-v2.mjs --execute
```

The runner performs the same preflight first. Only the exact `--execute` flag unlocks the standard experiment command.

## Required post-run audit

If the reserved grid is ever run, do not report any outcome until this audit passes:

```bash
node --import tsx analysis/audit-record-removal-entries-only-v2.mjs \
  output/record_removal_history_components_haiku_v2-grid-results.json \
  analysis/record-removal-history-components-v2-audit.json
```

The audit requires all 96 matched runs and 6,336 calls. In the entries-only version, every retrieved follow-up entry must be self-authored and older than the current turn, `context.priorStance` and `context.priorConfidence` must be null, and the generated prompt must omit the prior-judgment sentence. In the reminder-only version, retrieval must be empty, the prior judgment and confidence must be present, the prior-judgment sentence must appear, and no follow-up memory entry may be written. It also checks that no-history receives neither component and that personal + prior receives both.

## Reporting rule fixed before outcomes

- If entries only resembles personal + prior and exceeds no history, earlier entries are sufficient.
- If reminder only resembles personal + prior and exceeds no history, the reminder is sufficient.
- If both single-component versions exceed no history but remain below personal + prior, both components contribute.
- If neither single-component version exceeds no history, the combination is required.
- All four versions must be reported even if one or more comparisons are null.

Primary reporting uses E/R/U counts at each follow-up turn and paired speaking-order comparisons. Do not collapse versions, omit a null result, or update the paper until the audit passes.

## Audit implementation note

The first post-run audit attempt found that speaking order 14 in the entries-only version retrieved no self-authored entries. Inspection before outcome interpretation showed that every neutral agent in that matched shared phase remained uncertain, so standard shared memory had saved no eligible neutral-agent entry. The original audit incorrectly required every personal-entry run to retrieve at least one entry. The corrected audit requires nonempty retrieval only when an eligible self-authored entry exists, while retaining all checks on entry authorship, timing, prompts, reminders, and matched shared phases. This correction changes no experiment output or reporting rule.
