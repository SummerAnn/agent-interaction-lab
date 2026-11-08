# Intervention outcomes reported in the current paper

Compact reviewer-facing summary of the highlighted six-agent record changes, the cross-model uncertainty-saving comparison, and equal-time corrections.

The table has 23 completed rows. A full endorsement/rejection/uncertainty split is available for 23 of them. Two prepared correct-answer warning cells are marked not run.

| Family | Model | Task | Intervention | Repeated input | Time | E | R | U | Total | Status | Source |
|---|---|---|---|---|---|---:|---:|---:|---:|---|---|
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Standard shared memory | Four agents repeat false claim | final | 23 | 0 | 1 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Reliable external check | Four agents repeat false claim | final | 0 | 24 | 0 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Early correction | Four agents repeat false claim | final | 0 | 9 | 15 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Late correction | Four agents repeat false claim | final | 7 | 2 | 15 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Older entries shown less prominently | Four agents repeat false claim | final | 17 | 1 | 6 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Answer counts and dependence warning | Four agents repeat false claim | final | 0 | 1 | 23 | 24 | completed | Main Table 2 |
| Six-agent record changes | Claude Haiku 4.5 | Ego depletion | Earlier-statement links and repetition warning | Four agents repeat false claim | final | 0 | 0 | 24 | 24 | completed | Main Table 2 |
| Saving uncertainty | Claude Haiku 4.5 | Ego depletion | Uncertainty omitted | Explanation of false claim | final | 185 | 0 | 55 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Haiku 4.5 | Ego depletion | Uncertainty saved | Explanation of false claim | final | 0 | 0 | 240 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Haiku 4.5 | Ego depletion | Uncertainty omitted | Correct rejection | final | 0 | 240 | 0 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Haiku 4.5 | Ego depletion | Uncertainty saved | Correct rejection | final | 0 | 180 | 60 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Sonnet 4.6 | PANDAS | Uncertainty omitted | Explanation of claim | final | 0 | 0 | 240 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Sonnet 4.6 | PANDAS | Uncertainty saved | Explanation of claim | final | 0 | 0 | 240 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Opus 4.6 | PANDAS | Uncertainty omitted | Explanation of claim | final | 196 | 0 | 44 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Opus 4.6 | PANDAS | Uncertainty saved | Explanation of claim | final | 0 | 0 | 240 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Sonnet 4.6 | SciTaT-A | Uncertainty omitted | Explanation of false claim | final | 240 | 0 | 0 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Sonnet 4.6 | SciTaT-A | Uncertainty saved | Explanation of false claim | final | 70 | 0 | 170 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Opus 4.6 | SciTaT-A | Uncertainty omitted | Explanation of false claim | final | 240 | 0 | 0 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | Claude Opus 4.6 | SciTaT-A | Uncertainty saved | Explanation of false claim | final | 240 | 0 | 0 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | GPT-6.1 Sol | SciTaT-A | Uncertainty omitted | Explanation of false claim | final | 240 | 0 | 0 | 240 | completed | Appendix Table 51 |
| Saving uncertainty | GPT-6.1 Sol | SciTaT-A | Uncertainty saved | Explanation of false claim | final | 108 | 0 | 132 | 240 | completed | Appendix Table 51 |
| Correction timing | Claude Haiku 4.5 | Ego depletion | Early correction with equal recovery | Two agents repeat false explanation | final | 0 | 240 | 0 | 240 | completed | Appendix Table 58 |
| Correction timing | Claude Haiku 4.5 | Ego depletion | Late correction with equal recovery | Two agents repeat false explanation | final | 0 | 180 | 60 | 240 | completed | Appendix Table 58 |
| Correct-answer warning mirror | Claude Haiku 4.5 | Ego depletion | Answer counts and dependence warning | Two agents repeat correct rejection | final | -- | -- | -- | -- | not run | True-answer warning mirror v1 protocol |
| Correct-answer warning mirror | Claude Haiku 4.5 | Ego depletion | Earlier-statement links and repetition warning | Two agents repeat correct rejection | final | -- | -- | -- | -- | not run | True-answer warning mirror v1 protocol |

## How to read this table

E, R, and U mean endorsement, rejection, and uncertainty. For PANDAS, endorsement is agreement with a disputed statement rather than a scored error. The first seven rows use E/R/U recovered from the exact archived traces selected for Main Table 2.

The sharpest true-answer gap remains the two warnings highlighted in the main text. Their correct-answer mirror is prepared but has not been run. Saving uncertainty is the only record intervention currently tested with both a false repeated answer and the correct repeated answer in a matched 24-order comparison.

Broader warning results appear in Appendix Tables 44, 46, and 47. They are not repeated here because those tables report endorsement but not the rejection/uncertainty split requested by the reviewer.

## Source check

Every completed row is checked against its exact LaTeX source row when this script runs. The first seven are also checked against the trace-level six-agent audit. The JSON retains the source string and notes for audit. No model or API calls are made.
