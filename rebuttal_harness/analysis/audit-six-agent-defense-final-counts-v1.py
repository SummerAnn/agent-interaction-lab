#!/usr/bin/env python3
"""Recover final E/R/U counts for the seven six-agent record changes.

This script makes no model or API calls. It reads the exact 84 runs selected
for Main Table 2 by the released run manifest, resolves the neutral agents
from each archived roster, and counts their latest recorded stances.
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
MANIFEST = WORKSPACE / "output" / "iclr2027_submission_bundle" / "run_manifest.json"
OUTPUT_JSON = HERE / "six-agent-defense-final-counts-v1-results.json"
OUTPUT_MD = HERE / "six-agent-defense-final-counts-v1-results.md"

EXPECTED_ROWS = {
    "Standard shared memory": "shared_memory_no_correction",
    "Correct external verification": "shared_memory_gt_verification_no_correction",
    "Early correction": "shared_memory_early_correction",
    "Late correction": "shared_memory_late_correction",
    "Fading old entries": "shared_memory_decay_no_correction",
    "Current answer counts with warning": "shared_independence_aware_no_correction",
    "Earlier statement shown with warning": "shared_provenance_aware_no_correction",
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


def neutral_ids(run: dict) -> tuple[list[str], Path]:
    files = run.get("roster_files") or []
    if len(files) != 1:
        raise RuntimeError(f"Expected one roster for {run['run_id']}")
    roster_path = LAB / files[0]["path"]
    roster = read_json(roster_path)
    ids = sorted(agent["id"] for agent in roster["agents"] if agent["role"] == "neutral_agent")
    if len(ids) != 2:
        raise RuntimeError(f"Expected two neutral agents in {roster_path}, found {ids}")
    return ids, roster_path


def final_stances(db_path: Path, agent_ids: list[str]) -> dict[str, str]:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in agent_ids)
    try:
        rows = db.execute(
            f"""
            WITH ranked AS (
                SELECT agent_id, stance, step_index, state_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY agent_id
                           ORDER BY step_index DESC, state_id DESC
                       ) AS rank_in_agent
                FROM agent_claim_states
                WHERE agent_id IN ({placeholders})
            )
            SELECT agent_id, stance
            FROM ranked
            WHERE rank_in_agent = 1
            ORDER BY agent_id
            """,
            tuple(agent_ids),
        ).fetchall()
    finally:
        db.close()
    result = {row["agent_id"]: row["stance"] for row in rows}
    if set(result) != set(agent_ids):
        raise RuntimeError(f"Missing final neutral states in {db_path}: {result}")
    return result


def main() -> None:
    manifest = read_json(MANIFEST)
    tables = [table for table in manifest["tables"] if "tab:neutral_defenses_main" in table["labels"]]
    if len(tables) != 1 or tables[0].get("status") != "verified":
        raise RuntimeError("Main Table 2 is not uniquely present and verified in the run manifest")
    table = tables[0]
    if {row["label"] for row in table["rows"]} != set(EXPECTED_ROWS):
        raise RuntimeError("Main Table 2 rows do not match the locked seven-row set")

    results = []
    for row in table["rows"]:
        label = row["label"]
        runs = row["runs"]
        if len(runs) != 12 or row["reported"]["n"] != 12:
            raise RuntimeError(f"{label}: expected 12 runs")
        condition_ids = {run["condition_id"] for run in runs}
        if condition_ids != {EXPECTED_ROWS[label]}:
            raise RuntimeError(f"{label}: unexpected conditions {condition_ids}")

        counts: Counter[str] = Counter()
        run_audit = []
        for run in runs:
            db_path = LAB / run["trace_path"]
            if not db_path.is_file():
                raise FileNotFoundError(db_path)
            if sha256(db_path) != run["trace_sha256"]:
                raise RuntimeError(f"Trace checksum mismatch: {db_path}")
            ids, roster_path = neutral_ids(run)
            stances = final_stances(db_path, ids)
            counts.update(stances.values())
            run_audit.append({
                "run_id": run["run_id"],
                "trace_path": str(db_path.relative_to(WORKSPACE)),
                "trace_sha256": run["trace_sha256"],
                "roster_path": str(roster_path.relative_to(WORKSPACE)),
                "neutral_final_stances": stances,
            })

        final_counts = {
            stance: counts.get(stance, 0)
            for stance in ("endorse", "reject", "uncertain")
        }
        if sum(final_counts.values()) != 24:
            raise RuntimeError(f"{label}: counts do not sum to 24: {final_counts}")
        if final_counts["endorse"] != row["reported"]["target_endorsements"]:
            raise RuntimeError(
                f"{label}: endorsement count {final_counts['endorse']} disagrees with "
                f"Main Table 2 count {row['reported']['target_endorsements']}"
            )
        results.append({
            "label": label,
            "condition_id": EXPECTED_ROWS[label],
            "runs": 12,
            "neutral_final_judgments": 24,
            "final_counts": final_counts,
            "run_audit": run_audit,
        })

    output = {
        "status": "pass",
        "scope": (
            "Final E/R/U among the two neutral agents in the exact 84 archived runs "
            "selected for Main Table 2."
        ),
        "manifest": str(MANIFEST.relative_to(WORKSPACE)),
        "manifest_table_label": "tab:neutral_defenses_main",
        "checks": {
            "seven_expected_rows": True,
            "twelve_runs_per_row": True,
            "two_neutral_agents_per_run": True,
            "all_trace_checksums_match_manifest": True,
            "endorsement_counts_match_main_table_2": True,
            "model_or_api_calls_made": 0,
        },
        "rows": results,
    }
    OUTPUT_JSON.write_text(json.dumps(output, indent=2) + "\n")

    lines = [
        "# Final E/R/U for the seven six-agent record changes",
        "",
        output["scope"],
        "",
        "| Record version | E | R | U | Runs |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in results:
        counts = item["final_counts"]
        lines.append(
            f"| {item['label']} | {counts['endorse']} | {counts['reject']} | "
            f"{counts['uncertain']} | {item['runs']} |"
        )
    lines += [
        "",
        "## Audit",
        "",
        "The script reads the exact run IDs selected for Main Table 2 in the released run manifest. It checks every trace checksum, resolves the two neutral agents from the archived roster, and takes each agent's latest recorded stance. The recovered endorsement counts match Main Table 2 in all seven rows. The JSON records every run ID, trace path, checksum, roster path, and final neutral stance.",
        "",
        "No model or API calls are made.",
    ]
    OUTPUT_MD.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "status": "pass",
        "json": str(OUTPUT_JSON),
        "markdown": str(OUTPUT_MD),
        "rows": [{"label": row["label"], **row["final_counts"]} for row in results],
    }, indent=2))


if __name__ == "__main__":
    main()
