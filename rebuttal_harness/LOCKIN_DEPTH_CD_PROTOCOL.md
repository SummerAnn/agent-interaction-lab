# Lock-in depth experiments C and D

Frozen on 2026-10-31 before inspecting model outcomes.

Both studies use Claude Haiku 4.5, the ego-depletion claim, two fixed-message sources, ten neutral agents, and the same 24 position-balanced orders as the message-content study. The fixed message is the causal explanation used in that study. Temperature is zero. The new runs use new IDs and do not replace earlier output.

## C. Early and late correction with equal follow-up

The early correction appears on turn 12. The late correction appears on turn 30. Each correction is then visible for exactly 24 agent responses, which gives every agent two turns after the correction. The early runs therefore end on turn 35 and the late runs on turn 53.

- 24 early runs
- 24 late runs
- 48 runs total
- 2,112 planned model calls

Manifest: `experiments/lockin-depth-v1/fair-correction-timing-haiku-v1.json`

## D. Persistence after removing the shared record

All agents first complete 36 turns under standard shared memory. The two fixed-message sources then leave. Each of the ten neutral agents receives three more turns.

The primary condition switches to personal memory, so each agent can see its own earlier judgments but no other agent's entries. A no-history control is included because it separates persistence supported by an agent's own written history from a fresh judgment made without any earlier answer in the prompt.

- 24 shared-to-personal runs
- 24 shared-to-no-history runs
- 48 runs total
- 3,168 planned model calls

Manifest: `experiments/lockin-depth-v1/record-removal-persistence-haiku-v1.json`

## Commands

```bash
node scripts/generate-lockin-depth-rosters-v1.mjs
node --import tsx analysis/preflight-lockin-depth-v1.mjs
node --import tsx src/cli.ts experiment experiments/lockin-depth-v1/fair-correction-timing-haiku-v1.json
node --import tsx src/cli.ts experiment experiments/lockin-depth-v1/record-removal-persistence-haiku-v1.json
node --import tsx analysis/audit-lockin-depth-v1.mjs \
  output/fair_correction_timing_haiku_v1-grid-results.json \
  output/record_removal_persistence_haiku_v1-grid-results.json
```

The preflight uses the deterministic heuristic runner and checks the exact correction exposure, transition turn, source exit, three turns per neutral agent, personal-memory visibility, and empty no-history retrievals. It does not count as an experiment result.
