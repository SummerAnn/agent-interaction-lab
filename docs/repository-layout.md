# Repository layout

## Start here

- `README.md` explains the project and reproduces the central comparison.
- `paper/paper.pdf` is the current compiled manuscript.
- `paper/RUN_MANIFEST.md` connects reported tables to run directories.
- `docs/architecture.md` explains how configurations become audited traces.

## Experimental inputs

- `experiments/` contains factorial experiment grids.
- `conditions/` defines communication and intervention rules.
- `scenarios/` defines claims, evidence, and correct answers.
- `rosters/` defines agents, roles, models, and speaking orders.
- `run-configs/` contains individual run templates.

## Implementation

- `src/` contains the TypeScript experiment harness and terminal interface.
- `db/` contains the SQLite schema.
- `tests/` contains automated tests and architecture pointers.
- `scripts/` contains analysis, validation, and figure-generation utilities.

## Results and release artifacts

- `output/` contains immutable run directories and SQLite traces.
- `analysis/` contains derived analyses and validation reports.
- `paper/` is the canonical ICLR paper bundle.
- `testbed_image/` contains interface screenshots used by the README.
- `lab/` contains optional local experiment-index metadata created by the interface.

Only `paper/` is distributed as the manuscript source of truth. Submission
builds should always start from that directory.

## Naming

The displayed project name is **Agent Interaction Lab**. The older repository
slug and internal experiment IDs remain unchanged so that public URLs, trace
paths, and manifests stay valid.
