#!/usr/bin/env python3
"""Verify every run and calculation claimed by the released paper bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_COUNTS = {"base": 5542, "late": 576, "open": 216, "total": 6334}
SUPPLEMENTARY_CONFIGS = {
    "mixed_model_capability_pilot_v1": "experiments/mixed-model-capability-pilot-v1.json",
    "mixed_model_confirmatory_v2_stage1": "experiments/mixed-model-confirmatory-v2-stage1.json",
    "mixed_model_confirmatory_v2_repeats": "experiments/mixed-model-confirmatory-v2-repeats.json",
    "mixed_model_confirmatory_v2_second_task": "experiments/mixed-model-confirmatory-v2-second-task.json",
    "part2_neutral_write_rule_ablation_v1": "experiments/part2-neutral-write-rule-ablation-v1.json",
    "part2_neutral_defense_second_clean_task_v1": "experiments/part2-neutral-defense-second-clean-task-v1.json",
    "part2_neutral_defense_second_clean_task_ministral_v2": "experiments/part2-neutral-defense-second-clean-task-ministral-v1.json",
    "part2_neutral_ego_peer_visibility_llama_exact_v1": "experiments/part2-neutral-ego-peer-visibility-llama-exact-v1.json",
    "part2_neutral_ego_peer_visibility_ministral_exact_v1": "experiments/part2-neutral-ego-peer-visibility-ministral-exact-v1.json",
    "part2_neutral_ego_peer_visibility_gemma_exact_v1": "experiments/part2-neutral-ego-peer-visibility-gemma-exact-v1.json",
}
PAIR_PATTERN = re.compile(r"_(haiku|sonnet|opus)_to_(haiku|sonnet|opus)_(?:clustered|interleaved)_r\d+$")
EXPECTED_HETEROGENEOUS = {
    "heterogeneous_ego_depletion": {
        "haiku_to_haiku": (86, 108), "haiku_to_sonnet": (0, 108), "haiku_to_opus": (0, 108),
        "sonnet_to_haiku": (76, 108), "sonnet_to_sonnet": (0, 108), "sonnet_to_opus": (0, 108),
        "opus_to_haiku": (65, 108), "opus_to_sonnet": (0, 108), "opus_to_opus": (0, 108),
    },
    "heterogeneous_scitat_calculation": {
        "haiku_to_haiku": (29, 36), "haiku_to_sonnet": (3, 36), "haiku_to_opus": (3, 36),
        "sonnet_to_haiku": (35, 36), "sonnet_to_sonnet": (5, 36), "sonnet_to_opus": (5, 36),
        "opus_to_haiku": (30, 36), "opus_to_sonnet": (4, 36), "opus_to_opus": (2, 36),
    },
}
EXPECTED_WRITE_RULE = {
    "shared_memory_no_correction": (64, 30, 14, 108),
    "shared_memory_write_uncertain_no_correction": (0, 20, 88, 108),
}
EXPECTED_DEFENSE = {
    "repetition_warning_numerical_task": {
        "shared_memory_no_correction": (24, 36),
        "shared_provenance_minimal_no_correction": (21, 36),
        "shared_provenance_aware_no_correction": (3, 36),
    },
    "repetition_warning_numerical_task_ministral": {
        "shared_memory_no_correction": (33, 36),
        "shared_provenance_minimal_no_correction": (25, 36),
        "shared_provenance_aware_no_correction": (21, 36),
    },
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def experiment_id(run_id: str) -> str:
    candidates = sorted(SUPPLEMENTARY_CONFIGS, key=len, reverse=True)
    return next((item for item in candidates if run_id.startswith(f"{item}_")), "")


def collect_base(manifest: dict) -> dict[str, dict]:
    return {
        run["run_id"]: {**run, "manifest": "base"}
        for table in manifest["tables"]
        for row in table.get("rows", [])
        for run in row.get("runs", [])
    }


def collect_supplementary(manifest: dict, name: str) -> dict[str, dict]:
    result = {}
    for cohort_name, cohort in manifest["cohorts"].items():
        for run in cohort["runs"]:
            result[run["run_id"]] = {
                **run,
                "manifest": name,
                "cohort": cohort_name,
                "experiment_id": experiment_id(run["run_id"]),
            }
    return result


def artifact_path(repo: Path, value: str) -> Path:
    path = Path(value)
    if path.parts and path.parts[0] == "output":
        return repo / path
    return repo / "output" / path


def check_config_dependencies(repo: Path, errors: list[str]) -> int:
    checked = 0
    for expected_id, relative in SUPPLEMENTARY_CONFIGS.items():
        path = repo / relative
        if not path.is_file():
            errors.append(f"missing supplementary config: {relative}")
            continue
        payload = read_json(path)
        if payload.get("id") != expected_id:
            errors.append(f"wrong config id in {relative}: {payload.get('id')}")
        for field in ("scenarios", "conditions", "rosterPaths"):
            for raw in payload.get(field, []):
                if Path(raw).is_absolute():
                    errors.append(f"private absolute path in {relative}: {raw}")
                    continue
                if not (repo / raw).is_file():
                    errors.append(f"missing dependency for {relative}: {raw}")
                checked += 1
    return checked


def verify_trace(path: Path, run_id: str, expected_calls: int | None) -> tuple[list[str], float | None]:
    problems = []
    final_hfer = None
    try:
        with sqlite3.connect(path) as connection:
            quick = connection.execute("PRAGMA quick_check").fetchone()
            if not quick or quick[0] != "ok":
                problems.append(f"sqlite quick_check failed: {path}")
            completed = connection.execute(
                "SELECT COUNT(*) FROM runs WHERE status='completed'"
            ).fetchone()[0]
            if completed < 1:
                problems.append(f"no completed trace record: {run_id}")
            calls = connection.execute(
                "SELECT COUNT(*) FROM model_calls WHERE run_id=?", (run_id,)
            ).fetchone()[0]
            if expected_calls is not None and calls != expected_calls:
                problems.append(f"model calls {calls} != {expected_calls}: {run_id}")
            row = connection.execute(
                """
                SELECT metric_value FROM metric_records
                WHERE run_id=? AND metric_name='honestFalseEndorsementRate'
                ORDER BY step_index DESC, metric_record_id DESC LIMIT 1
                """,
                (run_id,),
            ).fetchone()
            if row is not None:
                final_hfer = float(row[0])
    except sqlite3.Error as exc:
        problems.append(f"sqlite error for {run_id}: {exc}")
    return problems, final_hfer


def recompute_late(repo: Path, manifest: dict, errors: list[str]) -> dict:
    aggregates: dict[str, object] = {}
    for cohort_name, expected in EXPECTED_HETEROGENEOUS.items():
        counts = defaultdict(lambda: [0, 0])
        for run in manifest["cohorts"][cohort_name]["runs"]:
            summary = read_json(artifact_path(repo, run["summary_path"]))
            match = PAIR_PATTERN.search(str(summary.get("configId", "")))
            if not match:
                errors.append(f"cannot parse model pair: {run['run_id']}")
                continue
            key = f"{match.group(1)}_to_{match.group(2)}"
            counts[key][0] += round(float(summary["honestFalseEndorsementRate"]) * 3)
            counts[key][1] += 3
        actual = {key: tuple(value) for key, value in sorted(counts.items())}
        aggregates[cohort_name] = actual
        if actual != expected:
            errors.append(f"aggregate mismatch for {cohort_name}: {actual}")

    write_counts = defaultdict(lambda: [0, 0, 0, 0])
    for run in manifest["cohorts"]["uncertain_answer_write_rule"]["runs"]:
        summary = read_json(artifact_path(repo, run["summary_path"]))
        values = write_counts[summary["conditionId"]]
        values[0] += round(float(summary["honestFalseEndorsementRate"]) * 3)
        values[1] += round(float(summary["finalFalseClaimRejectRate"]) * 6)
        values[2] += round(float(summary["finalUncertainRate"]) * 6)
        values[3] += 3
    write_actual = {key: tuple(value) for key, value in sorted(write_counts.items())}
    aggregates["uncertain_answer_write_rule"] = write_actual
    if write_actual != EXPECTED_WRITE_RULE:
        errors.append(f"aggregate mismatch for uncertain write rule: {write_actual}")

    for cohort_name, expected in EXPECTED_DEFENSE.items():
        counts = defaultdict(lambda: [0, 0])
        for run in manifest["cohorts"][cohort_name]["runs"]:
            summary = read_json(artifact_path(repo, run["summary_path"]))
            values = counts[summary["conditionId"]]
            values[0] += round(float(summary["honestFalseEndorsementRate"]) * 3)
            values[1] += 3
        actual = {key: tuple(value) for key, value in sorted(counts.items())}
        aggregates[cohort_name] = actual
        if actual != expected:
            errors.append(f"aggregate mismatch for {cohort_name}: {actual}")
    return aggregates


def recompute_open(repo: Path, manifest: dict, errors: list[str]) -> dict:
    aggregates = {}
    for cohort_name, cohort in manifest["cohorts"].items():
        by_condition = defaultdict(lambda: [0, 0])
        for run in cohort["runs"]:
            summary = read_json(artifact_path(repo, run["summary_path"]))
            values = by_condition[summary["conditionId"]]
            values[0] += round(float(summary["honestFalseEndorsementRate"]) * 3)
            values[1] += 3
        actual = {key: tuple(value) for key, value in sorted(by_condition.items())}
        aggregates[cohort_name] = actual
        for condition, values in cohort["conditions"].items():
            expected = (values["neutral_false_response_count"], values["neutral_final_response_count"])
            if actual.get(condition) != expected:
                errors.append(f"aggregate mismatch for {cohort_name}/{condition}: {actual.get(condition)}")
    return aggregates


def write_report(repo: Path, report: dict) -> None:
    analysis = repo / "analysis"
    analysis.mkdir(parents=True, exist_ok=True)
    (analysis / "release_audit.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    counts = report["counts"]
    lines = [
        "# Release verification",
        "",
        f"Status: **{report['status']}**",
        "",
        f"- Claimed runs: **{counts['claimed_total']}**",
        f"- Base-paper runs: **{counts['base']}**",
        f"- Late-appendix runs: **{counts['late']}**",
        f"- Open-model replication runs: **{counts['open']}**",
        f"- Missing summaries: **{counts['missing_summaries']}**",
        f"- Missing traces: **{counts['missing_traces']}**",
        f"- Verified SHA-256 pairs: **{counts['hash_pairs_checked']}**",
        f"- SQLite traces checked: **{counts['sqlite_checked']}**",
        f"- Config dependencies checked: **{counts['config_dependencies_checked']}**",
        f"- Base table calculation issues: **{counts['base_calculation_issues']}**",
        "",
        "The base manifest is rebuilt from the trace databases. Supplementary table counts are independently recomputed from released summaries, and full mode checks every released checksum and SQLite database.",
        "",
    ]
    if report["errors"]:
        lines.extend(["## Errors", ""] + [f"- {item}" for item in report["errors"]] + [""])
    (analysis / "release_audit.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--full", action="store_true", help="verify hashes and every SQLite trace")
    args = parser.parse_args()
    repo = args.repo.resolve()
    errors: list[str] = []

    with tempfile.TemporaryDirectory(prefix="agent-lab-base-audit-") as temporary:
        result = subprocess.run(
            [sys.executable, str(repo / "scripts/build_iclr_run_manifest.py"), "--repo", str(repo), "--output-dir", temporary, "--tex-dir", str(repo / "paper")],
            text=True,
            capture_output=True,
        )
        if result.returncode:
            errors.append(f"base manifest builder failed: {result.stderr.strip() or result.stdout.strip()}")
            base_manifest = {"quality_summary": {"issue_count": -1}, "tables": []}
        else:
            base_manifest = read_json(Path(temporary) / "run_manifest.json")

    late_manifest = read_json(repo / "paper/new_appendix_run_manifest.json")
    open_manifest = read_json(repo / "paper/open_model_visibility_manifest.json")
    groups = {
        "base": collect_base(base_manifest),
        "late": collect_supplementary(late_manifest, "late"),
        "open": collect_supplementary(open_manifest, "open"),
    }
    for name, expected in EXPECTED_COUNTS.items():
        actual = sum(len(group) for group in groups.values()) if name == "total" else len(groups[name])
        if actual != expected:
            errors.append(f"{name} run count {actual} != {expected}")
    all_ids = set()
    for name, group in groups.items():
        overlap = all_ids.intersection(group)
        if overlap:
            errors.append(f"{name} manifest overlaps earlier manifests: {len(overlap)} runs")
        all_ids.update(group)

    paper_text = (repo / "paper/paper.tex").read_text(encoding="utf-8") + (repo / "paper/appendix_results.tex").read_text(encoding="utf-8")
    if "6,334" not in paper_text:
        errors.append("paper no longer states the audited 6,334-run total")

    dependency_count = check_config_dependencies(repo, errors)
    missing_summaries = 0
    missing_traces = 0
    hash_pairs_checked = 0
    sqlite_checked = 0
    for index, (run_id, run) in enumerate((item for group in groups.values() for item in group.items()), start=1):
        summary_path = artifact_path(repo, run["summary_path"])
        trace_path = artifact_path(repo, run["trace_path"])
        if not summary_path.is_file():
            missing_summaries += 1
            errors.append(f"missing summary: {run_id}")
            continue
        if not trace_path.is_file():
            missing_traces += 1
            errors.append(f"missing trace: {run_id}")
            continue
        summary = read_json(summary_path)
        if summary.get("runId") != run_id:
            errors.append(f"summary run ID mismatch: {run_id}")
        if args.full:
            if sha256(summary_path) != run.get("summary_sha256"):
                errors.append(f"summary checksum mismatch: {run_id}")
            if sha256(trace_path) != run.get("trace_sha256"):
                errors.append(f"trace checksum mismatch: {run_id}")
            hash_pairs_checked += 1
            # Supplementary manifests state an exact model-call count. The base
            # corpus mixes memory and chat protocols, so its completed-step
            # field is not universally the same unit as an API call.
            expected_calls = run.get("model_calls")
            problems, final_hfer = verify_trace(trace_path, run_id, expected_calls)
            errors.extend(problems)
            sqlite_checked += 1
            if run["manifest"] != "base" and final_hfer is not None:
                cached = summary.get("honestFalseEndorsementRate")
                if cached is not None and not math.isclose(float(cached), final_hfer, abs_tol=1e-9):
                    errors.append(f"neutral FE differs between trace and summary: {run_id}")
        if index % 500 == 0:
            print(f"checked {index}/{len(all_ids)} claimed runs", flush=True)

    late_aggregates = recompute_late(repo, late_manifest, errors)
    open_aggregates = recompute_open(repo, open_manifest, errors)
    base_issues = int(base_manifest["quality_summary"].get("issue_count", -1))
    if base_issues != 0:
        errors.append(f"base table calculation audit has {base_issues} issues")

    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "full" if args.full else "quick",
        "status": "PASS" if not errors else "FAIL",
        "counts": {
            "claimed_total": len(all_ids),
            "base": len(groups["base"]),
            "late": len(groups["late"]),
            "open": len(groups["open"]),
            "missing_summaries": missing_summaries,
            "missing_traces": missing_traces,
            "hash_pairs_checked": hash_pairs_checked,
            "sqlite_checked": sqlite_checked,
            "config_dependencies_checked": dependency_count,
            "base_calculation_issues": base_issues,
        },
        "late_aggregates": late_aggregates,
        "open_aggregates": open_aggregates,
        "errors": errors,
    }
    write_report(repo, report)
    print(json.dumps({"status": report["status"], "counts": report["counts"], "error_count": len(errors)}, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
