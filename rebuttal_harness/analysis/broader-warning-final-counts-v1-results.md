# Final E/R/U for the broader warning comparisons

The counts below come only from completed archived traces. No model or API calls are made.

## Appendix Table 44 (`tab:provenance_defense`)

| Cell | E | R | U | Runs | Final judgments |
|---|---:|---:|---:|---:|---:|
| Ego depletion \| Standard shared memory | 5 | 1 | 4 | 5 | 10 |
| Ego depletion \| Answer counts with warning | 2 | 4 | 4 | 5 | 10 |
| Ego depletion \| One statement per origin | 2 | 5 | 3 | 5 | 10 |
| Ego depletion \| Earlier statement shown with warning | 0 | 6 | 4 | 5 | 10 |
| PANDAS \| Standard shared memory | 4 | 1 | 5 | 5 | 10 |
| PANDAS \| Answer counts with warning | 4 | 1 | 5 | 5 | 10 |
| PANDAS \| One statement per origin | 3 | 2 | 5 | 5 | 10 |
| PANDAS \| Earlier statement shown with warning | 4 | 2 | 4 | 5 | 10 |
| LK-99 \| Standard shared memory | 4 | 5 | 1 | 5 | 10 |
| LK-99 \| Answer counts with warning | 0 | 7 | 3 | 5 | 10 |
| LK-99 \| One statement per origin | 0 | 7 | 3 | 5 | 10 |
| LK-99 \| Earlier statement shown with warning | 0 | 9 | 1 | 5 | 10 |
| STAP \| Standard shared memory | 1 | 6 | 3 | 5 | 10 |
| STAP \| Answer counts with warning | 0 | 10 | 0 | 5 | 10 |
| STAP \| One statement per origin | 0 | 8 | 2 | 5 | 10 |
| STAP \| Earlier statement shown with warning | 0 | 10 | 0 | 5 | 10 |
| Climate \| Standard shared memory | 0 | 9 | 1 | 5 | 10 |
| Climate \| Answer counts with warning | 0 | 10 | 0 | 5 | 10 |
| Climate \| One statement per origin | 0 | 10 | 0 | 5 | 10 |
| Climate \| Earlier statement shown with warning | 0 | 10 | 0 | 5 | 10 |
| MMR \| Standard shared memory | 0 | 10 | 0 | 5 | 10 |
| MMR \| Answer counts with warning | 0 | 10 | 0 | 5 | 10 |
| MMR \| One statement per origin | 0 | 10 | 0 | 5 | 10 |
| MMR \| Earlier statement shown with warning | 0 | 10 | 0 | 5 | 10 |

## Appendix Table 46 (`tab:provenance_numerical`)

| Cell | E | R | U | Runs | Final judgments |
|---|---:|---:|---:|---:|---:|
| Haiku 4.5 \| Standard shared memory | 24 | 7 | 5 | 12 | 36 |
| Haiku 4.5 \| Earlier-statement marker | 21 | 13 | 2 | 12 | 36 |
| Haiku 4.5 \| Marker + repetition warning | 3 | 30 | 3 | 12 | 36 |
| Ministral 8B 2512 \| Standard shared memory | 33 | 3 | 0 | 12 | 36 |
| Ministral 8B 2512 \| Earlier-statement marker | 25 | 11 | 0 | 12 | 36 |
| Ministral 8B 2512 \| Marker + repetition warning | 21 | 15 | 0 | 12 | 36 |

## Appendix Table 47 (`tab:provenance_crossmodel`)

| Cell | E | R | U | Runs | Final judgments |
|---|---:|---:|---:|---:|---:|
| Haiku \| Standard shared memory | 5 | 1 | 4 | 5 | 10 |
| Haiku \| Earlier statement shown | 3 | 5 | 2 | 5 | 10 |
| Haiku \| Earlier statement shown with warning | 0 | 6 | 4 | 5 | 10 |
| Sonnet \| Standard shared memory | 5 | 1 | 4 | 5 | 10 |
| Sonnet \| Earlier statement shown | 3 | 2 | 5 | 5 | 10 |
| Sonnet \| Earlier statement shown with warning | 0 | 2 | 8 | 5 | 10 |
| GPT-4o-mini \| Standard shared memory | 5 | 5 | 0 | 5 | 10 |
| GPT-4o-mini \| Earlier statement shown | 5 | 5 | 0 | 5 | 10 |
| GPT-4o-mini \| Earlier statement shown with warning | 2 | 7 | 1 | 5 | 10 |

## Audit

For Tables 44 and 47, the script uses the exact verified rows in the submission run manifest. For Table 46, it uses the two locked numerical cohorts in the new-appendix manifest. Every archived trace checksum matches its manifest. Tables 44 and 47 also provide archived roster checksums, which match. For Table 46, the script resolves each roster from the archived experiment configuration, records its checksum, and verifies that the run configuration names exactly one roster. Target agents are the non-contamination agents in those rosters. The script then takes each target agent's latest stance from the single claim in the trace.

Recovered endorsements match every published table cell. The JSON records every run ID, path, checksum, roster, role, and final target stance.

72 of 237 current summary files match their recorded manifest hashes. The remaining summary files do not match the hashes in that manifest. This analysis does not read them for the final counts. Every trace database still matches its recorded hash.

No cell is unresolved.
