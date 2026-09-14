# ICLR 2027 paper source bundle

This folder is self-contained. The manuscript is anonymous and uses the ICLR 2027 conference style.

## Compile

Run either command from this folder:

```bash
latexmk -pdf paper.tex
```

or

```bash
tectonic paper.tex
```

The compiled manuscript is `paper.pdf`. The main source is `paper.tex`, and the supplementary material is in `appendix_results.tex`.

The current build is 33 pages in total, with 9 pages of main text through the conclusion.

## Included evidence index

`RUN_MANIFEST.md` and `run_manifest.json` connect reported table values to the underlying run identifiers. They are included for review and reproducibility but are not required for compilation.

The manifest was regenerated against the source in this bundle. It covers all 39 LaTeX table labels and 5,542 unique selected runs with no audit issues. Its diagnostic warnings document legacy cached SciTaT summary values and reused experiment identifiers; the final recorded agent states remain the source of truth.

## Submission note

The line `\iclrfinalcopy` remains commented out for double-blind review. Do not uncomment it unless preparing a non-anonymous final version.
