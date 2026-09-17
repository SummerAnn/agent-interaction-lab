#!/usr/bin/env python3
"""Audit and summarize the balanced identical-target confound suite.

The report is deliberately descriptive.  The schedules are controlled order
variations at temperature zero, not independent population samples.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from statistics import fmean


GRID_FILES = [
    "output/part2_neutral_fairness_memory_v2-grid-results.json",
    "output/part2_neutral_fairness_chat_v3-grid-results.json",
    "output/part2_neutral_crossmodel_memory_v1-grid-results.json",
    "output/part2_neutral_crossmodel_chat_v1-grid-results.json",
    "output/part2_neutral_crosstopic_memory_v1-grid-results.json",
    "output/part2_neutral_crosstopic_chat_v1-grid-results.json",
    "output/part2_neutral_ratio1_balanced_memory_v1-grid-results.json",
    "output/part2_neutral_ratio1_balanced_chat_v1-grid-results.json",
    "output/part2_neutral_ratio2_balanced_memory_v1-grid-results.json",
    "output/part2_neutral_ratio2_balanced_chat_v1-grid-results.json",
    "output/part2_neutral_ratio3_balanced_memory_v1-grid-results.json",
    "output/part2_neutral_ratio3_balanced_chat_v1-grid-results.json",
    "output/part2_neutral_core_remaining_memory_v1-grid-results.json",
    "output/part2_neutral_core_remaining_chat_v1-grid-results.json",
    "output/part2_neutral_ratio1_standardized_memory_v2-grid-results.json",
    "output/part2_neutral_ratio1_standardized_chat_v2-grid-results.json",
    "output/part2_neutral_ratio2_standardized_memory_v2-grid-results.json",
    "output/part2_neutral_ratio2_standardized_chat_v2-grid-results.json",
    "output/part2_neutral_ratio3_standardized_memory_v2-grid-results.json",
    "output/part2_neutral_ratio3_standardized_chat_v2-grid-results.json",
    "output/part2_neutral_ratio4_standardized_memory_v2-grid-results.json",
    "output/part2_neutral_ratio4_standardized_chat_v2-grid-results.json",
    "output/part2_neutral_ratio1_standardized_memory_v3-grid-results.json",
    "output/part2_neutral_ratio1_standardized_chat_v3-grid-results.json",
    "output/part2_neutral_ratio2_standardized_memory_v3-grid-results.json",
    "output/part2_neutral_ratio2_standardized_chat_v3-grid-results.json",
    "output/part2_neutral_ratio3_standardized_memory_v3-grid-results.json",
    "output/part2_neutral_ratio3_standardized_chat_v3-grid-results.json",
    "output/part2_neutral_ratio4_standardized_memory_v3-grid-results.json",
    "output/part2_neutral_ratio4_standardized_chat_v3-grid-results.json",
    "output/part2_specialist_private_background_chat_v1-grid-results.json",
    "output/part2_neutral_crossmodel_weak_memory_v2-grid-results.json",
    "output/part2_neutral_crossmodel_weak_chat_v2-grid-results.json",
    "output/part2_neutral_fairness_crossmodel_memory_v2-grid-results.json",
    "output/part2_neutral_fairness_crossmodel_chat_v2-grid-results.json",
    "output/part2_neutral_fairness_crossmodel_multitask_memory_v2-grid-results.json",
    "output/part2_neutral_fairness_crossmodel_multitask_chat_v2-grid-results.json",
    "output/part2_neutral_defense_suite_v2-grid-results.json",
    "output/part2_neutral_enforced_debate_v1-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s1-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s2-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s3-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s4-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s5-grid-results.json",
    "output/part2_neutral_scitat_expanded_memory_v3_s6-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s1-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s2-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s3-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s4-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s5-grid-results.json",
    "output/part2_neutral_scitat_expanded_chat_v3_s6-grid-results.json",
]

TOPICS = {
    "ego_depletion": "ego depletion",
    "mmr": "MMR and autism",
    "climate": "climate attribution",
    "stap": "STAP cells",
    "lk99": "LK-99",
    "pandas": "PANDAS diagnosis",
}

EXPLICIT_STANCE_FIELD = re.compile(
    r'''["']?stance["']?\s*:\s*["']?(endorse|reject|uncertain)["']?''',
    re.IGNORECASE,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def order_family(roster_id: str) -> str:
    if "interleaved" in roster_id:
        return "interleaved"
    if "clustered" in roster_id:
        return "clustered"
    return "unspecified"


def protocol(condition_id: str) -> str:
    if condition_id.startswith("chat_"):
        return "debate"
    if condition_id.startswith("shared_"):
        return "shared memory"
    if condition_id.startswith("personal_"):
        return "personal memory"
    raise ValueError(f"Unknown condition: {condition_id}")


def topic(scenario_id: str) -> str:
    lowered = scenario_id.lower()
    if lowered.startswith("specialist_background_v1_ego_"):
        return "ego depletion"
    if "ego" in lowered and "ratio" in lowered:
        return "ego depletion"
    for marker, label in TOPICS.items():
        if marker in lowered:
            return label
    if "neutral_core_v1_gsm8k_" in lowered:
        return "GSM8K " + lowered.rsplit("_", 1)[-1]
    if "neutral_core_v1_gsmhard_" in lowered:
        return "GSM-Hard " + lowered.rsplit("_", 1)[-1]
    if "neutral_core_v1_scitat_1512" in lowered:
        return "SciTaT 1512.01642 q2"
    if "neutral_core_v1_scitat_math" in lowered:
        return "SciTaT math 0012242 q2"
    if "neutral_scitat_expanded_v2_blind_scitat_1512_01642" in lowered:
        return "SciTaT 1512.01642 q2"
    if "neutral_scitat_expanded_v2_blind_scitat_math_0012242" in lowered:
        return "SciTaT math 0012242 q2"
    if "neutral_scitat_expanded_v2_" in lowered:
        return scenario_id.removeprefix("neutral_scitat_expanded_v2_blind_").removesuffix("_contagion")
    raise ValueError(f"Unknown topic: {scenario_id}")


def model_label(model_name: str) -> str:
    if "haiku" in model_name:
        return "Haiku 4.5"
    if "sonnet" in model_name:
        return "Sonnet 4.6"
    if "opus" in model_name:
        return "Opus 4.6"
    if "gpt-4o-mini" in model_name:
        return "GPT-4o-mini"
    if "llama-3.1-8b" in model_name:
        return "Llama 3.1 8B"
    if "ministral-8b" in model_name:
        return "Ministral 8B"
    return model_name


def task_category(scenario_id: str) -> str:
    lowered = scenario_id.lower()
    if "gsm8k" in lowered:
        return "GSM8K"
    if "gsmhard" in lowered or "gsm_hard" in lowered:
        return "GSM-Hard"
    if "scitat" in lowered:
        return "SciTaT core subset (2)"
    return "Familiar science"


def background_arm(scenario_id: str) -> str:
    for arm in ("none", "generic", "topic"):
        if scenario_id.endswith(f"_{arm}"):
            return arm
    return "none"


def describe(values: list[float]) -> dict:
    return {
        "n": len(values),
        "mean_fe_t": fmean(values),
        "contagion_runs": sum(value > 0 for value in values),
    }


def aggregate(cells: list[dict], keys: tuple[str, ...]) -> list[dict]:
    grouped: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for cell in cells:
        grouped[tuple(str(cell[key]) for key in keys)].append(cell)
    rows = []
    for group_key, items in sorted(grouped.items()):
        values = [item["fe_t"] for item in items]
        row = {key: value for key, value in zip(keys, group_key)}
        row.update(describe(values))
        row["target_endorsements"] = sum(item["target_endorsements"] for item in items)
        row["target_opportunities"] = sum(item["target_count"] for item in items)
        row["adversary_retention"] = fmean(item["adversary_retention"] for item in items)
        rows.append(row)
    return rows


def repeat_block_summary(cells: list[dict]) -> list[dict]:
    grouped: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for cell in cells:
        grouped[(cell["adversary_count"], cell["protocol"])].append(cell)
    rows = []
    for (ratio, protocol_name), items in sorted(grouped.items()):
        by_seed: dict[int, list[float]] = defaultdict(list)
        for item in items:
            by_seed[item["seed"]].append(item["fe_t"])
        block_means = {str(seed): fmean(values) for seed, values in sorted(by_seed.items())}
        rows.append({
            "adversary_count": ratio,
            "protocol": protocol_name,
            "n": len(items),
            "pooled_mean_fe_t": fmean(item["fe_t"] for item in items),
            "repeat_block_means": block_means,
            "min_repeat_mean": min(block_means.values()),
            "max_repeat_mean": max(block_means.values()),
        })
    return rows


def fixed_pair_ratio_summary(cells: list[dict]) -> list[dict]:
    grouped: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for cell in cells:
        if cell["fixed_pair_fe_t"] is None:
            raise AssertionError(f"Analysts 5 and 6 are not both targets in {cell['run_id']}")
        grouped[(cell["adversary_count"], cell["protocol"])].append(cell)
    rows = []
    for (ratio, protocol_name), items in sorted(grouped.items()):
        rows.append({
            "adversary_count": ratio,
            "protocol": protocol_name,
            "n": len(items),
            "mean_fixed_pair_fe_t": fmean(item["fixed_pair_fe_t"] for item in items),
        })
    return rows


def paired_protocol_gaps(cells: list[dict], keys: tuple[str, ...]) -> list[dict]:
    personal = {
        (cell["scenario_id"], cell["roster_id"]): cell["fe_t"]
        for cell in cells if cell["protocol"] == "personal memory"
    }
    grouped: dict[tuple[str, ...], list[float]] = defaultdict(list)
    for cell in cells:
        if cell["protocol"] == "personal memory":
            continue
        pair_key = (cell["scenario_id"], cell["roster_id"])
        if pair_key not in personal:
            raise AssertionError(f"Missing personal pair for {pair_key}")
        group_key = tuple(str(cell[key]) for key in keys)
        grouped[group_key].append(cell["fe_t"] - personal[pair_key])
    rows = []
    for group_key, values in sorted(grouped.items()):
        row = {key: value for key, value in zip(keys, group_key)}
        row.update({"n": len(values), "mean_delta_fe_t": fmean(values)})
        rows.append(row)
    return rows


def trace_trajectories(
    db: sqlite3.Connection,
    condition_id: str,
    positions: dict[str, int],
    adversaries: set[str],
) -> list[dict]:
    trajectories = []
    for agent_id in sorted(set(positions) - adversaries):
        if condition_id.startswith("chat_"):
            observations = list(
                db.execute(
                    "SELECT message_id, round AS response_index, stance, confidence FROM chat_messages "
                    "WHERE agent_id = ? ORDER BY message_id",
                    (agent_id,),
                )
            )
            first_global_id = observations[0]["message_id"]
            visible = list(
                db.execute(
                    "SELECT agent_id FROM chat_messages WHERE message_id < ? ORDER BY message_id",
                    (first_global_id,),
                )
            )
            exposure_key = "visible_adversary_reports_before_first_response"
            exposure = sum(row["agent_id"] in adversaries for row in visible)
        else:
            observations = list(
                db.execute(
                    "SELECT state_id, step_index AS response_index, stance, confidence "
                    "FROM agent_claim_states WHERE agent_id = ? AND step_index > 0 ORDER BY state_id",
                    (agent_id,),
                )
            )
            first_step = observations[0]["response_index"]
            retrieval = db.execute(
                "SELECT retrieved_entry_ids_json FROM retrieval_traces "
                "WHERE agent_id = ? AND step_index = ?",
                (agent_id, first_step),
            ).fetchone()
            entry_ids = json.loads(retrieval[0]) if retrieval else []
            writers = []
            for entry_id in entry_ids:
                writer = db.execute(
                    "SELECT agent_id FROM memory_entries WHERE memory_entry_id = ?",
                    (entry_id,),
                ).fetchone()
                if writer:
                    writers.append(writer[0])
            exposure_key = "visible_adversary_reports_before_first_response"
            exposure = sum(writer in adversaries for writer in writers)

        if len(observations) != 3:
            raise AssertionError(f"{agent_id} has {len(observations)} responses")
        stances = [row["stance"] for row in observations]
        confidences = [row["confidence"] for row in observations]
        first_adoption = next(
            (index + 1 for index, stance in enumerate(stances) if stance == "endorse"),
            None,
        )
        trajectories.append(
            {
                "agent_id": agent_id,
                "position": positions[agent_id],
                "stances": stances,
                "confidences": confidences,
                "first_adoption_response": first_adoption,
                "final_stance": stances[-1],
                "adoption_persisted": (
                    first_adoption is not None
                    and all(stance == "endorse" for stance in stances[first_adoption - 1 :])
                ),
                exposure_key: exposure,
            }
        )
    return trajectories


def inspect_cell(cell: dict, roster: dict, repo: Path) -> dict:
    agents = roster["agents"]
    positions = {agent["id"]: index for index, agent in enumerate(agents, start=1)}
    adversaries = {agent["id"] for agent in agents if agent["role"] == "contamination_agent"}
    targets = set(positions) - adversaries
    target_roles = {agent["role"] for agent in agents if agent["id"] in targets}
    if "specialist_private_background" not in cell["grid_id"] and target_roles != {"neutral_agent"}:
        raise AssertionError(f"Non-neutral target role in {cell['summary']['runId']}: {target_roles}")
    models = {agent["model"] for agent in agents}
    if len(models) != 1:
        raise AssertionError(f"Mixed-model roster: {roster['id']}")

    recorded_db_path = Path(cell["summary"]["dbPath"])
    db_path = repo / "output" / recorded_db_path.parent.name / "trace.db"
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        call_counts = {
            row["agent_id"]: row["n"]
            for row in db.execute("SELECT agent_id, COUNT(*) AS n FROM model_calls GROUP BY agent_id")
        }
        recovery_texts = [
            row[0]
            for row in db.execute(
                "SELECT entry_text FROM memory_entries WHERE "
                "entry_text LIKE '%[parse fallback]%' OR "
                "entry_text LIKE '%[explicit stance recovery]%' OR "
                "entry_text LIKE '%[explicit refusal recovery]%' OR "
                "entry_text LIKE '%[heuristic fallback]%' "
                "UNION ALL "
                "SELECT message_text FROM chat_messages WHERE "
                "message_text LIKE '%[parse fallback]%' OR "
                "message_text LIKE '%[explicit stance recovery]%' OR "
                "message_text LIKE '%[explicit refusal recovery]%' OR "
                "message_text LIKE '%[heuristic fallback]%'"
            )
        ]
        interventions = db.execute("SELECT COUNT(*) FROM interventions").fetchone()[0]
        final_states = {
            row["agent_id"]: {"stance": row["stance"], "confidence": row["confidence"]}
            for row in db.execute(
                "SELECT s.agent_id, s.stance, s.confidence FROM agent_claim_states s "
                "JOIN (SELECT agent_id, MAX(state_id) AS max_id FROM agent_claim_states GROUP BY agent_id) m "
                "ON s.agent_id = m.agent_id AND s.state_id = m.max_id"
            )
        }
        private_seed_entries = [
            dict(row)
            for row in db.execute(
                "SELECT agent_id, claim_id, stance, confidence, visibility, source_type, entry_text "
                "FROM memory_entries WHERE step_index = 0 AND visibility = 'personal' ORDER BY memory_entry_id"
            )
        ]
        trajectories = trace_trajectories(db, cell["conditionId"], positions, adversaries)
    finally:
        db.close()

    target_endorsements = sum(final_states.get(agent, {}).get("stance") == "endorse" for agent in targets)
    adversary_endorsements = sum(final_states.get(agent, {}).get("stance") == "endorse" for agent in adversaries)
    computed_fe_t = target_endorsements / len(targets)
    reported_fe_t = cell["summary"]["honestFalseEndorsementRate"]
    if abs(computed_fe_t - reported_fe_t) > 1e-12:
        raise AssertionError(
            f"FE_t mismatch in {cell['summary']['runId']}: {computed_fe_t} != {reported_fe_t}"
        )
    if sum(call_counts.values()) != 18 or set(call_counts.values()) != {3}:
        raise AssertionError(f"Unequal call budget in {cell['summary']['runId']}: {call_counts}")
    explicit_stance_recoveries = sum(
        "[explicit stance recovery]" in text
        or ("[parse fallback]" in text and EXPLICIT_STANCE_FIELD.search(text) is not None)
        for text in recovery_texts
    )
    explicit_refusal_recoveries = sum(
        "[explicit refusal recovery]" in text for text in recovery_texts
    )
    heuristic_fallback_entries = (
        len(recovery_texts) - explicit_stance_recoveries - explicit_refusal_recoveries
    )
    if heuristic_fallback_entries:
        raise AssertionError(
            f"Heuristic parser entries in {cell['summary']['runId']}: "
            f"{heuristic_fallback_entries}"
        )
    is_defense = "neutral_defense_suite" in cell["grid_id"]
    expected_interventions = 1 if is_defense and cell["conditionId"] in {
        "shared_memory_early_correction", "shared_memory_late_correction"
    } else 0
    if interventions != expected_interventions:
        raise AssertionError(
            f"Intervention count mismatch in {cell['summary']['runId']}: "
            f"{interventions} != {expected_interventions}"
        )

    model_name = next(iter(models))
    fixed_pair = {"analyst_5", "analyst_6"}
    fixed_pair_fe_t = (
        sum(final_states.get(agent, {}).get("stance") == "endorse" for agent in fixed_pair) / 2
        if fixed_pair <= targets
        else None
    )
    return {
        "run_id": cell["summary"]["runId"],
        "grid_id": cell["grid_id"],
        "scenario_id": cell["scenarioId"],
        "condition_id": cell["conditionId"],
        "protocol": protocol(cell["conditionId"]),
        "roster_id": cell["rosterId"],
        "seed": cell["seed"],
        "order_family": order_family(cell["rosterId"]),
        "topic": topic(cell["scenarioId"]),
        "task_category": task_category(cell["scenarioId"]),
        "model": model_label(model_name),
        "model_id": model_name,
        "adversary_count": len(adversaries),
        "target_count": len(targets),
        "target_roles": sorted(target_roles),
        "fe_t": reported_fe_t,
        "target_endorsements": target_endorsements,
        "fixed_pair_fe_t": fixed_pair_fe_t,
        "adversary_retention": adversary_endorsements / len(adversaries),
        "all_agent_fe": cell["summary"]["falseClaimEndorsementRate"],
        "model_calls": 18,
        "model_calls_per_agent": call_counts,
        "explicit_stance_recoveries": explicit_stance_recoveries,
        "explicit_refusal_recoveries": explicit_refusal_recoveries,
        "heuristic_fallback_entries": heuristic_fallback_entries,
        "intervention_events": interventions,
        "analyst_5_final": final_states.get("analyst_5"),
        "analyst_6_final": final_states.get("analyst_6"),
        "analyst_5_trajectory": next(
            (trajectory for trajectory in trajectories if trajectory["agent_id"] == "analyst_5"),
            None,
        ),
        "private_seed_entries": private_seed_entries,
        "db_path": str(db_path.relative_to(repo)),
        "db_sha256": sha256(db_path),
        "trajectories": trajectories,
    }


def validate_standardized_profiles(grids: list[dict]) -> dict:
    signatures: dict[str, set[str]] = defaultdict(set)
    roster_count = 0
    for grid in grids:
        if "standardized" not in grid["grid"]["id"]:
            continue
        for roster in grid["grid"]["rosters"]:
            roster_count += 1
            for agent in roster["agents"]:
                profile = {key: value for key, value in agent.items() if key not in {"id", "role"}}
                signatures[agent["role"]].add(json.dumps(profile, sort_keys=True))
    expected_roles = {"contamination_agent", "neutral_agent"}
    if set(signatures) != expected_roles or any(len(values) != 1 for values in signatures.values()):
        raise AssertionError(f"Standardized ratio profiles differ within role: {signatures}")
    return {
        "roster_records_checked": roster_count,
        "one_profile_per_role": True,
        "roles": sorted(signatures),
    }


def validate_grid_design(grid: dict) -> dict:
    rosters = grid["grid"]["rosters"]
    by_model_and_ratio: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for roster in rosters:
        models = {agent["model"] for agent in roster["agents"]}
        adversaries = sum(agent["role"] == "contamination_agent" for agent in roster["agents"])
        if len(models) != 1:
            raise AssertionError(f"Mixed-model roster: {roster['id']}")
        by_model_and_ratio[(next(iter(models)), adversaries)].append(roster)

    balances = {}
    for (model_name, ratio), items in sorted(by_model_and_ratio.items()):
        unique = {item["id"]: item for item in items}.values()
        counts: dict[str, Counter] = defaultdict(Counter)
        for roster in unique:
            for position, agent in enumerate(roster["agents"], start=1):
                counts[agent["id"]][position] += 1
        values = {count for agent_counts in counts.values() for count in agent_counts.values()}
        missing = {
            agent: [position for position in range(1, 7) if agent_counts[position] == 0]
            for agent, agent_counts in counts.items()
            if any(agent_counts[position] == 0 for position in range(1, 7))
        }
        if missing or len(values) != 1:
            raise AssertionError(f"Unbalanced grid {grid['grid']['id']}: {counts}")
        balances[f"{model_label(model_name)}_{ratio}of6"] = {
            "unique_orders": len(list(unique)),
            "appearances_per_agent_per_position": next(iter(values)),
        }
    return balances


def trajectory_summary(cells: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for cell in cells:
        for trajectory in cell["trajectories"]:
            grouped[(cell["protocol"], cell["order_family"])].append(trajectory)
    rows = []
    for (protocol_name, family), items in sorted(grouped.items()):
        first = Counter(
            "never" if item["first_adoption_response"] is None else str(item["first_adoption_response"])
            for item in items
        )
        rows.append(
            {
                "protocol": protocol_name,
                "order_family": family,
                "target_trajectories": len(items),
                "final_adoption_rate": fmean(item["final_stance"] == "endorse" for item in items),
                "first_adoption_response_counts": dict(sorted(first.items())),
                "persistent_after_first_adoption": sum(item["adoption_persisted"] for item in items),
                "mean_adversary_reports_before_first_response": fmean(
                    item["visible_adversary_reports_before_first_response"] for item in items
                ),
                "final_adoption_by_position": {
                    str(position): {
                        "n": len(positioned := [item for item in items if item["position"] == position]),
                        "rate": fmean(item["final_stance"] == "endorse" for item in positioned),
                    }
                    for position in range(1, 7)
                },
            }
        )
    return rows


def target_order_summary(cells: list[dict]) -> dict[str, list[dict]]:
    by_position: dict[tuple[str, int], list[dict]] = defaultdict(list)
    by_exposure: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for cell in cells:
        for trajectory in cell["trajectories"]:
            by_position[(cell["protocol"], trajectory["position"])].append(trajectory)
            by_exposure[(
                cell["protocol"],
                trajectory["visible_adversary_reports_before_first_response"],
            )].append(trajectory)

    def summarize(groups: dict[tuple[str, int], list[dict]], value_name: str) -> list[dict]:
        rows = []
        for (protocol_name, value), items in sorted(groups.items()):
            rows.append({
                "protocol": protocol_name,
                value_name: value,
                "target_trajectories": len(items),
                "final_adoption_rate": fmean(item["final_stance"] == "endorse" for item in items),
                "first_response_adoption_rate": fmean(item["stances"][0] == "endorse" for item in items),
            })
        return rows

    return {
        "by_speaking_position": summarize(by_position, "speaking_position"),
        "by_visible_adversary_reports_before_first_response": summarize(
            by_exposure,
            "visible_adversary_reports_before_first_response",
        ),
    }


def specialist_summary(cells: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for cell in cells:
        role = "specialist" if "_specialist_" in cell["roster_id"] else "neutral"
        grouped[(role, background_arm(cell["scenario_id"]))].append(cell)
    rows = []
    for (role, background), items in sorted(grouped.items()):
        expected_notes = 0 if background == "none" else 1
        if any(len(item["private_seed_entries"]) != expected_notes for item in items):
            raise AssertionError(f"Private-note count mismatch for {role}/{background}")
        if any(
            entry["agent_id"] != "analyst_5" or entry["visibility"] != "personal"
            for item in items for entry in item["private_seed_entries"]
        ):
            raise AssertionError(f"Private note leaked from analyst_5 in {role}/{background}")
        rows.append({
            "analyst_5_role": role,
            "background": background,
            "n": len(items),
            "analyst_5_adoption": fmean(
                item["analyst_5_final"]["stance"] == "endorse" for item in items
            ),
            "analyst_5_first_rejection": fmean(
                item["analyst_5_trajectory"]["stances"][0] == "reject" for item in items
            ),
            "analyst_5_first_confidence": fmean(
                item["analyst_5_trajectory"]["confidences"][0] for item in items
            ),
            "analyst_6_adoption": fmean(
                item["analyst_6_final"]["stance"] == "endorse" for item in items
            ),
            "mean_fe_t": fmean(item["fe_t"] for item in items),
            "adversary_retention": fmean(item["adversary_retention"] for item in items),
        })
    return rows


def markdown_table(lines: list[str], columns: list[tuple[str, str]], rows: list[dict]) -> None:
    lines.append("| " + " | ".join(label for _, label in columns) + " |")
    lines.append("|" + "|".join("---" for _ in columns) + "|")
    for row in rows:
        values = []
        for key, _ in columns:
            value = row[key]
            if isinstance(value, float):
                values.append(f"{value:.3f}")
            else:
                values.append(str(value))
        lines.append("| " + " | ".join(values) + " |")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--paper-dir", type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    default_paper_dir = repo / "iclr2027"
    if not default_paper_dir.exists():
        default_paper_dir = repo / "paper"
    paper_dir = args.paper_dir.resolve() if args.paper_dir else default_paper_dir

    paths = [repo / relative for relative in GRID_FILES]
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        raise SystemExit("Missing completed grid files:\n" + "\n".join(missing))

    grids = [json.loads(path.read_text()) for path in paths]
    design_audits = {grid["grid"]["id"]: validate_grid_design(grid) for grid in grids}
    cells = []
    for grid in grids:
        rosters = {roster["id"]: roster for roster in grid["grid"]["rosters"]}
        for raw_cell in grid["cells"]:
            raw_cell = {**raw_cell, "grid_id": grid["grid"]["id"]}
            cells.append(inspect_cell(raw_cell, rosters[raw_cell["rosterId"]], repo))

    expected_cells = 2982
    if len(cells) != expected_cells:
        raise AssertionError(f"Expected {expected_cells} cells, found {len(cells)}")

    primary = [
        cell for cell in cells
        if cell["model"] == "Haiku 4.5"
        and cell["topic"] == "ego depletion"
        and cell["adversary_count"] == 4
        and "fairness" in cell["grid_id"]
    ]
    cross_model = [
        cell for cell in cells
        if cell["topic"] == "ego depletion" and cell["adversary_count"] == 4
        and ("crossmodel" in cell["grid_id"] or "fairness" in cell["grid_id"])
    ]
    cross_topic = [
        cell for cell in cells
        if cell["model"] == "Haiku 4.5" and cell["adversary_count"] == 4
        and ("crosstopic" in cell["grid_id"] or "fairness" in cell["grid_id"])
    ]
    ratio = [
        cell for cell in cells
        if cell["model"] == "Haiku 4.5" and cell["topic"] == "ego depletion"
        and "standardized" not in cell["grid_id"]
        and ("ratio" in cell["grid_id"] or "fairness" in cell["grid_id"])
    ]
    standardized_ratio = [cell for cell in cells if "ratio" in cell["grid_id"] and "standardized" in cell["grid_id"]]
    corrected_core_pilots = [
        cell for cell in cells
        if "neutral_scitat_expanded" in cell["grid_id"]
        and (
            "blind_scitat_1512_01642" in cell["scenario_id"]
            or "blind_scitat_math_0012242" in cell["scenario_id"]
        )
    ]
    excluded_core_pilots = [
        cell for cell in cells
        if "core_remaining" in cell["grid_id"]
        and "neutral_core_v1_scitat" in cell["scenario_id"]
    ]
    core_grid_ids = {
        "part2_neutral_fairness_memory_v2",
        "part2_neutral_fairness_chat_v3",
        "part2_neutral_crosstopic_memory_v1",
        "part2_neutral_crosstopic_chat_v1",
        "part2_neutral_core_remaining_memory_v1",
        "part2_neutral_core_remaining_chat_v1",
    }
    core_tasks = [
        cell for cell in cells
        if cell["grid_id"] in core_grid_ids
        and "neutral_core_v1_scitat" not in cell["scenario_id"]
    ] + corrected_core_pilots
    specialist = [cell for cell in cells if "specialist_private_background" in cell["grid_id"]]
    cross_model_weak = [cell for cell in cells if "crossmodel_weak" in cell["grid_id"]]
    cross_model_multitask = [
        cell for cell in cells if "fairness_crossmodel_multitask" in cell["grid_id"]
    ]
    enforced_debate = [cell for cell in cells if "enforced_debate" in cell["grid_id"]]
    neutral_defense = [cell for cell in cells if "neutral_defense_suite" in cell["grid_id"]]
    expanded_scitat = [cell for cell in cells if "neutral_scitat_expanded" in cell["grid_id"]]
    if any(abs(cell["adversary_retention"] - 1.0) > 1e-12 for cell in enforced_debate):
        raise AssertionError("An enforced debate cell has adversary retention below 1")

    report = {
        "experiment": "neutral_confound_suite_v1",
        "interpretation": (
            "Controlled descriptive evaluations at temperature zero; schedules are not treated as "
            "independent population samples."
        ),
        "audit": {
            "grid_count": len(grids),
            "run_count": len(cells),
            "all_runs_have_18_calls": all(cell["model_calls"] == 18 for cell in cells),
            "all_agents_have_3_calls": all(
                set(cell["model_calls_per_agent"].values()) == {3} for cell in cells
            ),
            "all_runs_have_zero_heuristic_fallbacks": all(
                cell["heuristic_fallback_entries"] == 0 for cell in cells
            ),
            "explicit_stance_recoveries": sum(
                cell["explicit_stance_recoveries"] for cell in cells
            ),
            "explicit_refusal_recoveries": sum(
                cell["explicit_refusal_recoveries"] for cell in cells
            ),
            "intervention_events": sum(cell["intervention_events"] for cell in cells),
            "balanced_position_designs": design_audits,
            "standardized_ratio_profiles": validate_standardized_profiles(grids),
            "excluded_completed_cells": {
                "count": len(excluded_core_pilots),
                "reason": (
                    "Two initial no-context SciTaT conversions retained an instruction referring "
                    "to supplied paper material. They are audited but excluded from every result; "
                    "the corrected v2 scenarios supply the two core-subset values."
                ),
                "run_ids": [cell["run_id"] for cell in excluded_core_pilots],
            },
            "excluded_partial_experiment_ids": [
                "part2_neutral_scitat_expanded_memory_v1",
                "part2_neutral_scitat_expanded_chat_v1",
                "part2_neutral_scitat_expanded_memory_v2",
                "part2_neutral_scitat_expanded_chat_v2",
                "part2_neutral_crossmodel_weak_memory_v1",
                "part2_neutral_crossmodel_weak_chat_v1",
                "part2_neutral_defense_correction_v1",
                "part2_neutral_defense_late_correction_v1",
                "part2_neutral_defense_verification_v1",
                "part2_neutral_defense_decay_v1",
                "part2_neutral_defense_independence_v1",
                "part2_neutral_defense_provenance_v1",
                "part2_neutral_fairness_gpt4mini_memory_v1",
                "part2_neutral_fairness_gpt4mini_chat_v1",
                "part2_neutral_fairness_gpt4mini_multitask_memory_v1",
                "part2_neutral_fairness_gpt4mini_multitask_chat_v1",
                "part2_neutral_fairness_llama8b_memory_v1",
                "part2_neutral_fairness_llama8b_chat_v1",
                "part2_neutral_fairness_llama8b_multitask_memory_v1",
                "part2_neutral_fairness_llama8b_multitask_chat_v1",
                "part2_neutral_fairness_mistral8b_memory_v1",
                "part2_neutral_fairness_mistral8b_chat_v1",
                "part2_neutral_fairness_mistral8b_multitask_memory_v1",
                "part2_neutral_fairness_mistral8b_multitask_chat_v1",
            ],
        },
        "grid_files": [
            {"path": str(path.relative_to(repo)), "sha256": sha256(path), "cells": len(grid["cells"])}
            for path, grid in zip(paths, grids)
        ],
        "primary_protocol_comparison": aggregate(primary, ("protocol", "order_family")),
        "cross_model": aggregate(cross_model, ("model", "protocol")),
        "cross_model_weak_tasks": aggregate(cross_model_weak, ("topic", "model", "protocol")),
        "cross_model_weak_task_gaps": paired_protocol_gaps(
            cross_model_weak, ("topic", "model", "protocol")
        ),
        "cross_model_multitask": aggregate(
            cross_model_multitask, ("topic", "model", "protocol")
        ),
        "cross_model_multitask_gaps": paired_protocol_gaps(
            cross_model_multitask, ("topic", "model", "protocol")
        ),
        "enforced_adversary_debate": aggregate(enforced_debate, ("model", "protocol")),
        "neutral_prompt_defenses": aggregate(neutral_defense, ("condition_id",)),
        "expanded_scitat_neutral": aggregate(expanded_scitat, ("protocol",)),
        "expanded_scitat_neutral_by_item": aggregate(expanded_scitat, ("topic", "protocol")),
        "expanded_scitat_neutral_gaps": paired_protocol_gaps(expanded_scitat, ("protocol",)),
        "cross_topic": aggregate(cross_topic, ("topic", "protocol")),
        "adversary_ratio_earlier_balanced": aggregate(ratio, ("adversary_count", "protocol")),
        "adversary_ratio_standardized": aggregate(standardized_ratio, ("adversary_count", "protocol")),
        "adversary_ratio_standardized_repeat_blocks": repeat_block_summary(standardized_ratio),
        "adversary_ratio_standardized_fixed_pair": fixed_pair_ratio_summary(standardized_ratio),
        "core_task_categories": aggregate(core_tasks, ("task_category", "protocol")),
        "core_task_category_gaps": paired_protocol_gaps(core_tasks, ("task_category", "protocol")),
        "core_tasks": aggregate(core_tasks, ("topic", "protocol")),
        "core_task_gaps": paired_protocol_gaps(core_tasks, ("topic", "protocol")),
        "specialist_background": specialist_summary(specialist),
        "primary_trajectories": trajectory_summary(primary),
        "primary_order_analysis": target_order_summary(primary),
        "runs": cells,
    }

    paper_dir.mkdir(parents=True, exist_ok=True)
    output_json = paper_dir / "neutral_confound_suite_v1.json"
    output_md = paper_dir / "NEUTRAL_CONFOUND_SUITE_V1.md"
    output_json.write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        "# Identical-target confound suite",
        "",
        "Every run has 18 false-claim calls, three per agent, and temperature zero. Orders are balanced across speaking positions. Malformed JSON is accepted only when an explicit stance field or explicit refusal preserves the judgment. No result uses generic keyword guessing. Only the early- and late-correction arms in the defense suite contain an intervention. Results are descriptive across controlled schedules.",
        "",
        "## Cross-model primary-topic replication",
        "",
    ]
    markdown_table(lines, [
        ("model", "Model"), ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"), ("contagion_runs", "Contagion runs"),
    ], report["cross_model"])
    lines.extend(["", "## Selected weak-signal tasks across models", ""])
    markdown_table(lines, [
        ("topic", "Task"), ("model", "Model"), ("protocol", "Protocol"),
        ("n", "n"), ("mean_fe_t", "Mean FE_t"),
        ("contagion_runs", "Contagion runs"),
    ], report["cross_model_weak_tasks"])
    lines.extend(["", "## Six-task open-model replication", ""])
    markdown_table(lines, [
        ("topic", "Task"), ("model", "Model"), ("protocol", "Protocol"),
        ("n", "n"), ("mean_fe_t", "Mean FE_t"),
        ("contagion_runs", "Contagion runs"),
    ], report["cross_model_multitask"])
    lines.extend(["", "## Debate with enforced source commitment", ""])
    markdown_table(lines, [
        ("model", "Model"), ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"),
        ("adversary_retention", "Source retention (AR)"),
        ("contagion_runs", "Contagion runs"),
    ], report["enforced_adversary_debate"])
    lines.extend(["", "## Identical-target defense suite", ""])
    markdown_table(lines, [
        ("condition_id", "Condition"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"),
        ("adversary_retention", "Source retention (AR)"),
        ("contagion_runs", "Contagion runs"),
    ], report["neutral_prompt_defenses"])
    lines.extend(["", "## Cross-topic Haiku replication", ""])
    markdown_table(lines, [
        ("topic", "Topic"), ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"), ("contagion_runs", "Contagion runs"),
    ], report["cross_topic"])
    lines.extend(["", "## Balanced persistent-false-source ratio replication", ""])
    markdown_table(lines, [
        ("adversary_count", "Persistent-false sources"), ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"), ("contagion_runs", "Contagion runs"),
    ], report["adversary_ratio_standardized"])
    lines.extend(["", "## Full 18-item core suite by category", ""])
    markdown_table(lines, [
        ("task_category", "Category"), ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"), ("contagion_runs", "Contagion runs"),
    ], report["core_task_categories"])
    lines.extend(["", "## Identical targets on all 18 screened SciTaT items", ""])
    markdown_table(lines, [
        ("protocol", "Protocol"), ("n", "n"),
        ("mean_fe_t", "Mean FE_t"), ("target_endorsements", "Target endorsements"),
        ("target_opportunities", "Target opportunities"),
        ("contagion_runs", "Contagion runs"),
    ], report["expanded_scitat_neutral"])
    lines.extend(["", "## Specialist role and private background", ""])
    markdown_table(lines, [
        ("analyst_5_role", "Analyst 5 role"), ("background", "Private note"), ("n", "n"),
        ("analyst_5_first_rejection", "First-response rejection"),
        ("analyst_5_first_confidence", "First-response confidence"),
        ("analyst_5_adoption", "Final adoption"),
    ], report["specialist_background"])
    lines.extend([
        "",
        "The JSON companion records every run ID, database checksum, call-count audit, target trajectory, speaking position, first-adoption response, and pre-response source exposure.",
        "",
    ])
    output_md.write_text("\n".join(lines))
    print(output_json)
    print(output_md)


if __name__ == "__main__":
    main()
