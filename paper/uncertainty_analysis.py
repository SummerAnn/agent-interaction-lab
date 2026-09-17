#!/usr/bin/env python3
"""Recompute schedule-block sensitivity intervals from the paper run manifest.

The order schedules are controlled robustness variations, not IID samples from a
human population.  For each matched comparison, this script first averages over
the fixed task set within a schedule.  It then resamples whole schedule blocks,
preserving the pairing between conditions and the reuse of a schedule across
tasks.  The resulting percentile interval describes sensitivity to the evaluated
schedule set.  It is not a population confidence interval over tasks or models.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path
from statistics import fmean


COMPARISONS = [
    {
        "id": "neutral_shared_minus_personal",
        "label": "Neutral roster: shared minus personal",
        "table": "tab:neutral_fairness",
        "row_a": "All shared",
        "row_b": "All personal",
        "block_key": "roster",
    },
    {
        "id": "ratio_2of6_shared_minus_personal",
        "label": "2/6 adversaries: shared minus personal",
        "table": "tab:adversary_ratio",
        "row_a": "2/6 shared",
        "row_b": "2/6 personal",
        "block_key": "seed_roster",
    },
    {
        "id": "ratio_3of6_shared_minus_personal",
        "label": "3/6 adversaries: shared minus personal",
        "table": "tab:adversary_ratio",
        "row_a": "3/6 shared",
        "row_b": "3/6 personal",
        "block_key": "seed_roster",
    },
    {
        "id": "origin_tracking_naive_minus_aware",
        "label": "Origin tracking: naive minus aware",
        "table": "tab:provenance_ablation",
        "row_a": "Overall | Naive",
        "row_b": "Overall | Aware",
    },
    {
        "id": "origin_package_naive_minus_provenance_aware",
        "label": "Origin package: naive minus provenance aware",
        "table": "tab:provenance_defense",
        "row_a": "Overall | Naive",
        "row_b": "Overall | Provenance aware",
    },
    {
        "id": "origin_warning_minimal_minus_aware",
        "label": "Added warning: minimal minus aware",
        "table": "tab:provenance_ablation",
        "row_a": "Overall | Minimal",
        "row_b": "Overall | Aware",
    },
    {
        "id": "scitat_haiku_shared_minus_personal",
        "label": "SciTaT Haiku: shared minus personal",
        "table": "tab:scitat_v2",
        "row_a": "Haiku shared",
        "row_b": "Haiku personal",
    },
    {
        "id": "scitat_ministral_shared_minus_personal",
        "label": "SciTaT Ministral: shared minus personal",
        "table": "tab:scitat_v2",
        "row_a": "Mistral shared",
        "row_b": "Mistral personal",
    },
    {
        "id": "scitat_llama_shared_minus_personal",
        "label": "SciTaT Llama: shared minus personal",
        "table": "tab:scitat_v2",
        "row_a": "Llama shared",
        "row_b": "Llama personal",
    },
]


def percentile(values: list[float], probability: float) -> float:
    """Linear percentile, equivalent to NumPy's default quantile method."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def row_by_label(table: dict, label: str) -> dict:
    matches = [row for row in table["rows"] if row["label"] == label]
    if len(matches) != 1:
        raise ValueError(f"Expected one row named {label!r}, found {len(matches)}")
    return matches[0]


def schedule_blocks(row: dict, block_key: str) -> tuple[dict[str, float], dict[str, set[str]]]:
    values: dict[str, list[float]] = {}
    scenarios: dict[str, set[str]] = {}
    for run in row["runs"]:
        if block_key == "roster":
            schedule = str(run["roster_id"])
        elif block_key == "seed_roster":
            schedule = f"seed{run['seed']}::{run['roster_id']}"
        else:
            schedule = str(run["seed"])
        values.setdefault(schedule, []).append(float(run["fe_t_direct"]))
        scenarios.setdefault(schedule, set()).add(run["scenario_id"])
    return ({schedule: fmean(items) for schedule, items in values.items()}, scenarios)


def analyze_comparison(
    table: dict,
    spec: dict,
    bootstrap_draws: int,
    random_seed: int,
) -> dict:
    row_a = row_by_label(table, spec["row_a"])
    row_b = row_by_label(table, spec["row_b"])
    block_key = spec.get("block_key", "seed")
    values_a, scenarios_a = schedule_blocks(row_a, block_key)
    values_b, scenarios_b = schedule_blocks(row_b, block_key)

    schedules = sorted(set(values_a) & set(values_b))
    if schedules != sorted(values_a) or schedules != sorted(values_b):
        raise ValueError(f"Unpaired schedule sets for {spec['id']}")
    for schedule in schedules:
        if scenarios_a[schedule] != scenarios_b[schedule]:
            raise ValueError(f"Unpaired task sets for {spec['id']} schedule {schedule}")

    block_differences = [values_a[schedule] - values_b[schedule] for schedule in schedules]
    estimate = fmean(block_differences)

    generator = random.Random(random_seed)
    bootstrap = [
        fmean(generator.choices(block_differences, k=len(block_differences)))
        for _ in range(bootstrap_draws)
    ]
    interval = [percentile(bootstrap, 0.025), percentile(bootstrap, 0.975)]

    if len(block_differences) > 1:
        total = sum(block_differences)
        leave_one_out = [
            (total - block_differences[index]) / (len(block_differences) - 1)
            for index in range(len(block_differences))
        ]
    else:
        leave_one_out = [estimate]

    return {
        "id": spec["id"],
        "label": spec["label"],
        "table_label": spec["table"],
        "row_a": spec["row_a"],
        "row_b": spec["row_b"],
        "schedule_block_count": len(schedules),
        "block_key": block_key,
        "fixed_task_count": len(scenarios_a[schedules[0]]),
        "delta_fe_t": estimate,
        "schedule_block_bootstrap_95_interval": interval,
        "leave_one_schedule_out_range": [min(leave_one_out), max(leave_one_out)],
        "per_schedule_differences": dict(zip(schedules, block_differences)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("run_manifest.json"))
    parser.add_argument("--output", type=Path, default=Path("uncertainty_results.json"))
    parser.add_argument("--draws", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=2027)
    args = parser.parse_args()

    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    tables = {
        label: table
        for table in manifest["tables"]
        for label in table.get("labels", [])
    }
    missing = sorted({spec["table"] for spec in COMPARISONS} - set(tables))
    if missing:
        raise ValueError(f"Missing manifest tables: {missing}")

    results = [
        analyze_comparison(tables[spec["table"]], spec, args.draws, args.seed)
        for spec in COMPARISONS
    ]
    output = {
        "method": {
            "name": "paired schedule-block nonparametric bootstrap",
            "bootstrap_draws": args.draws,
            "random_seed": args.seed,
            "interval": "2.5th and 97.5th percentiles",
            "interpretation": (
                "Sensitivity across the evaluated order schedules, conditional on the fixed "
                "tasks, models, prompts, and configurations. Not a population confidence "
                "interval over tasks or models."
            ),
        },
        "source_manifest": str(args.manifest),
        "source_manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "results": results,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")

    for result in results:
        low, high = result["schedule_block_bootstrap_95_interval"]
        loo_low, loo_high = result["leave_one_schedule_out_range"]
        print(
            f"{result['label']}: delta={result['delta_fe_t']:.3f}, "
            f"95% schedule interval=[{low:.3f}, {high:.3f}], "
            f"leave-one-out=[{loo_low:.3f}, {loo_high:.3f}]"
        )


if __name__ == "__main__":
    main()
