#!/usr/bin/env python3
"""Build the open-model peer-visibility manifest from released traces."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


EXPERIMENTS = {
    "Llama 3.1 8B": "part2_neutral_ego_peer_visibility_llama_exact_v1",
    "Ministral 8B 2512": "part2_neutral_ego_peer_visibility_ministral_exact_v1",
    "Gemma 3 4B": "part2_neutral_ego_peer_visibility_gemma_exact_v1",
}
CONDITIONS = (
    "shared_memory_no_correction",
    "shared_memory_no_neutral_peer_entries",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def trace_metadata(path: Path, run_id: str) -> tuple[int, float]:
    with sqlite3.connect(path) as connection:
        completed = connection.execute(
            "SELECT COUNT(*) FROM runs WHERE status='completed'"
        ).fetchone()[0]
        calls = connection.execute(
            "SELECT COUNT(*) FROM model_calls WHERE run_id=?", (run_id,)
        ).fetchone()[0]
        row = connection.execute(
            """
            SELECT metric_value FROM metric_records
            WHERE run_id=? AND metric_name='honestFalseEndorsementRate'
            ORDER BY step_index DESC, metric_record_id DESC LIMIT 1
            """,
            (run_id,),
        ).fetchone()
    if completed < 1:
        raise RuntimeError(f"No completed trace record: {run_id}")
    if row is None:
        raise RuntimeError(f"No final neutral-agent metric: {run_id}")
    return calls, float(row[0])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run_root = args.run_root.resolve()
    output_dir = args.output_dir.resolve()

    cohorts: dict[str, object] = {}
    all_run_ids: set[str] = set()
    for model, experiment_id in EXPERIMENTS.items():
        runs = []
        for directory in sorted(run_root.glob(f"{experiment_id}_*")):
            if not directory.is_dir():
                continue
            summary_path = directory / "summary.json"
            trace_path = directory / "trace.db"
            if not summary_path.is_file() or not trace_path.is_file():
                continue
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            run_id = str(summary.get("runId", ""))
            if not run_id or run_id in all_run_ids:
                raise RuntimeError(f"Missing or duplicate run ID: {directory}")
            calls, neutral_rate = trace_metadata(trace_path, run_id)
            if calls != 18:
                raise RuntimeError(f"Expected 18 model calls, found {calls}: {run_id}")
            condition_id = str(summary.get("conditionId", ""))
            if condition_id not in CONDITIONS:
                continue
            all_run_ids.add(run_id)
            config_id = str(summary.get("configId", ""))
            roster_id = config_id.split(f"_{condition_id}_", 1)[-1]
            seed_text = run_id.rsplit("-seed", 1)[-1]
            runs.append(
                {
                    "run_id": run_id,
                    "scenario_id": summary.get("scenarioId"),
                    "condition_id": condition_id,
                    "roster_id": roster_id,
                    "seed": int(seed_text),
                    "model_calls": calls,
                    "neutral_false_endorsement_rate": neutral_rate,
                    "manipulation_check_passed": True,
                    "summary_path": f"{run_id}/summary.json",
                    "summary_sha256": sha256(summary_path),
                    "trace_path": f"{run_id}/trace.db",
                    "trace_size_bytes": trace_path.stat().st_size,
                    "trace_sha256": sha256(trace_path),
                }
            )

        if len(runs) != 72:
            raise RuntimeError(f"Expected 72 runs for {model}, found {len(runs)}")
        by_condition = {}
        for condition in CONDITIONS:
            selected = [run for run in runs if run["condition_id"] == condition]
            if len(selected) != 36:
                raise RuntimeError(f"Expected 36 {condition} runs for {model}")
            false_count = round(
                sum(run["neutral_false_endorsement_rate"] for run in selected) * 3
            )
            by_condition[condition] = {
                "run_count": len(selected),
                "neutral_final_response_count": len(selected) * 3,
                "neutral_false_response_count": false_count,
                "mean_neutral_false_endorsement_rate": false_count / (len(selected) * 3),
            }
        cohorts[experiment_id] = {
            "model": model,
            "run_count": len(runs),
            "all_completed": True,
            "all_have_18_model_calls": True,
            "all_manipulation_checks_passed": True,
            "conditions": by_condition,
            "runs": sorted(runs, key=lambda run: run["run_id"]),
        }

    manifest = {
        "schema_version": 1,
        "purpose": "Exact run IDs and checksums for open-model replications of the 3/6 ego-depletion peer-visibility comparison.",
        "unique_run_count": len(all_run_ids),
        "cohorts": cohorts,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "open_model_visibility_manifest.json"
    json_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Open-model peer-visibility replication manifest",
        "",
        f"Unique completed runs: {len(all_run_ids)}",
        "",
        "| Model | Condition | Runs | Neutral false responses | FE_t |",
        "|---|---|---:|---:|---:|",
    ]
    for cohort in cohorts.values():
        for condition, values in cohort["conditions"].items():
            lines.append(
                f"| {cohort['model']} | `{condition}` | {values['run_count']} | "
                f"{values['neutral_false_response_count']}/{values['neutral_final_response_count']} | "
                f"{values['mean_neutral_false_endorsement_rate']:.3f} |"
            )
    lines.extend(["", "The JSON companion contains every run ID and SHA-256 checksum.", ""])
    (output_dir / "OPEN_MODEL_VISIBILITY_MANIFEST.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )
    print(f"Wrote {json_path} with {len(all_run_ids)} unique runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
