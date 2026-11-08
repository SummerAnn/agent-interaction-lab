# Paper bundle

This directory is the canonical source bundle for the current ICLR manuscript.
It includes the main TeX source, appendix, bibliography, figures, compiled PDF,
and run manifests.

Compile from this directory with:

```bash
latexmk -pdf paper.tex
```

The generated `paper.pdf` is the version linked from the repository README.
`RUN_MANIFEST.md` documents the frozen 5,542-run base manifest. The other base
manifests bring the original release to 6,686 runs. `rebuttal_run_manifest.json`
indexes the 2,228 post-submission multi-agent runs, giving the final paper total
of 8,914. `replay_call_manifest.json` separately indexes 96 one-turn replay
calls that are not counted as multi-agent runs. See `FINAL_EVIDENCE_INDEX.md`
for the complete map. Run
`npm run verify:release:quick` from the repository root for a coverage and
calculation check, or `npm run verify:release` for the complete trace and
checksum audit. The current paper title is "On the Effect of Shared Memory on
False-Belief Lock-In in Multi-Agent Systems."
