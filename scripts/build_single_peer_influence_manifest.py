#!/usr/bin/env python3
"""Build the manifest for the single-recorded-entry experiments."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


EXPERIMENTS = (
    ("Claude Haiku 4.5", "single_peer_influence_haiku_v1", (
        "scitat_1210_single_peer_endorsement_v1",
        "scitat_1210_single_peer_uncertainty_v1",
    )),
    ("Claude Sonnet 4.6", "single_peer_influence_sonnet_v1", (
        "scitat_1210_single_peer_endorsement_v1",
        "scitat_1210_single_peer_uncertainty_v1",
    )),
    ("Claude Opus 4.6", "single_peer_influence_opus_v1", (
        "scitat_1210_single_peer_endorsement_v1",
        "scitat_1210_single_peer_uncertainty_v1",
    )),
    ("Claude Haiku 4.5", "single_peer_content_haiku_v1", (
        "scitat_1210_single_peer_endorsement_v1",
        "scitat_1210_single_peer_correct_rejection_v1",
        "scitat_1210_single_peer_evidence_correction_v1",
    )),
    ("Claude Sonnet 4.6", "single_peer_content_sonnet_v1", (
        "scitat_1210_single_peer_correct_rejection_v1",
        "scitat_1210_single_peer_evidence_correction_v1",
        "scitat_1210_single_peer_endorsement_v1",
    )),
    ("Claude Opus 4.6", "single_peer_content_opus_v1", (
        "scitat_1210_single_peer_evidence_correction_v1",
        "scitat_1210_single_peer_endorsement_v1",
        "scitat_1210_single_peer_correct_rejection_v1",
    )),
)
CONDITION = "shared_memory_no_correction"
SEED_ENTRY_ID = "seed_prior_neutral_1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def trace_counts(path: Path, run_id: str) -> dict[str, int]:
    with sqlite3.connect(path) as connection:
        completed = connection.execute(
            "SELECT COUNT(*) FROM runs WHERE status='completed'"
        ).fetchone()[0]
        calls = connection.execute(
            "SELECT COUNT(*) FROM model_calls WHERE run_id=?", (run_id,)
        ).fetchone()[0]
        seed_entries = connection.execute(
            "SELECT COUNT(*) FROM memory_entries WHERE memory_entry_id=?",
            (SEED_ENTRY_ID,),
        ).fetchone()[0]
        seed_retrievals = connection.execute(
            "SELECT COUNT(*) FROM retrieval_traces WHERE retrieved_entry_ids_json LIKE ?",
            (f"%{SEED_ENTRY_ID}%",),
        ).fetchone()[0]
        states = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index BETWEEN 1 AND 6"
        ).fetchone()[0]
        false_total = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index BETWEEN 1 AND 6 AND stance='endorse'"
        ).fetchone()[0]
        false_first = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index=1 AND stance='endorse'"
        ).fetchone()[0]
        uncertain_total = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index BETWEEN 1 AND 6 AND stance='uncertain'"
        ).fetchone()[0]
        reject_total = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index BETWEEN 1 AND 6 AND stance='reject'"
        ).fetchone()[0]
        uncertain_first = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index=1 AND stance='uncertain'"
        ).fetchone()[0]
        reject_first = connection.execute(
            "SELECT COUNT(*) FROM agent_claim_states WHERE step_index=1 AND stance='reject'"
        ).fetchone()[0]
    if completed != 1:
        raise RuntimeError(f"Expected one completed trace record for {run_id}")
    expected = {"calls": 6, "seed_entries": 1, "seed_retrievals": 6, "states": 6}
    actual = {
        "calls": calls,
        "seed_entries": seed_entries,
        "seed_retrievals": seed_retrievals,
        "states": states,
    }
    if actual != expected:
        raise RuntimeError(f"Trace audit failed for {run_id}: {actual}")
    return {
        **actual,
        "false_responses": false_total,
        "first_speaker_false": false_first,
        "uncertain_responses": uncertain_total,
        "reject_responses": reject_total,
        "first_speaker_uncertain": uncertain_first,
        "first_speaker_reject": reject_first,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run_root = args.run_root.resolve()
    output_dir = args.output_dir.resolve()

    cohorts: dict[str, object] = {}
    all_run_ids: set[str] = set()
    for model, experiment_id, scenarios in EXPERIMENTS:
        runs = []
        for directory in sorted(run_root.glob(f"{experiment_id}_*")):
            if not directory.is_dir():
                continue
            summary_path = directory / "summary.json"
            trace_path = directory / "trace.db"
            if not summary_path.is_file() or not trace_path.is_file():
                continue
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            if summary.get("scenarioId") not in scenarios:
                continue
            if summary.get("conditionId") != CONDITION:
                continue
            run_id = str(summary.get("runId", ""))
            if not run_id or run_id in all_run_ids:
                raise RuntimeError(f"Missing or duplicate run ID: {directory}")
            counts = trace_counts(trace_path, run_id)
            all_run_ids.add(run_id)
            runs.append(
                {
                    "run_id": run_id,
                    "scenario_id": summary["scenarioId"],
                    "condition_id": CONDITION,
                    "config_id": summary.get("configId"),
                    "model_calls": counts["calls"],
                    "seed_entries": counts["seed_entries"],
                    "seed_retrievals": counts["seed_retrievals"],
                    "false_responses": counts["false_responses"],
                    "first_speaker_false": counts["first_speaker_false"],
                    "uncertain_responses": counts["uncertain_responses"],
                    "reject_responses": counts["reject_responses"],
                    "first_speaker_uncertain": counts["first_speaker_uncertain"],
                    "first_speaker_reject": counts["first_speaker_reject"],
                    "summary_path": f"{run_id}/summary.json",
                    "summary_sha256": sha256(summary_path),
                    "trace_path": f"{run_id}/trace.db",
                    "trace_size_bytes": trace_path.stat().st_size,
                    "trace_sha256": sha256(trace_path),
                }
            )

        expected_runs = 12 * len(scenarios)
        if len(runs) != expected_runs:
            raise RuntimeError(f"Expected {expected_runs} runs for {experiment_id}, found {len(runs)}")
        by_scenario = {}
        for scenario in scenarios:
            selected = [run for run in runs if run["scenario_id"] == scenario]
            if len(selected) != 12:
                raise RuntimeError(f"Expected 12 {scenario} runs for {model}")
            by_scenario[scenario] = {
                "run_count": 12,
                "response_count": 72,
                "false_response_count": sum(run["false_responses"] for run in selected),
                "first_speaker_false_count": sum(run["first_speaker_false"] for run in selected),
                "uncertain_response_count": sum(run["uncertain_responses"] for run in selected),
                "reject_response_count": sum(run["reject_responses"] for run in selected),
                "first_speaker_uncertain_count": sum(run["first_speaker_uncertain"] for run in selected),
                "first_speaker_reject_count": sum(run["first_speaker_reject"] for run in selected),
                "runs_with_any_false_response": sum(run["false_responses"] > 0 for run in selected),
            }
        cohorts[experiment_id] = {
            "model": model,
            "run_count": expected_runs,
            "all_completed": True,
            "all_have_6_model_calls": True,
            "all_retrieve_seed_entry": True,
            "scenarios": by_scenario,
            "runs": sorted(runs, key=lambda run: run["run_id"]),
        }

    manifest = {
        "schema_version": 1,
        "purpose": "Exact run IDs and checksums for the all-neutral single-recorded-entry comparisons.",
        "unique_run_count": len(all_run_ids),
        "cohorts": cohorts,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "single_peer_influence_manifest.json"
    json_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Single recorded entry manifest",
        "",
        f"Unique completed runs: {len(all_run_ids)}",
        "",
        "| Model | Initial entry | Runs | All responses E/U/R | First response E/U/R |",
        "|---|---|---:|---:|---:|",
    ]
    for cohort in cohorts.values():
        for scenario, values in cohort["scenarios"].items():
            if "evidence_correction" in scenario:
                entry = "evidence-backed correction"
            elif "correct_rejection" in scenario:
                entry = "correct rejection"
            elif "endorsement" in scenario:
                entry = "endorsement repeat" if "content" in cohort.get("runs", [{}])[0].get("run_id", "") else "endorsement original"
            else:
                entry = "uncertainty"
            lines.append(
                f"| {cohort['model']} | {entry} | 12 | "
                f"{values['false_response_count']}/{values['uncertain_response_count']}/{values['reject_response_count']} | "
                f"{values['first_speaker_false_count']}/{values['first_speaker_uncertain_count']}/{values['first_speaker_reject_count']} |"
            )
    lines.extend(["", "The JSON companion contains every run ID and SHA-256 checksum.", ""])
    (output_dir / "SINGLE_PEER_INFLUENCE_MANIFEST.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )
    print(f"Wrote {json_path} with {len(all_run_ids)} unique runs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
