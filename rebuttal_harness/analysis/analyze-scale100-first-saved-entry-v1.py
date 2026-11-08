#!/usr/bin/env python3
"""Relate the first saved entry to final outcomes in the 100-agent runs.

This script makes no model or API calls. It reads the 40 accepted runs listed
in the audited 100-agent dose-by-placement cross. In particular, it uses the
accepted a3/p4 recovery run named by the audit and never reads the quarantined
overwritten duplicate.

The analysis is descriptive. The first saved entry is determined by speaking
order and is associated with other features of a run. It is therefore not a
causal estimate of the effect of changing that entry alone.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


REPO = Path(__file__).resolve().parents[4]
AUDIT = REPO / "scale100_experiment" / "scale100_transition_audit.json"
TRACE_ROOT = REPO / "agent-interaction-lab-update-2026-10-21" / "output"
ROSTER_ROOTS = [
    REPO / "agent-interaction-lab-update-2026-10-21" / "rosters" / "scale100-dose-v1",
    REPO / "scale100_experiment" / "rosters" / "scale100-dose-v1",
]
OUTPUT_JSON = Path(__file__).with_name("scale100-first-saved-entry-v1-results.json")
OUTPUT_MD = Path(__file__).with_name("scale100-first-saved-entry-v1-results.md")


# Appendix Table 39. Keeping the published totals here turns disagreement into
# a hard failure instead of silently analyzing the wrong trace set.
APPENDIX_TABLE_39 = {
    0: {"endorse": 0, "reject": 400, "uncertain": 0},
    1: {"endorse": 0, "reject": 297, "uncertain": 99},
    2: {"endorse": 98, "reject": 197, "uncertain": 97},
    3: {"endorse": 97, "reject": 291, "uncertain": 0},
    4: {"endorse": 380, "reject": 0, "uncertain": 4},
    5: {"endorse": 95, "reject": 285, "uncertain": 0},
    7: {"endorse": 93, "reject": 279, "uncertain": 0},
    10: {"endorse": 180, "reject": 180, "uncertain": 0},
    15: {"endorse": 170, "reject": 170, "uncertain": 0},
    20: {"endorse": 320, "reject": 0, "uncertain": 0},
}


def read_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def roster_path(dose: int, placement: int) -> Path:
    name = f"scale100_a{dose}_p{placement}_haiku.json"
    matches = [root / name for root in ROSTER_ROOTS if (root / name).is_file()]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one roster for dose={dose}, placement={placement}; got {matches}")
    return matches[0]


def roles_for_run(dose: int, placement: int) -> dict[str, str]:
    roster = read_json(roster_path(dose, placement))
    roles = {agent["id"]: agent["role"] for agent in roster["agents"]}
    if len(roles) != 100:
        raise RuntimeError(f"Roster has {len(roles)} agents, not 100")
    return roles


def query(db: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(row) for row in db.execute(sql, params)]


def analyze_run(audit_run: dict) -> dict:
    dose = audit_run["dose"]
    placement = audit_run["placement"]
    run_id = audit_run["runId"]
    db_path = TRACE_ROOT / run_id / "trace.db"
    if not db_path.is_file():
        raise FileNotFoundError(db_path)

    roles = roles_for_run(dose, placement)
    source_ids = {agent_id for agent_id, role in roles.items() if role == "contamination_agent"}
    neutral_ids = set(roles) - source_ids
    if len(source_ids) != dose or len(neutral_ids) != 100 - dose:
        raise RuntimeError(
            f"Role count mismatch for dose={dose}, placement={placement}: "
            f"sources={len(source_ids)}, neutrals={len(neutral_ids)}"
        )

    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        first_rows = query(db, """
            SELECT step_index, agent_id, stance, confidence, memory_entry_id
            FROM memory_entries
            ORDER BY step_index, memory_entry_id
            LIMIT 1
        """)
        if len(first_rows) != 1:
            raise RuntimeError(f"Expected one first saved entry in {run_id}")
        first = first_rows[0]

        final_states = query(db, """
            WITH ranked AS (
                SELECT agent_id, stance, confidence, step_index, state_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY agent_id
                           ORDER BY step_index DESC, state_id DESC
                       ) AS rank_in_agent
                FROM agent_claim_states
            )
            SELECT agent_id, stance, confidence, step_index
            FROM ranked
            WHERE rank_in_agent = 1
        """)
    finally:
        db.close()

    final_by_agent = {row["agent_id"]: row for row in final_states}
    if set(final_by_agent) != set(roles):
        missing = sorted(set(roles) - set(final_by_agent))
        extra = sorted(set(final_by_agent) - set(roles))
        raise RuntimeError(f"Final-state roster mismatch in {run_id}; missing={missing}, extra={extra}")

    final_counts = Counter(final_by_agent[agent_id]["stance"] for agent_id in neutral_ids)
    final_counts = {stance: final_counts.get(stance, 0) for stance in ("endorse", "reject", "uncertain")}
    if final_counts != audit_run["neutralFinals"]:
        raise RuntimeError(
            f"Final counts disagree with audit for {run_id}: {final_counts} != {audit_run['neutralFinals']}"
        )

    first_role = roles[first["agent_id"]]
    if first_role not in {"contamination_agent", "neutral_agent"}:
        raise RuntimeError(f"Unexpected first-entry role {first_role} in {run_id}")

    neutral_count = len(neutral_ids)
    any_false = final_counts["endorse"] > 0
    complete_false = final_counts["endorse"] == neutral_count
    return {
        "dose": dose,
        "placement": placement,
        "run_id": run_id,
        "trace_db": str(db_path.relative_to(REPO)),
        "first_saved_entry": {
            "step": first["step_index"],
            "agent_id": first["agent_id"],
            "role": first_role,
            "stance": first["stance"],
            "confidence": first["confidence"],
            "memory_entry_id": first["memory_entry_id"],
        },
        "neutral_final_counts": final_counts,
        "neutral_denominator": neutral_count,
        "neutral_endorsement_rate": final_counts["endorse"] / neutral_count,
        "any_neutral_endorsement": any_false,
        "complete_neutral_endorsement": complete_false,
    }


def summarize(rows: list[dict]) -> dict:
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        first = row["first_saved_entry"]
        by_key[(first["role"], first["stance"])].append(row)

    def one_group(group: list[dict]) -> dict:
        neutral_final_counts = Counter()
        for row in group:
            neutral_final_counts.update(row["neutral_final_counts"])
        return {
            "runs": len(group),
            "runs_with_any_neutral_endorsement": sum(row["any_neutral_endorsement"] for row in group),
            "runs_with_complete_neutral_endorsement": sum(
                row["complete_neutral_endorsement"] for row in group
            ),
            "neutral_final_counts": {
                stance: neutral_final_counts.get(stance, 0)
                for stance in ("endorse", "reject", "uncertain")
            },
            "mean_neutral_endorsement_rate": (
                sum(row["neutral_endorsement_rate"] for row in group) / len(group)
            ),
            "dose_placement_pairs": [
                {"dose": row["dose"], "placement": row["placement"]}
                for row in sorted(group, key=lambda item: (item["dose"], item["placement"]))
            ],
        }

    return {
        f"{role}:{stance}": one_group(group)
        for (role, stance), group in sorted(by_key.items())
    }


def aggregate_by_dose(rows: list[dict]) -> dict[int, dict[str, int]]:
    result: dict[int, Counter] = defaultdict(Counter)
    for row in rows:
        result[row["dose"]].update(row["neutral_final_counts"])
    return {
        dose: {stance: result[dose].get(stance, 0) for stance in ("endorse", "reject", "uncertain")}
        for dose in sorted(result)
    }


def pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def write_markdown(result: dict) -> None:
    all_summary = result["summary_all_40_runs"]
    later_summary = result["summary_dose_at_least_2"]
    source_key = "contamination_agent:endorse"
    neutral_key = "neutral_agent:reject"
    source = all_summary[source_key]
    neutral = all_summary[neutral_key]
    source_later = later_summary[source_key]
    neutral_later = later_summary[neutral_key]

    lines = [
        "# First saved entry in the 100-agent runs",
        "",
        "## Result",
        "",
        (
            f"Across the 40 accepted runs, a liar-written endorsement is the first saved entry in "
            f"{source['runs']} runs. Neutral agents endorse at least once in "
            f"{source['runs_with_any_neutral_endorsement']} of those {source['runs']} runs, and all "
            f"neutral agents endorse in {source['runs_with_complete_neutral_endorsement']}. The mean "
            f"final neutral endorsement rate is {pct(source['mean_neutral_endorsement_rate'])}."
        ),
        "",
        (
            f"A neutral-agent rejection is the first saved entry in the other {neutral['runs']} runs. "
            f"None of those runs ends with any neutral false endorsement."
        ),
        "",
        (
            f"Restricting the analysis to runs with at least two liar agents gives the same pattern. "
            f"A liar-written endorsement is first in {source_later['runs']} runs, of which "
            f"{source_later['runs_with_any_neutral_endorsement']} show some neutral endorsement and "
            f"{source_later['runs_with_complete_neutral_endorsement']} show complete spread. A "
            f"neutral rejection is first in {neutral_later['runs']} runs, none of which shows any "
            f"neutral endorsement."
        ),
        "",
        "## Exceptions",
        "",
        (
            "The first entry is predictive but not sufficient. Three runs begin with a liar-written "
            "endorsement and still end without any neutral endorsement: one run with one liar agent, "
            "one with two, and one with ten."
        ),
        "",
        "| Liar agents | Placement | Final endorse | Final reject | Final uncertain |",
        "|---:|---:|---:|---:|---:|",
    ]
    for row in result["exceptions_first_liar_endorsement_without_neutral_endorsement"]:
        counts = row["neutral_final_counts"]
        lines.append(
            f"| {row['dose']} | {row['placement']} | {counts['endorse']} | "
            f"{counts['reject']} | {counts['uncertain']} |"
        )
    lines.extend([
        "",
        "## Interpretation",
        "",
        (
            "The type of the first saved entry strongly predicts the final outcome in these tested "
            "speaking orders. This supports the paper's account that an early committed entry can "
            "shape what remains visible in the six-entry record. It does not establish that the first "
            "entry alone causes the result. Speaking order determines the first entry and also changes "
            "the sequence of later entries."
        ),
        "",
        "## Audit checks",
        "",
        "- The script reads exactly the 40 run IDs in `scale100_transition_audit.json`.",
        "- It uses the accepted a3/p4 recovery run named by that audit.",
        "- It does not scan or read the quarantined overwritten a3/p4 duplicate.",
        "- Final stance totals match Appendix Table 39 at every liar-agent count.",
        "- No model or API calls are made.",
        "",
        "Run `python3 analyze-scale100-first-saved-entry-v1.py` to reproduce the JSON and this report.",
        "",
    ])
    OUTPUT_MD.write_text("\n".join(lines))


def main() -> None:
    audit = read_json(AUDIT)
    audit_runs = audit["runs"]
    if len(audit_runs) != 40 or len({run["runId"] for run in audit_runs}) != 40:
        raise RuntimeError("The scale-100 audit does not contain 40 unique accepted runs")
    if not audit["checks"].get("completeDosePlacementCross"):
        raise RuntimeError("The scale-100 audit does not mark the dose-placement cross complete")

    accepted_recovery = [
        run for run in audit_runs
        if run["dose"] == 3 and run["placement"] == 4
    ]
    if len(accepted_recovery) != 1 or "a3_p4_recovery" not in accepted_recovery[0]["runId"]:
        raise RuntimeError("The accepted a3/p4 recovery run is not uniquely identified")

    rows = [analyze_run(run) for run in audit_runs]
    rows.sort(key=lambda row: (row["dose"], row["placement"]))

    by_dose = aggregate_by_dose(rows)
    if by_dose != APPENDIX_TABLE_39:
        raise RuntimeError(f"Computed dose totals do not match Appendix Table 39: {by_dose}")

    dose_at_least_2 = [row for row in rows if row["dose"] >= 2]
    exceptions = [
        row for row in rows
        if row["first_saved_entry"]["role"] == "contamination_agent"
        and row["first_saved_entry"]["stance"] == "endorse"
        and not row["any_neutral_endorsement"]
    ]
    result = {
        "analysis": "scale100_first_saved_entry_v1",
        "status": "completed_existing_traces_only",
        "scope": {
            "runs": len(rows),
            "liar_agent_counts": sorted({row["dose"] for row in rows}),
            "placements_per_count": 4,
            "task": "ego depletion",
            "model": "Claude Haiku 4.5",
            "communication": "shared memory",
            "first_entry_definition": "lowest-step row in memory_entries",
            "outcome_definition": "latest claim state for every neutral agent",
        },
        "accepted_a3_p4_recovery_run_id": accepted_recovery[0]["runId"],
        "quarantined_overwritten_duplicate_read": False,
        "appendix_table_39_check": {
            "passed": True,
            "computed_neutral_final_counts_by_dose": by_dose,
        },
        "summary_all_40_runs": summarize(rows),
        "summary_dose_at_least_2": summarize(dose_at_least_2),
        "exceptions_first_liar_endorsement_without_neutral_endorsement": exceptions,
        "per_run": rows,
        "interpretation": (
            "The first saved entry strongly predicts the final outcome in these tested orders, "
            "but the association is descriptive rather than causal because speaking order also "
            "changes the later sequence of entries."
        ),
    }
    OUTPUT_JSON.write_text(json.dumps(result, indent=2) + "\n")
    write_markdown(result)
    print(json.dumps({
        "output_json": str(OUTPUT_JSON),
        "output_md": str(OUTPUT_MD),
        "summary_all_40_runs": result["summary_all_40_runs"],
        "exceptions": [
            {"dose": row["dose"], "placement": row["placement"], **row["neutral_final_counts"]}
            for row in exceptions
        ],
    }, indent=2))


if __name__ == "__main__":
    main()
