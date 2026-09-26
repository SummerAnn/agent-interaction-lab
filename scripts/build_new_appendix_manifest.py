#!/usr/bin/env python3
"""Build an exact trace manifest for the late appendix experiments."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


COHORTS = {
    "heterogeneous_ego_depletion": {
        "patterns": [
            "mixed_model_capability_pilot_v1_*",
            "mixed_model_confirmatory_v2_stage1_*",
            "mixed_model_confirmatory_v2_repeats_*",
        ],
        "exclude_contains": ["llama70b"],
        "expected": 324,
    },
    "heterogeneous_scitat_calculation": {
        "patterns": ["mixed_model_confirmatory_v2_second_task_*"],
        "expected": 108,
    },
    "uncertain_answer_write_rule": {
        "patterns": ["part2_neutral_write_rule_ablation_v1_*"],
        "exclude_contains": ["smoke"],
        "expected": 72,
    },
    "repetition_warning_numerical_task": {
        "patterns": ["part2_neutral_defense_second_clean_task_v1_*"],
        "exclude_contains": ["smoke"],
        "expected": 36,
    },
    "repetition_warning_numerical_task_ministral": {
        "patterns": ["part2_neutral_defense_second_clean_task_ministral_v2_*"],
        "expected": 36,
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_run(directory: Path, run_root: Path) -> dict:
    summary_path = directory / "summary.json"
    trace_path = directory / "trace.db"
    if not summary_path.exists() or not trace_path.exists():
        raise RuntimeError(f"Missing summary or trace in {directory}")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    run_id = summary.get("runId")
    if not run_id:
        raise RuntimeError(f"Missing runId in {summary_path}")
    with sqlite3.connect(trace_path) as connection:
        row = connection.execute(
            "SELECT status FROM runs WHERE status='completed' ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        calls = connection.execute(
            "SELECT COUNT(*) FROM model_calls WHERE run_id=?", (run_id,)
        ).fetchone()[0]
    if row is None or row[0] != "completed":
        raise RuntimeError(f"Run is not completed: {run_id}")
    if calls != 18:
        raise RuntimeError(f"Expected 18 model calls, found {calls}: {run_id}")
    return {
        "run_id": run_id,
        "scenario_id": summary.get("scenarioId"),
        "condition_id": summary.get("conditionId"),
        "config_id": summary.get("configId"),
        "model_calls": calls,
        "summary_path": str(summary_path.relative_to(run_root)),
        "summary_sha256": sha256(summary_path),
        "trace_path": str(trace_path.relative_to(run_root)),
        "trace_size_bytes": trace_path.stat().st_size,
        "trace_sha256": sha256(trace_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run_root = args.run_root.resolve()
    output_dir = args.output_dir.resolve()

    seen: set[str] = set()
    cohorts = {}
    for name, spec in COHORTS.items():
        directories = []
        for pattern in spec["patterns"]:
            directories.extend(path for path in run_root.glob(pattern) if path.is_dir())
        directories = [
            path
            for path in directories
            if not any(token in path.name for token in spec.get("exclude_contains", []))
        ]
        directories = sorted(set(directories))
        runs = [read_run(path, run_root) for path in directories]
        if len(runs) != spec["expected"]:
            raise RuntimeError(f"{name}: expected {spec['expected']} runs, found {len(runs)}")
        run_ids = [run["run_id"] for run in runs]
        if len(run_ids) != len(set(run_ids)):
            raise RuntimeError(f"{name}: duplicate run IDs")
        overlap = seen.intersection(run_ids)
        if overlap:
            raise RuntimeError(f"{name}: overlaps another cohort: {sorted(overlap)[:3]}")
        seen.update(run_ids)
        cohorts[name] = {
            "run_count": len(runs),
            "all_completed": True,
            "all_have_18_model_calls": True,
            "runs": runs,
        }

    manifest = {
        "schema_version": 1,
        "purpose": "Exact run IDs and checksums for late appendix experiments.",
        "unique_run_count": len(seen),
        "cohorts": cohorts,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "new_appendix_run_manifest.json"
    json_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {json_path} with {len(seen)} unique runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
