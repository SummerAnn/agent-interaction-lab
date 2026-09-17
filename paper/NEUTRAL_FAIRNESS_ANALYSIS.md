# Identical-target fairness analysis

Twelve predeclared orders balance each agent twice across every speaking position. Six orders cluster persistent-false sources and six interleave them with targets. Every condition uses 18 false-claim calls, with three calls per agent.

| Condition | Order family | n | Mean FE_t | Contagion runs |
|---|---:|---:|---:|---:|
| chat_fully_connected_no_early_stop | clustered | 6 | 0.000 | 0/6 |
| chat_fully_connected_no_early_stop | interleaved | 6 | 0.000 | 0/6 |
| chat_fully_connected_no_early_stop | all_orders | 12 | 0.000 | 0/12 |
| personal_memory_no_correction | clustered | 6 | 0.000 | 0/6 |
| personal_memory_no_correction | interleaved | 6 | 0.000 | 0/6 |
| personal_memory_no_correction | all_orders | 12 | 0.000 | 0/12 |
| shared_memory_no_correction | clustered | 6 | 1.000 | 6/6 |
| shared_memory_no_correction | interleaved | 6 | 0.833 | 5/6 |
| shared_memory_no_correction | all_orders | 12 | 0.917 | 11/12 |

The JSON companion contains every run ID, trace checksum, call-count audit, target trajectory, first-adoption response, initial exposure count, and final adoption by speaking position.
