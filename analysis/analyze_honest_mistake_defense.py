#!/usr/bin/env python3
"""Audit and analyze the honest-mistake defense-preservation experiment.

The analysis treats one completed scenario-condition-seed cell as the run grain.
It uses the final SQLite state for every agent/claim pair and keeps the four
scenario blocks visible instead of presenting the 40 runs as a population
sample.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import sqlite3
from pathlib import Path
from statistics import mean


STANDARD = "shared_memory_no_correction"
DEFENSE = "shared_provenance_aware_no_correction"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def final_states(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return con.execute(
        """
        SELECT s.agent_id, s.claim_id, s.truth_label, s.stance, s.confidence
        FROM agent_claim_states AS s
        JOIN (
          SELECT agent_id, claim_id, MAX(step_index) AS final_step
          FROM agent_claim_states
          GROUP BY agent_id, claim_id
        ) AS f
          ON s.agent_id = f.agent_id
         AND s.claim_id = f.claim_id
         AND s.step_index = f.final_step
        ORDER BY s.claim_id, s.agent_id
        """
    ).fetchall()


def is_correct(row: sqlite3.Row) -> bool:
    return (row["truth_label"] == "true" and row["stance"] == "endorse") or (
        row["truth_label"] == "false" and row["stance"] == "reject"
    )


def read_cell(cell: dict) -> dict:
    summary = cell["summary"]
    db_path = Path(summary["dbPath"])
    if not db_path.is_file():
        raise AssertionError(f"missing trace: {db_path}")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    run = con.execute(
        "SELECT run_id, scenario_id, condition_id, seed, status, max_steps "
        "FROM runs ORDER BY rowid DESC LIMIT 1"
    ).fetchone()
    calls = con.execute("SELECT COUNT(*) FROM model_calls").fetchone()[0]
    interventions = con.execute("SELECT COUNT(*) FROM interventions").fetchone()[0]
    fallbacks = con.execute(
        "SELECT COUNT(*) FROM memory_entries "
        "WHERE entry_text LIKE '%[parse fallback]%' "
        "OR entry_text LIKE '%[heuristic fallback]%'"
    ).fetchone()[0]
    initial = con.execute(
        "SELECT agent_id, claim_id, truth_label, stance, confidence "
        "FROM agent_claim_states WHERE step_index=0"
    ).fetchall()
    final = final_states(con)
    con.close()

    false_claims = {row["claim_id"] for row in initial if row["truth_label"] == "false"}
    initially_wrong = [
        row
        for row in initial
        if row["truth_label"] == "false" and row["stance"] == "endorse"
    ]
    if len(false_claims) != 1:
        raise AssertionError(f"{run['run_id']}: expected one false focal claim, got {false_claims}")
    if len(initially_wrong) != 1:
        raise AssertionError(
            f"{run['run_id']}: expected one initially mistaken agent, got {len(initially_wrong)}"
        )
    focus_claim = next(iter(false_claims))
    wrong_agent = initially_wrong[0]["agent_id"]
    focus = [row for row in final if row["claim_id"] == focus_claim]
    true_claims = [row for row in final if row["truth_label"] == "true"]
    wrong_final = next(row for row in focus if row["agent_id"] == wrong_agent)
    other_focus = [row for row in focus if row["agent_id"] != wrong_agent]
    correct_confidences = [row["confidence"] for row in final if is_correct(row)]

    checks = {
        "status_complete": run["status"] == "completed",
        "summary_steps_18": summary["completedSteps"] == 18 and run["max_steps"] == 18,
        "model_calls_54": calls == 54,
        "six_agents_three_claims": summary["agentCount"] == 6 and summary["claimCount"] == 3,
        "no_scheduled_interventions": interventions == 0 and summary["correctionCount"] == 0,
        "no_parser_fallbacks": fallbacks == 0,
        "identity_matches_grid": (
            run["run_id"] == summary["runId"]
            and run["scenario_id"] == cell["scenarioId"]
            and run["condition_id"] == cell["conditionId"]
            and run["seed"] == cell["seed"]
        ),
        "manipulation_check_passed": cell["manipulationCheck"]["passed"],
    }

    return {
        "key": [cell["scenarioId"], cell["seed"]],
        "scenario": cell["scenarioId"],
        "condition": cell["conditionId"],
        "seed": cell["seed"],
        "run_id": run["run_id"],
        "db_path": str(db_path),
        "db_sha256": sha256(db_path),
        "checks": checks,
        "metrics": {
            "focus_false_rate": sum(row["stance"] == "endorse" for row in focus) / len(focus),
            "other_agent_false_rate": sum(row["stance"] == "endorse" for row in other_focus)
            / len(other_focus),
            "initially_mistaken_agent_recovered": wrong_final["stance"] == "reject",
            "all_agents_correct_on_focus": all(row["stance"] == "reject" for row in focus),
            "all_claim_accuracy": sum(is_correct(row) for row in final) / len(final),
            "true_claim_rejection_rate": sum(row["stance"] == "reject" for row in true_claims)
            / len(true_claims),
            "true_claim_uncertain_rate": sum(row["stance"] == "uncertain" for row in true_claims)
            / len(true_claims),
            "mean_confidence_when_correct": mean(correct_confidences) if correct_confidences else None,
        },
    }


def summarize(rows: list[dict]) -> dict:
    metric_names = rows[0]["metrics"].keys()
    result = {"runs": len(rows)}
    for name in metric_names:
        values = [float(row["metrics"][name]) for row in rows]
        result[name] = mean(values)
    return result


def resample_task_blocks(paired: list[dict], draws: int = 100_000) -> list[float]:
    rng = random.Random(2027)
    by_task: dict[str, list[float]] = collections.defaultdict(list)
    for row in paired:
        by_task[row["scenario"]].append(row["delta_all_claim_accuracy"])
    task_means = [mean(values) for values in by_task.values()]
    samples = []
    for _ in range(draws):
        samples.append(mean(rng.choice(task_means) for _ in task_means))
    samples.sort()
    return [samples[int(0.025 * draws)], samples[int(0.975 * draws) - 1]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--grid",
        default="output/honest_mistake_defense_preservation_v1-grid-results.json",
    )
    parser.add_argument(
        "--output-json",
        default="analysis/results/honest_mistake_defense_preservation_v1.json",
    )
    parser.add_argument(
        "--output-md",
        default="HONEST_MISTAKE_DEFENSE_RESULTS.md",
    )
    args = parser.parse_args()

    grid_path = Path(args.grid).resolve()
    payload = json.loads(grid_path.read_text())
    cells = payload["cells"]
    rows = [read_cell(cell) for cell in cells]

    expected_conditions = {STANDARD, DEFENSE}
    expected_keys = {
        (scenario, seed, condition)
        for scenario in {row["scenario"] for row in rows}
        for seed in range(1, 11)
        for condition in expected_conditions
    }
    actual_keys = {(row["scenario"], row["seed"], row["condition"]) for row in rows}
    duplicate_count = len(rows) - len(actual_keys)
    failed_checks = [
        {"run_id": row["run_id"], "failed": [name for name, ok in row["checks"].items() if not ok]}
        for row in rows
        if not all(row["checks"].values())
    ]

    if len({row["scenario"] for row in rows}) != 4:
        raise AssertionError("expected four scenarios")
    if {row["condition"] for row in rows} != expected_conditions:
        raise AssertionError("condition set does not match the planned comparison")
    if actual_keys != expected_keys or duplicate_count:
        raise AssertionError(
            f"grid mismatch: missing={len(expected_keys-actual_keys)}, "
            f"unexpected={len(actual_keys-expected_keys)}, duplicates={duplicate_count}"
        )
    if failed_checks:
        raise AssertionError(json.dumps(failed_checks[:10], indent=2))

    grouped: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    for scenario in sorted({row["scenario"] for row in rows}):
        for condition in (STANDARD, DEFENSE):
            grouped[scenario][condition] = summarize(
                [row for row in rows if row["scenario"] == scenario and row["condition"] == condition]
            )

    overall = {
        condition: summarize([row for row in rows if row["condition"] == condition])
        for condition in (STANDARD, DEFENSE)
    }

    indexed = {(row["scenario"], row["seed"], row["condition"]): row for row in rows}
    paired = []
    for scenario, seed in sorted({(row["scenario"], row["seed"]) for row in rows}):
        standard = indexed[(scenario, seed, STANDARD)]["metrics"]
        defense = indexed[(scenario, seed, DEFENSE)]["metrics"]
        paired.append(
            {
                "scenario": scenario,
                "seed": seed,
                "delta_focus_false_rate": defense["focus_false_rate"] - standard["focus_false_rate"],
                "delta_other_agent_false_rate": defense["other_agent_false_rate"] - standard["other_agent_false_rate"],
                "delta_all_claim_accuracy": defense["all_claim_accuracy"] - standard["all_claim_accuracy"],
                "delta_true_claim_rejection_rate": defense["true_claim_rejection_rate"]
                - standard["true_claim_rejection_rate"],
            }
        )

    comparison = {
        "paired_runs": len(paired),
        "defense_minus_standard": {
            name: mean([row[name] for row in paired])
            for name in (
                "delta_focus_false_rate",
                "delta_other_agent_false_rate",
                "delta_all_claim_accuracy",
                "delta_true_claim_rejection_rate",
            )
        },
        "all_claim_accuracy_task_block_resampling_interval": resample_task_blocks(paired),
        "paired_rows": paired,
    }

    output = {
        "status": "pass",
        "scope": (
            "Claude Haiku 4.5; four fixed distributed-evidence questions; ten controlled "
            "seeds per question and memory version; six agents; three claims; 18 turns and "
            "54 model calls per run."
        ),
        "interpretation": (
            "Intervals describe sensitivity across the four evaluated question blocks. "
            "They are not population intervals over tasks or models."
        ),
        "source_grid": str(grid_path),
        "source_grid_sha256": sha256(grid_path),
        "audit": {
            "runs": len(rows),
            "unique_cells": len(actual_keys),
            "duplicates": duplicate_count,
            "failed_run_checks": failed_checks,
        },
        "by_scenario": grouped,
        "overall": overall,
        "comparison": comparison,
        "runs": rows,
    }

    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output, indent=2) + "\n")

    s = overall[STANDARD]
    d = overall[DEFENSE]
    lines = [
        "# Does the repetition warning preserve helpful correction?",
        "",
        "## Audit",
        "",
        f"All {len(rows)} planned runs passed the trace checks. Each run contains six agents, "
        "three claims, 18 completed turns, 54 model calls, no scheduled correction, and no "
        "parser fallback.",
        "",
        "## Overall results",
        "",
        "| Measure | Standard shared memory | Repetition links with warning |",
        "|---|---:|---:|",
        f"| False answers on the focal claim | {s['focus_false_rate']:.3f} | {d['focus_false_rate']:.3f} |",
        f"| Other-agent false answers | {s['other_agent_false_rate']:.3f} | {d['other_agent_false_rate']:.3f} |",
        f"| Initially mistaken agent recovers | {s['initially_mistaken_agent_recovered']:.3f} | {d['initially_mistaken_agent_recovered']:.3f} |",
        f"| All claims answered correctly | {s['all_claim_accuracy']:.3f} | {d['all_claim_accuracy']:.3f} |",
        f"| Incorrect rejection of true claims | {s['true_claim_rejection_rate']:.3f} | {d['true_claim_rejection_rate']:.3f} |",
        "",
        "The incorrect-rejection row is the prespecified check for blanket distrust. The result "
        "should be interpreted question by question as well as overall.",
        "",
        "## Scope",
        "",
        output["scope"],
        output["interpretation"],
        "",
        f"Machine-readable results: `{output_json}`",
    ]
    Path(args.output_md).write_text("\n".join(lines) + "\n")
    print(json.dumps({k: output[k] for k in ("status", "scope", "audit", "overall", "comparison")}, indent=2))


if __name__ == "__main__":
    main()
