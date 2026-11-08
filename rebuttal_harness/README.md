# Post-submission experiment harness

This directory preserves the reduced harness used for the paper's final
follow-up studies. It remains separate from the original testbed because the
follow-up work added prompt framing, confidence display, reply affordances, and
record-removal features that should not be merged into the older engine by
overwriting whole directories.

Only the run directories selected by `paper/rebuttal_run_manifest.json` are
included under `output/`. That manifest contains exactly 2,228 unique
multi-agent runs. Preliminary, interrupted, smoke, failed-network, and
superseded runs are excluded.

The two replay studies are indexed by `paper/replay_call_manifest.json`. Their
96 one-turn calls are not part of the paper's 8,914-run total.

The `analysis/` directory contains the released audits and analysis scripts.
Paths in public JSON and Markdown files have been normalized to repository-
relative paths. The tool-result-v3 study manifest keeps the frozen pre-run
status `prepared_not_authorized`; the completed execution is documented by the
96-run audit, whose top-level `passed` field is true.

Install dependencies and run an individual released configuration from this
directory:

```bash
npm install
npx tsx src/experiments/grid.ts experiments/<configuration>.json
```

Use the manifests rather than filesystem totals when checking paper numbers.
