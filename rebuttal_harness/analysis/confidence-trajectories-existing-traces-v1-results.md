# Confidence trajectories in the existing three-source runs

## Scope

This analysis uses the 36 standard shared-memory Haiku runs with three repeating and three neutral agents reported in Appendix E. It joins the 12 seed-0 runs from experiment v2 with the 24 seed-1/2 runs from experiment v3. Each neutral agent answers three times, giving 108 agents and 324 responses.

## Results

All 108 neutral agents are uncertain on their first response. Their mean reported confidence is 0.363. Eighty endorse on their second response, and another 22 first endorse on their third. At the first switch from uncertainty to endorsement, mean confidence rises from 0.385 on the preceding response to 0.742. All 102 adopters report higher confidence at that switch.

Endorsement is then stable for most agents. Of the 80 agents who endorse before their final response, 78 endorse again and two become uncertain. Their mean confidence is 0.739 at first endorsement and 0.737 at the final response. The mean within-agent change is -0.003 and the median is zero. Confidence rises for 25 agents, falls for three, and is unchanged for 52.

| Response number | Endorse | Reject | Uncertain | Mean confidence among endorsers |
| --- | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 108 | -- |
| 2 | 80 | 0 | 28 | 0.739 |
| 3 | 100 | 2 | 6 | 0.746 |

## Interpretation

The trajectories show a discrete change when agents move from uncertainty to endorsement, followed by persistence in 78 of 80 cases with another response available. They do not show confidence steadily strengthening after adoption. Confidence is self-reported rather than calibrated, so these numbers describe the written judgments and should not be treated as direct measurements of private belief.

## Reproduction

Run:

```text
python3 analysis/analyze-confidence-trajectories-existing-traces-v1.py
```

The script reads the archived trace databases and prints the machine-readable result stored beside this report.
