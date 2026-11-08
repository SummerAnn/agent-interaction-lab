# First saved entry in the 100-agent runs

## Result

Across the 40 accepted runs, a liar-written endorsement is the first saved entry in 19 runs. Neutral agents endorse at least once in 16 of those 19 runs, and all neutral agents endorse in 15. The mean final neutral endorsement rate is 84.0%.

A neutral-agent rejection is the first saved entry in the other 21 runs. None of those runs ends with any neutral false endorsement.

Restricting the analysis to runs with at least two liar agents gives the same pattern. A liar-written endorsement is first in 18 runs, of which 16 show some neutral endorsement and 15 show complete spread. A neutral rejection is first in 14 runs, none of which shows any neutral endorsement.

## Exceptions

The first entry is predictive but not sufficient. Three runs begin with a liar-written endorsement and still end without any neutral endorsement: one run with one liar agent, one with two, and one with ten.

| Liar agents | Placement | Final endorse | Final reject | Final uncertain |
|---:|---:|---:|---:|---:|
| 1 | 1 | 0 | 0 | 99 |
| 2 | 3 | 0 | 1 | 97 |
| 10 | 1 | 0 | 90 | 0 |

## Interpretation

The type of the first saved entry strongly predicts the final outcome in these tested speaking orders. This supports the paper's account that an early committed entry can shape what remains visible in the six-entry record. It does not establish that the first entry alone causes the result. Speaking order determines the first entry and also changes the sequence of later entries.

## Audit checks

- The script reads exactly the 40 run IDs in `scale100_transition_audit.json`.
- It uses the accepted a3/p4 recovery run named by that audit.
- It does not scan or read the quarantined overwritten a3/p4 duplicate.
- Final stance totals match Appendix Table 39 at every liar-agent count.
- No model or API calls are made.

Run `python3 analyze-scale100-first-saved-entry-v1.py` to reproduce the JSON and this report.
