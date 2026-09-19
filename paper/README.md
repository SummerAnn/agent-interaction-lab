# Paper bundle

This directory is the canonical source bundle for the current ICLR manuscript.
It includes the main TeX source, appendix, bibliography, figures, compiled PDF,
and run manifests.

Compile from this directory with:

```bash
latexmk -pdf paper.tex
```

The generated `paper.pdf` is the version linked from the repository README.
`RUN_MANIFEST.md` and the JSON manifests connect reported cohorts to exact run
directories. `new_appendix_run_manifest.json` and
`open_model_visibility_manifest.json` cover the later experiments. Run
`npm run verify:release:quick` from the repository root for a coverage and
calculation check, or `npm run verify:release` for the complete trace and
checksum audit. The current paper title is "On the Effect of Shared Memory on
False Belief Lock-In in Multi-Agent Systems."
