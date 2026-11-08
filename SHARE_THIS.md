# What to share for independent fact-checking

## During anonymous ICLR review

Share only the anonymous mirror:

- https://anonymous.4open.science/r/agent-interaction-lab-341D

Do not share the named GitHub URL in OpenReview. The account name identifies an
author.

The anonymous mirror tracks the GitHub repository. After the final GitHub
release is pushed and the mirror refreshes, reviewers can download the complete
repository from the anonymous page.

## With collaborators or after review

Share the named GitHub repository together with the anonymous mirror:

- https://github.com/SummerAnn/agent-interaction-lab
- https://anonymous.4open.science/r/agent-interaction-lab-341D

The GitHub repository is the source of record for code, manifests, protocols,
paper files, and audit scripts. The published release must also contain the two
raw-trace directories, `output/` and `rebuttal_harness/output/`, so the
anonymous mirror remains independently verifiable.

## Fact-checking steps

From the root of the complete downloaded release:

1. Read `paper/FINAL_EVIDENCE_INDEX.md` for the 8,914-run accounting.
2. Inspect the JSON manifests under `paper/` for exact run IDs, paths, and
   hashes.
3. Run:

   ```bash
   python3 scripts/verify_release.py --repo . --full
   ```

4. Check `analysis/release_audit.md`. The final audit should report:

   - status: PASS
   - claimed runs: 8,914
   - missing summaries: 0
   - missing traces: 0
   - SHA-256 trace/summary pairs checked: 8,826
   - SQLite traces checked: 8,914
   - one-turn replay calls excluded from the run total: 96
   - errors: 0

The 8,914 total is 6,686 original runs plus 2,228 follow-up runs. The replay
studies contain 96 additional one-turn calls and are intentionally counted
separately.
