# Exact-request temporal replays v1

## First-neutral repeatability cohort

First-neutral repeatability: all 24 saved requests returned the same stance. This supports request-level stability for this slice but does not identify the cause of later batch divergence.

Original: 0 E / 0 R / 24 U.
Replay: 0 E / 0 R / 24 U.
Exact stance agreement: 24/24.

The completed batches did not differ in first-response endorsement, so this cohort is a repeatability check rather than a direct test of the 139-to-185 divergence.

## Exploratory rank-16 cohort

Exploratory rank-16 replay: all 24 saved requests returned the same stance. This supports request-level stability for this slice but does not identify the cause of later batch divergence.

Original: 0 E / 1 R / 23 U.
Replay: 0 E / 1 R / 23 U.
Exact stance agreement: 24/24.

Rank 16 was selected after the batch audit found it was the earliest aligned divergence among five batches. These results are exploratory and are not pooled with the first-neutral cohort.

## Per-request results

| Cohort | Order | Agent | Step | Neutral rank | Entries | Original | Replay | Confidence change |
|---|---:|---|---:|---:|---:|---|---|---:|
| first_neutral_repeatability | 01 | analyst_2 | 2 | 1 | 1 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 02 | analyst_2 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 03 | analyst_3 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 04 | analyst_4 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 05 | analyst_5 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 06 | analyst_6 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 07 | analyst_8 | 2 | 1 | 1 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 08 | analyst_8 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 09 | analyst_9 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 10 | analyst_10 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 11 | analyst_11 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 12 | analyst_12 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 13 | analyst_12 | 2 | 1 | 1 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 14 | analyst_12 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 15 | analyst_11 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 16 | analyst_10 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 17 | analyst_9 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 18 | analyst_8 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 19 | analyst_6 | 2 | 1 | 1 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 20 | analyst_6 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 21 | analyst_5 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 22 | analyst_4 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 23 | analyst_3 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| first_neutral_repeatability | 24 | analyst_2 | 1 | 1 | 0 | uncertain (0.35) | uncertain (0.35) | 0.00 |
| rank16_exploratory | 01 | analyst_8 | 20 | 16 | 4 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 02 | analyst_8 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 03 | analyst_9 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 04 | analyst_10 | 19 | 16 | 6 | reject (0.68) | reject (0.68) | 0.00 |
| rank16_exploratory | 05 | analyst_11 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 06 | analyst_12 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 07 | analyst_2 | 20 | 16 | 4 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 08 | analyst_2 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 09 | analyst_3 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 10 | analyst_4 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 11 | analyst_5 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 12 | analyst_6 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 13 | analyst_6 | 20 | 16 | 4 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 14 | analyst_6 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 15 | analyst_5 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 16 | analyst_4 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 17 | analyst_3 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 18 | analyst_2 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 19 | analyst_12 | 20 | 16 | 4 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 20 | analyst_12 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 21 | analyst_11 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 22 | analyst_10 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 23 | analyst_9 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |
| rank16_exploratory | 24 | analyst_8 | 19 | 16 | 3 | uncertain (0.45) | uncertain (0.45) | 0.00 |

## Limit

A changed response is consistent with temporal provider variation or nondeterminism. It does not prove that the provider changed the model. An unchanged response does not rule out variation at another time or elsewhere in a multi-agent run.
