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
directories. The sibling `agent_society_overleaf_peer_review/` directory at the
repository root is a historical snapshot, not the current source of truth.
