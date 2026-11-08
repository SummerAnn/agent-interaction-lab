#!/usr/bin/env python3
"""Import the exact post-submission evidence used by the final paper.

The follow-up experiments were run in a reduced harness fork.  This importer
keeps that harness separate from the original testbed, selects only the 2,228
multi-agent runs counted by the paper, and writes portable manifests.  The two
one-turn replay studies are copied and indexed separately because they are not
multi-agent runs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


STUDIES = (
    ("record_content_short", "Record content", "Tables 18--19", "analysis/yoked-scale12-audit.json", 24),
    ("record_content_factorial", "Record content", "Table 18", "analysis/content-factorial-v1-audit.json", 576),
    ("record_content_save_uncertain", "Record content", "Table 19", "output/content_mechanism_save_uncertain_v1-grid-results.json", 24),
    ("record_content_correct_answer", "Record content", "Table 19", "analysis/correct-answer-mirror-v1-audit.json", 24),
    ("record_content_correct_recording", "Record content", "Table 19", "analysis/correct-source-recording-rule-v1-audit.json", 48),
    ("confirmatory_haiku_recording", "Confirmatory follow-ups", "Table 51", "output/core_recording_rule_interleaved_v1-grid-results.json", 96),
    ("confirmatory_pandas_recording", "Confirmatory follow-ups", "Table 51", "output/crossmodel_pandas_recording_rule_v1-grid-results.json", 96),
    ("confirmatory_scitat_recording", "Confirmatory follow-ups", "Table 51", "output/crossmodel_scitat_a_recording_rule_v1-grid-results.json", 96),
    ("confirmatory_gpt61_recording", "Confirmatory follow-ups", "Table 51", "output/frontier_gpt61_scitat_a_recording_rule_v1-grid-results.json", 48),
    ("confirmatory_reply_affordance", "Confirmatory follow-ups", "Table 52", "output/content_mechanism_reply_affordance_v2-grid-results.json", 72),
    ("confirmatory_false_tool_pilot", "Confirmatory follow-ups", "Table 53", "analysis/tool-notes-case-study-v1-audit.json", 20),
    ("debate_visibility", "Lock-in follow-ups", "Table 54", "output/debate-visibility-ablation-ego-haiku-v1-audit.json", 120),
    ("same_batch_methods", "Lock-in follow-ups", "Table 55", "analysis/experiment-b-same-batch-v1-audit.json", 144),
    ("matched_instructions_haiku", "Lock-in follow-ups", "Table 56", "analysis/prompt-frame-crossover-v2-audit.json", 192),
    ("matched_instructions_sonnet_opus", "Lock-in follow-ups", "Table 57", "analysis/prompt-frame-crossover-scitat-a-sonnet-opus-v1-audit.json", 192),
    ("correction_timing", "Lock-in follow-ups", "Table 58", "output/fair-correction-timing-haiku-v1-audit.json", 48),
    ("record_removal_two_arm", "Lock-in follow-ups", "Table 59", "analysis/record-removal-persistence-v1-audit.json", 48),
    ("record_removal_components", "Lock-in follow-ups", "Table 60", "analysis/record-removal-history-components-v2-audit.json", 96),
    ("true_answer_warnings", "Correct-answer warnings", "Table 65", "analysis/true-answer-warning-v1-audit.json", 72),
    ("confidence_display_haiku", "Confidence display", "Table 66", "analysis/confidence-display-ablation-v1-audit.json", 48),
    ("confidence_display_sonnet", "Confidence display", "Table 66", "analysis/confidence-display-ablation-sonnet-scitat-a-v1-audit.json", 48),
    ("false_tool_multitask", "False tool result", "Table 69", "analysis/tool-notes-case-study-v3-audit.json", 96),
)

GROUP_TOTALS = {
    "Record content": 696,
    "Confirmatory follow-ups": 428,
    "Lock-in follow-ups": 840,
    "Correct-answer warnings": 72,
    "Confidence display": 96,
    "False tool result": 96,
}

REPLAY_FILES = (
    "IDENTICAL_CONTEXT_REPLAY_V1_PROTOCOL.md",
    "FIRST_NEUTRAL_TEMPORAL_REPLAY_V1_PROTOCOL.md",
    "analysis/identical-context-replay-v1-manifest.json",
    "analysis/identical-context-replay-v1-results.json",
    "analysis/identical-context-replay-v1-results.md",
    "analysis/identical-context-replay-v1-common.mjs",
    "analysis/audit-identical-context-replay-v1.mjs",
    "analysis/prepare-identical-context-replay-v1.mjs",
    "analysis/first-neutral-temporal-replay-v1-manifest.json",
    "analysis/first-neutral-temporal-replay-v1-audit.json",
    "analysis/first-neutral-temporal-replay-v1-static-audit.json",
    "analysis/first-neutral-temporal-replay-v1-results.md",
    "analysis/first-neutral-temporal-replay-v1-common.mjs",
    "analysis/audit-first-neutral-temporal-replay-v1.mjs",
    "analysis/prepare-first-neutral-temporal-replay-v1.mjs",
)

DERIVED_ANALYSES = (
    "scale100-first-saved-entry-v1",
    "visible-share-existing-traces-v1",
    "confidence-trajectories-existing-traces-v1",
    "intervention-outcome-summary-v1",
    "broader-warning-final-counts-v1",
    "six-agent-defense-final-counts-v1",
    "fixed-explanation-batch-divergence-v1",
)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def collect_run_ids(value) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        run_id = value.get("runId")
        if isinstance(run_id, str):
            found.add(run_id)
        for child in value.values():
            found.update(collect_run_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(collect_run_ids(child))
    return found


def copy_text_sanitized(source: Path, destination: Path, source_root: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = source.read_text(encoding="utf-8")
    absolute = f"{source_root.resolve()}/"
    text = text.replace(absolute, "rebuttal_harness/")
    text = text.replace("followup_experiments/yoked_scale12_v1/harness/", "rebuttal_harness/")
    text = text.replace(
        'WORKSPACE / "followup_experiments" / "yoked_scale12_v1" / "harness" / ',
        'WORKSPACE / "rebuttal_harness" / ',
    )
    workspace = source_root.parents[2]
    authoritative = workspace / "authoritative_source_2026-10-21" / "source"
    text = text.replace(f"{authoritative.resolve()}/", "paper/")
    text = text.replace(f"{workspace.resolve()}/", "./")
    destination.write_text(text, encoding="utf-8")


def copy_tree_sanitized(source: Path, destination: Path, source_root: Path) -> None:
    for item in source.rglob("*"):
        if not item.is_file() or item.name == ".DS_Store":
            continue
        relative = item.relative_to(source)
        target = destination / relative
        try:
            copy_text_sanitized(item, target, source_root)
        except UnicodeDecodeError:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def trace_index(output: Path) -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = defaultdict(list)
    for trace in output.rglob("trace.db"):
        if "failed-network" in str(trace) or "output_quarantine" in str(trace):
            continue
        index[trace.parent.name].append(trace.parent)
    return index


def resolve_run(index: dict[str, list[Path]], run_id: str, study_id: str) -> Path:
    candidates = index.get(run_id, [])
    candidates = [
        item for item in candidates
        if not any(part.startswith("interrupted_") or part.startswith("failed-") for part in item.parts)
    ]
    if study_id == "false_tool_multitask":
        candidates = [item for item in candidates if "tool-notes-case-study-v3" in item.parts]
    if len(candidates) > 1:
        minimum_depth = min(len(item.parts) for item in candidates)
        candidates = [item for item in candidates if len(item.parts) == minimum_depth]
    if len(candidates) != 1:
        raise RuntimeError(f"expected one output directory for {run_id}, found {len(candidates)}")
    return candidates[0]


def model_call_count(trace: Path, run_id: str) -> int:
    with sqlite3.connect(trace) as connection:
        status = connection.execute(
            "SELECT COUNT(*) FROM runs WHERE status='completed'"
        ).fetchone()[0]
        if status < 1:
            raise RuntimeError(f"trace is not complete: {run_id}")
        return int(connection.execute(
            "SELECT COUNT(*) FROM model_calls WHERE run_id=?", (run_id,)
        ).fetchone()[0])


def copy_run_portable(
    summary_source: Path,
    trace_source: Path,
    summary_target: Path,
    trace_target: Path,
    run_id: str,
) -> dict:
    """Copy one released run without retaining a machine-specific DB path."""
    summary = read_json(summary_source)
    if summary.get("runId") != run_id:
        raise RuntimeError(f"summary run ID mismatch for {run_id}")

    portable_path = f"rebuttal_harness/output/{run_id}/trace.db"
    original_path = summary.get("dbPath")
    if isinstance(original_path, str):
        summary["dbPath"] = portable_path
    write_json(summary_target, summary)

    trace_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(trace_source, trace_target)
    if isinstance(original_path, str) and original_path != portable_path:
        with sqlite3.connect(trace_target) as connection:
            connection.execute(
                "UPDATE runs SET run_metadata_json = "
                "replace(run_metadata_json, ?, ?)",
                (original_path, portable_path),
            )
            connection.execute(
                "UPDATE metric_records SET metric_json = "
                "replace(metric_json, ?, ?)",
                (original_path, portable_path),
            )
            connection.commit()
            connection.execute("VACUUM")
    return summary


def copy_supporting_harness(source: Path, destination: Path) -> None:
    for name in ("src", "scripts", "conditions", "rosters", "scenarios", "db", "experiments"):
        copy_tree_sanitized(source / name, destination / name, source)
    for name in ("package.json", "package-lock.json"):
        copy_text_sanitized(source / name, destination / name, source)
    for protocol in source.glob("*_PROTOCOL.md"):
        copy_text_sanitized(protocol, destination / protocol.name, source)

    analysis_out = destination / "analysis"
    for script in list((source / "analysis").glob("*.mjs")) + list((source / "analysis").glob("*.py")):
        copy_text_sanitized(script, analysis_out / script.name, source)

    selected_names = {Path(item[3]).name for item in STUDIES if item[3].startswith("analysis/")}
    selected_names.update(Path(item).name for item in REPLAY_FILES if item.startswith("analysis/"))
    for prefix in DERIVED_ANALYSES:
        selected_names.update(item.name for item in (source / "analysis").glob(f"{prefix}*"))
    for name in sorted(selected_names):
        path = source / "analysis" / name
        if path.is_file():
            copy_text_sanitized(path, analysis_out / name, source)


def copy_output_metadata(source: Path, destination: Path, selected: set[str]) -> None:
    for item in (source / "output").glob("*.json"):
        try:
            ids = collect_run_ids(read_json(item))
        except json.JSONDecodeError:
            continue
        if ids.intersection(selected):
            copy_text_sanitized(item, destination / "output" / item.name, source)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="completed follow-up harness")
    parser.add_argument("--repo", type=Path, default=Path("."), help="release repository")
    args = parser.parse_args()
    source = args.source.resolve()
    repo = args.repo.resolve()
    destination = repo / "rebuttal_harness"

    study_ids: dict[str, set[str]] = {}
    all_ids: set[str] = set()
    for study_id, _group, _location, relative, expected in STUDIES:
        path = source / relative
        if not path.is_file():
            raise FileNotFoundError(path)
        ids = collect_run_ids(read_json(path))
        if len(ids) != expected:
            raise RuntimeError(f"{study_id}: selected {len(ids)} runs, expected {expected}")
        overlap = all_ids.intersection(ids)
        if overlap:
            raise RuntimeError(f"{study_id}: {len(overlap)} run IDs overlap earlier studies")
        study_ids[study_id] = ids
        all_ids.update(ids)

    if len(all_ids) != 2228:
        raise RuntimeError(f"selected {len(all_ids)} unique runs, expected 2228")

    index = trace_index(source / "output")
    copy_supporting_harness(source, destination)
    copy_output_metadata(source, destination, all_ids)

    entries = []
    studies = []
    group_counts: dict[str, int] = defaultdict(int)
    for study_id, group, location, selector, expected in STUDIES:
        studies.append({
            "study_id": study_id,
            "group": group,
            "paper_location": location,
            "run_count": expected,
            "selection_source": f"rebuttal_harness/{selector}",
        })
        group_counts[group] += expected
        for run_id in sorted(study_ids[study_id]):
            run_dir = resolve_run(index, run_id, study_id)
            summary_source = run_dir / "summary.json"
            trace_source = run_dir / "trace.db"
            if not summary_source.is_file() or not trace_source.is_file():
                raise RuntimeError(f"missing summary or trace for {run_id}")
            target_dir = destination / "output" / run_id
            target_dir.mkdir(parents=True, exist_ok=True)
            summary_target = target_dir / "summary.json"
            trace_target = target_dir / "trace.db"
            summary = copy_run_portable(
                summary_source,
                trace_source,
                summary_target,
                trace_target,
                run_id,
            )
            calls = model_call_count(trace_source, run_id)
            entries.append({
                "run_id": run_id,
                "study_id": study_id,
                "group": group,
                "paper_location": location,
                "scenario_id": summary.get("scenarioId"),
                "condition_id": summary.get("conditionId"),
                "model_calls": calls,
                "summary_path": f"rebuttal_harness/output/{run_id}/summary.json",
                "trace_path": f"rebuttal_harness/output/{run_id}/trace.db",
                "summary_sha256": sha256(summary_target),
                "trace_sha256": sha256(trace_target),
                "summary_bytes": summary_target.stat().st_size,
                "trace_bytes": trace_target.stat().st_size,
            })

    if dict(group_counts) != GROUP_TOTALS:
        raise RuntimeError(f"group totals differ: {dict(group_counts)}")

    manifest = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "description": "Exact 2,228 post-submission multi-agent runs added to the 6,686-run base release.",
        "base_run_count": 6686,
        "followup_run_count": len(entries),
        "paper_run_count": 6686 + len(entries),
        "replay_calls_excluded": 96,
        "group_counts": dict(group_counts),
        "studies": studies,
        "runs": entries,
    }
    write_json(repo / "paper/rebuttal_run_manifest.json", manifest)

    for relative in REPLAY_FILES:
        path = source / relative
        if path.is_file():
            copy_text_sanitized(path, destination / relative, source)
    replay_manifest = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "included_in_paper_run_total": False,
        "total_one_turn_calls": 96,
        "studies": [
            {
                "study_id": "identical_context_replay_v1",
                "paper_location": "Table 67",
                "one_turn_calls": 48,
                "manifest_path": "rebuttal_harness/analysis/identical-context-replay-v1-manifest.json",
                "results_path": "rebuttal_harness/analysis/identical-context-replay-v1-results.json",
            },
            {
                "study_id": "first_neutral_temporal_replay_v1",
                "paper_location": "Table 68",
                "one_turn_calls": 48,
                "manifest_path": "rebuttal_harness/analysis/first-neutral-temporal-replay-v1-manifest.json",
                "audit_path": "rebuttal_harness/analysis/first-neutral-temporal-replay-v1-audit.json",
            },
        ],
    }
    write_json(repo / "paper/replay_call_manifest.json", replay_manifest)
    print(json.dumps({
        "status": "PASS",
        "selected_runs": len(entries),
        "paper_runs": 6686 + len(entries),
        "replay_calls_excluded": 96,
        "group_counts": dict(group_counts),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
