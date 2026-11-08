# Final evidence index

The paper reports **8,914 completed multi-agent runs**. Two replay studies add
**96 one-turn model calls**, which are reported separately and are not included
in the run total.

## Run accounting

| Evidence group | Runs | Canonical index |
| --- | ---: | --- |
| Original release | 6,686 | `run_manifest.json` plus the supplementary and extension manifests below |
| Record-content studies | 696 | `rebuttal_run_manifest.json` |
| Confirmatory follow-ups | 428 | `rebuttal_run_manifest.json` |
| Debate, correction, and persistence | 840 | `rebuttal_run_manifest.json` |
| Correct-answer warnings | 72 | `rebuttal_run_manifest.json` |
| Confidence-display studies | 96 | `rebuttal_run_manifest.json` |
| Four-question false-tool-result study | 96 | `rebuttal_run_manifest.json` |
| **Paper total** | **8,914** | |
| One-turn replay calls, excluded from total | 96 | `replay_call_manifest.json` |

The original 6,686 runs are split across these files:

- `run_manifest.json`: 5,542 runs
- `new_appendix_run_manifest.json`: 576 runs
- `open_model_visibility_manifest.json`: 216 runs
- `single_peer_influence_manifest.json`: 180 runs
- `large_group_run_manifest.json`, `scale12_ratio_sweep_audit.json`,
  `scale100_transition_audit.json`, and `scale6_ratio0_audit.json`: 172
  unique extension runs after removing 16 intentional rechecks

## Final follow-up table map

| Final appendix table | Evidence |
| ---: | --- |
| 54 | Debate visibility changes |
| 55 | Same-batch six-version comparison |
| 56 | Haiku matched-instruction comparison |
| 57 | Sonnet and Opus matched-instruction comparison |
| 58 | Correction timing with equal recovery time |
| 59 | Earlier two-version record removal |
| 60 | Four-version personal-history component experiment |
| 61 | First-saved-entry analysis over existing 100-agent runs |
| 62 | Matched visible-endorsement analysis over released runs |
| 63 | Confidence trajectories over existing runs |
| 64 | Intervention outcome summary over released runs |
| 65 | Correct-answer warning comparison |
| 66 | Confidence-display comparisons |
| 67 | Identical-context replay, 48 calls and no added runs |
| 68 | Temporal replay, 48 calls and no added runs |
| 69 | Four-question false-tool-result study |

## Verification

From the repository root:

```bash
npm run verify:release:quick
npm run verify:release
```

Quick mode checks manifest counts, uniqueness, paths, summaries, and reported
aggregates. Full mode additionally checks every released checksum and SQLite
database. The durable report is written to `analysis/release_audit.md` and
`analysis/release_audit.json`.

The frozen tool-result-v3 design manifest retains its pre-run
`prepared_not_authorized` status as provenance. The completed 96-run audit is
the execution record and has `passed: true`.
