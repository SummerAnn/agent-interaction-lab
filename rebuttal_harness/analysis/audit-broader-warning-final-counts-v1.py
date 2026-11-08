#!/usr/bin/env python3
"""Recover final E/R/U counts for the broader warning comparisons.

This script makes no model or API calls. It reads the exact archived runs for
Appendix Tables 44, 46, and 47, verifies their saved checksums, resolves the
agents whose judgments the tables report from the archived rosters, and counts
each agent's latest stance.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from pathlib import Path


HERE = Path(__file__).resolve().parent
WORKSPACE = Path(__file__).resolve().parents[4]
LAB = WORKSPACE / "agent-interaction-lab-update-2026-10-21"
SUBMISSION_MANIFEST = WORKSPACE / "output" / "iclr2027_submission_bundle" / "run_manifest.json"
NUMERICAL_MANIFEST = LAB / "paper" / "new_appendix_run_manifest.json"
OUTPUT_JSON = HERE / "broader-warning-final-counts-v1-results.json"
OUTPUT_MD = HERE / "broader-warning-final-counts-v1-results.md"

TABLE_SPECS = [
    {
        "number": 44,
        "label": "tab:provenance_defense",
        "expected_cells": 24,
        "judgments_per_run": 2,
    },
    {
        "number": 47,
        "label": "tab:provenance_crossmodel",
        "expected_cells": 9,
        "judgments_per_run": 2,
    },
]

NUMERICAL_COHORTS = {
    "repetition_warning_numerical_task": {
        "model": "Haiku 4.5",
        "experiment_path": "experiments/part2-neutral-defense-second-clean-task-v1.json",
    },
    "repetition_warning_numerical_task_ministral": {
        "model": "Ministral 8B 2512",
        "experiment_path": "experiments/part2-neutral-defense-second-clean-task-ministral-v1.json",
    },
}

CONDITION_LABELS = {
    "shared_memory_no_correction": "Standard shared memory",
    "shared_provenance_minimal_no_correction": "Earlier-statement marker",
    "shared_provenance_aware_no_correction": "Marker + repetition warning",
}


def read_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_checksum(path: Path, expected: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    observed = sha256(path)
    if observed != expected:
        raise RuntimeError(f"Checksum mismatch for {path}: {observed} != {expected}")


def checksum_status(path: Path, expected: str) -> dict[str, str | bool]:
    if not path.is_file():
        raise FileNotFoundError(path)
    observed = sha256(path)
    return {
        "manifest_sha256": expected,
        "observed_sha256": observed,
        "matches_manifest": observed == expected,
    }


def roster_targets(roster_path: Path, expected_count: int) -> tuple[list[str], dict[str, str]]:
    roster = read_json(roster_path)
    roles = {agent["id"]: agent["role"] for agent in roster["agents"]}
    target_ids = sorted(agent_id for agent_id, role in roles.items() if role != "contamination_agent")
    if len(target_ids) != expected_count:
        raise RuntimeError(
            f"Expected {expected_count} non-contamination agents in {roster_path}, found {target_ids}"
        )
    return target_ids, roles


def final_stances(db_path: Path, agent_ids: list[str], claim_id: str | None = None) -> dict[str, str]:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in agent_ids)
    try:
        claims = [row[0] for row in db.execute("SELECT DISTINCT claim_id FROM agent_claim_states")]
        if claim_id is None:
            if len(claims) != 1:
                raise RuntimeError(f"Expected one claim in {db_path}, found {claims}")
            claim_id = claims[0]
        elif claim_id not in claims:
            raise RuntimeError(f"Focus claim {claim_id} is absent from {db_path}: {claims}")
        rows = db.execute(
            f"""
            WITH ranked AS (
                SELECT agent_id, stance, step_index, state_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY agent_id
                           ORDER BY step_index DESC, state_id DESC
                       ) AS rank_in_agent
                FROM agent_claim_states
                WHERE agent_id IN ({placeholders}) AND claim_id = ?
            )
            SELECT agent_id, stance
            FROM ranked
            WHERE rank_in_agent = 1
            ORDER BY agent_id
            """,
            tuple(agent_ids) + (claim_id,),
        ).fetchall()
    finally:
        db.close()
    result = {row["agent_id"]: row["stance"] for row in rows}
    if set(result) != set(agent_ids):
        raise RuntimeError(f"Missing final target states in {db_path}: {result}")
    allowed = {"endorse", "reject", "uncertain"}
    if not set(result.values()) <= allowed:
        raise RuntimeError(f"Unexpected final stance in {db_path}: {result}")
    return result


def count_submission_row(row: dict, judgments_per_run: int) -> dict:
    counts: Counter[str] = Counter()
    run_audit = []
    runs = row["runs"]
    if len(runs) != row["reported"]["n"]:
        raise RuntimeError(f"{row['label']}: run count disagrees with reported n")
    for run in runs:
        trace_path = LAB / run["trace_path"]
        summary_path = LAB / run["summary_path"]
        verify_checksum(trace_path, run["trace_sha256"])
        summary_checksum = checksum_status(summary_path, run["summary_sha256"])
        roster_files = run.get("roster_files") or []
        if len(roster_files) != 1:
            raise RuntimeError(f"Expected one roster for {run['run_id']}")
        roster_path = LAB / roster_files[0]["path"]
        verify_checksum(roster_path, roster_files[0]["sha256"])
        agent_ids, roles = roster_targets(roster_path, judgments_per_run)
        stances = final_stances(trace_path, agent_ids, run.get("focus_claim_id"))
        counts.update(stances.values())
        run_audit.append(
            {
                "run_id": run["run_id"],
                "trace_path": str(trace_path.relative_to(WORKSPACE)),
                "trace_sha256": run["trace_sha256"],
                "summary_path": str(summary_path.relative_to(WORKSPACE)),
                "summary_checksum": summary_checksum,
                "roster_path": str(roster_path.relative_to(WORKSPACE)),
                "roster_sha256": roster_files[0]["sha256"],
                "roles": roles,
                "target_final_stances": stances,
            }
        )
    total = judgments_per_run * len(runs)
    final_counts = {stance: counts.get(stance, 0) for stance in ("endorse", "reject", "uncertain")}
    if sum(final_counts.values()) != total:
        raise RuntimeError(f"{row['label']}: counts do not sum to {total}: {final_counts}")
    expected_endorsements = round(row["reported"]["fe_t"] * total)
    if final_counts["endorse"] != expected_endorsements:
        raise RuntimeError(
            f"{row['label']}: {final_counts['endorse']} endorsements disagree with "
            f"reported rate {row['reported']['fe_t']} over {total} judgments"
        )
    return {
        "label": row["label"],
        "runs": len(runs),
        "target_final_judgments": total,
        "reported_endorsement_rate": row["reported"]["fe_t"],
        "final_counts": final_counts,
        "run_audit": run_audit,
    }


def submission_tables() -> list[dict]:
    manifest = read_json(SUBMISSION_MANIFEST)
    results = []
    for spec in TABLE_SPECS:
        matches = [table for table in manifest["tables"] if spec["label"] in table["labels"]]
        if len(matches) != 1 or matches[0].get("status") != "verified":
            raise RuntimeError(f"{spec['label']} is not uniquely present and verified")
        table = matches[0]
        rows = [row for row in table["rows"] if not row["label"].startswith("Overall |")]
        if len(rows) != spec["expected_cells"]:
            raise RuntimeError(
                f"{spec['label']}: expected {spec['expected_cells']} cells, found {len(rows)}"
            )
        results.append(
            {
                "table_number": spec["number"],
                "table_label": spec["label"],
                "manifest": str(SUBMISSION_MANIFEST.relative_to(WORKSPACE)),
                "rows": [count_submission_row(row, spec["judgments_per_run"]) for row in rows],
            }
        )
    return results


def numerical_rosters(experiment_path: Path) -> dict[str, Path]:
    experiment = read_json(experiment_path)
    rosters = {}
    for relative_path in experiment["rosterPaths"]:
        roster_path = LAB / relative_path
        roster_id = read_json(roster_path)["id"]
        if roster_id in rosters:
            raise RuntimeError(f"Duplicate roster ID {roster_id}")
        rosters[roster_id] = roster_path
    return rosters


def numerical_table() -> dict:
    manifest = read_json(NUMERICAL_MANIFEST)
    rows = []
    for cohort_name, spec in NUMERICAL_COHORTS.items():
        cohort = manifest["cohorts"][cohort_name]
        if cohort["run_count"] != 36 or not cohort["all_completed"] or not cohort["all_have_18_model_calls"]:
            raise RuntimeError(f"Unexpected numerical cohort status: {cohort_name}")
        experiment_path = LAB / spec["experiment_path"]
        experiment_sha = sha256(experiment_path)
        roster_paths = numerical_rosters(experiment_path)
        runs_by_condition: dict[str, list[dict]] = {condition: [] for condition in CONDITION_LABELS}
        for run in cohort["runs"]:
            if run["condition_id"] not in runs_by_condition:
                raise RuntimeError(f"Unexpected condition in {cohort_name}: {run['condition_id']}")
            runs_by_condition[run["condition_id"]].append(run)

        for condition_id, condition_label in CONDITION_LABELS.items():
            condition_runs = runs_by_condition[condition_id]
            if len(condition_runs) != 12:
                raise RuntimeError(f"{cohort_name} {condition_id}: expected 12 runs")
            counts: Counter[str] = Counter()
            run_audit = []
            for run in condition_runs:
                trace_path = LAB / "output" / run["trace_path"]
                summary_path = LAB / "output" / run["summary_path"]
                verify_checksum(trace_path, run["trace_sha256"])
                summary_checksum = checksum_status(summary_path, run["summary_sha256"])
                roster_matches = [
                    (roster_id, path)
                    for roster_id, path in roster_paths.items()
                    if run["config_id"].endswith("_" + roster_id)
                ]
                if len(roster_matches) != 1:
                    raise RuntimeError(f"Could not resolve one roster for {run['run_id']}: {roster_matches}")
                roster_id, roster_path = roster_matches[0]
                agent_ids, roles = roster_targets(roster_path, 3)
                stances = final_stances(trace_path, agent_ids)
                counts.update(stances.values())
                run_audit.append(
                    {
                        "run_id": run["run_id"],
                        "trace_path": str(trace_path.relative_to(WORKSPACE)),
                        "trace_sha256": run["trace_sha256"],
                        "summary_path": str(summary_path.relative_to(WORKSPACE)),
                        "summary_checksum": summary_checksum,
                        "experiment_path": str(experiment_path.relative_to(WORKSPACE)),
                        "experiment_sha256": experiment_sha,
                        "roster_id": roster_id,
                        "roster_path": str(roster_path.relative_to(WORKSPACE)),
                        "roster_sha256": sha256(roster_path),
                        "roles": roles,
                        "target_final_stances": stances,
                    }
                )
            final_counts = {
                stance: counts.get(stance, 0) for stance in ("endorse", "reject", "uncertain")
            }
            if sum(final_counts.values()) != 36:
                raise RuntimeError(f"{cohort_name} {condition_id}: counts do not sum to 36")
            rows.append(
                {
                    "label": f"{spec['model']} | {condition_label}",
                    "cohort": cohort_name,
                    "condition_id": condition_id,
                    "runs": 12,
                    "target_final_judgments": 36,
                    "final_counts": final_counts,
                    "run_audit": run_audit,
                }
            )

    reported_endorsements = {
        "Haiku 4.5 | Standard shared memory": 24,
        "Haiku 4.5 | Earlier-statement marker": 21,
        "Haiku 4.5 | Marker + repetition warning": 3,
        "Ministral 8B 2512 | Standard shared memory": 33,
        "Ministral 8B 2512 | Earlier-statement marker": 25,
        "Ministral 8B 2512 | Marker + repetition warning": 21,
    }
    if {row["label"] for row in rows} != set(reported_endorsements):
        raise RuntimeError("Numerical table rows do not match the locked six-row set")
    for row in rows:
        if row["final_counts"]["endorse"] != reported_endorsements[row["label"]]:
            raise RuntimeError(
                f"{row['label']}: recovered endorsements disagree with Appendix Table 46"
            )
    return {
        "table_number": 46,
        "table_label": "tab:provenance_numerical",
        "manifest": str(NUMERICAL_MANIFEST.relative_to(WORKSPACE)),
        "rows": rows,
    }


def warning_aggregates(tables: list[dict]) -> list[dict]:
    aggregates = []
    for table in tables:
        warning_rows = [
            row
            for row in table["rows"]
            if "warning" in row["label"].lower()
            or "independence-aware" in row["label"].lower()
            or "origin tracking" in row["label"].lower()
        ]
        counts: Counter[str] = Counter()
        for row in warning_rows:
            counts.update(row["final_counts"])
        aggregates.append(
            {
                "table_number": table["table_number"],
                "table_label": table["table_label"],
                "included_rows": [row["label"] for row in warning_rows],
                "final_counts": {
                    stance: counts.get(stance, 0)
                    for stance in ("endorse", "reject", "uncertain")
                },
            }
        )
    return aggregates


def write_markdown(output: dict) -> None:
    lines = [
        "# Final E/R/U for the broader warning comparisons",
        "",
        "The counts below come only from completed archived traces. No model or API calls are made.",
        "",
    ]
    for table in output["tables"]:
        lines += [
            f"## Appendix Table {table['table_number']} (`{table['table_label']}`)",
            "",
            "| Cell | E | R | U | Runs | Final judgments |",
            "|---|---:|---:|---:|---:|---:|",
        ]
        for row in table["rows"]:
            counts = row["final_counts"]
            label = row["label"].replace("|", "\\|")
            lines.append(
                f"| {label} | {counts['endorse']} | {counts['reject']} | "
                f"{counts['uncertain']} | {row['runs']} | {row['target_final_judgments']} |"
            )
        lines.append("")
    lines += [
        "## Audit",
        "",
        "For Tables 44 and 47, the script uses the exact verified rows in the submission run manifest. For Table 46, it uses the two locked numerical cohorts in the new-appendix manifest. Every archived trace checksum matches its manifest. Tables 44 and 47 also provide archived roster checksums, which match. For Table 46, the script resolves each roster from the archived experiment configuration, records its checksum, and verifies that the run configuration names exactly one roster. Target agents are the non-contamination agents in those rosters. The script then takes each target agent's latest stance from the single claim in the trace.",
        "",
        "Recovered endorsements match every published table cell. The JSON records every run ID, path, checksum, roster, role, and final target stance.",
        "",
        (
            f"{output['checks']['summary_checksums_matching_manifest']} of "
            f"{output['checks']['summary_checksums_checked']} current summary files match their "
            "recorded manifest hashes. The remaining summary files do not match the hashes in that "
            "manifest. This analysis does not read them for the final counts. Every trace database "
            "still matches its recorded hash."
        ),
        "",
        "No cell is unresolved.",
    ]
    OUTPUT_MD.write_text("\n".join(lines) + "\n")


def main() -> None:
    tables = submission_tables()
    numerical = numerical_table()
    tables.insert(1, numerical)
    summary_audits = [
        run["summary_checksum"]
        for table in tables
        for row in table["rows"]
        for run in row["run_audit"]
    ]
    summary_matches = sum(1 for item in summary_audits if item["matches_manifest"])
    summary_checksum_audit = []
    for table in tables:
        statuses = [
            run["summary_checksum"]["matches_manifest"]
            for row in table["rows"]
            for run in row["run_audit"]
        ]
        summary_checksum_audit.append(
            {
                "table_number": table["table_number"],
                "checked": len(statuses),
                "matching_manifest": sum(statuses),
                "not_matching_manifest": len(statuses) - sum(statuses),
            }
        )
    output = {
        "status": "pass",
        "scope": "Final E/R/U for every displayed cell in Appendix Tables 44, 46, and 47.",
        "checks": {
            "all_expected_cells_present": True,
            "all_trace_checksums_match_manifest": True,
            "summary_checksums_matching_manifest": summary_matches,
            "summary_checksums_checked": len(summary_audits),
            "all_summary_checksums_match_manifest": summary_matches == len(summary_audits),
            "all_archived_rosters_resolve_exactly_once": True,
            "all_target_roles_resolve": True,
            "all_endorsement_counts_match_published_cells": True,
            "unresolved_cells": 0,
            "model_or_api_calls_made": 0,
        },
        "tables": tables,
        "summary_checksum_audit": summary_checksum_audit,
        "warning_aggregates": warning_aggregates(tables),
    }
    OUTPUT_JSON.write_text(json.dumps(output, indent=2) + "\n")
    write_markdown(output)
    print(
        json.dumps(
            {
                "status": output["status"],
                "json": str(OUTPUT_JSON),
                "markdown": str(OUTPUT_MD),
                "tables": [
                    {
                        "table": table["table_number"],
                        "cells": len(table["rows"]),
                        "judgments": sum(row["target_final_judgments"] for row in table["rows"]),
                    }
                    for table in tables
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
