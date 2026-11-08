# Final E/R/U for the seven six-agent record changes

Final E/R/U among the two neutral agents in the exact 84 archived runs selected for Main Table 2.

| Record version | E | R | U | Runs |
|---|---:|---:|---:|---:|
| Standard shared memory | 23 | 0 | 1 | 12 |
| Correct external verification | 0 | 24 | 0 | 12 |
| Early correction | 0 | 9 | 15 | 12 |
| Late correction | 7 | 2 | 15 | 12 |
| Fading old entries | 17 | 1 | 6 | 12 |
| Current answer counts with warning | 0 | 1 | 23 | 12 |
| Earlier statement shown with warning | 0 | 0 | 24 | 12 |

## Audit

The script reads the exact run IDs selected for Main Table 2 in the released run manifest. It checks every trace checksum, resolves the two neutral agents from the archived roster, and takes each agent's latest recorded stance. The recovered endorsement counts match Main Table 2 in all seven rows. The JSON records every run ID, trace path, checksum, roster path, and final neutral stance.

No model or API calls are made.
