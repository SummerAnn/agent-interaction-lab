#!/usr/bin/env python3
"""Describe neutral-agent confidence trajectories in the 3-of-6 Haiku runs.

This is a read-only analysis of the 36 standard shared-memory runs reported in
Appendix E: the 12 seed-0 runs from experiment v2 and the 24 seed-1/2 runs from
experiment v3.  It does not treat self-reported confidence as calibrated belief.
"""

from __future__ import annotations

import json
import sqlite3
import statistics
from collections import Counter, defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OUTPUT = REPO / "agent-interaction-lab-update-2026-10-21" / "output"
PATTERNS = (
    "part2_neutral_ratio3_standardized_memory_v2_*ego_3of6_shared_memory_no_correction*seed0",
    "part2_neutral_ratio3_standardized_memory_v3_*ego_3of6_shared_memory_no_correction*seed1",
    "part2_neutral_ratio3_standardized_memory_v3_*ego_3of6_shared_memory_no_correction*seed2",
)


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def discover_runs() -> list[Path]:
    runs: list[Path] = []
    for pattern in PATTERNS:
        runs.extend(path for path in OUTPUT.glob(pattern) if (path / "trace.db").is_file())
    runs = sorted(set(runs))
    if len(runs) != 36:
        raise RuntimeError(f"Expected 36 trace databases, found {len(runs)}")
    return runs


def read_neutral_trajectories(run_dir: Path) -> dict[str, list[dict[str, object]]]:
    con = sqlite3.connect(run_dir / "trace.db")
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT state_id, step_index, agent_id, stance, confidence
        FROM agent_claim_states
        ORDER BY state_id
        """
    ).fetchall()
    con.close()

    initial = [row for row in rows if row["step_index"] == 0]
    neutral_ids = {row["agent_id"] for row in initial if row["stance"] == "uncertain"}
    source_ids = {row["agent_id"] for row in initial if row["stance"] == "endorse"}
    if len(neutral_ids) != 3 or len(source_ids) != 3:
        raise RuntimeError(
            f"{run_dir.name}: expected three uncertain and three endorsing agents at step 0"
        )

    trajectories: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        if row["step_index"] <= 0 or row["agent_id"] not in neutral_ids:
            continue
        trajectories[row["agent_id"]].append(
            {
                "step": int(row["step_index"]),
                "stance": str(row["stance"]),
                "confidence": float(row["confidence"]),
            }
        )
    if sorted(len(items) for items in trajectories.values()) != [3, 3, 3]:
        raise RuntimeError(f"{run_dir.name}: each neutral agent should answer three times")
    return dict(trajectories)


def analyze() -> dict[str, object]:
    run_dirs = discover_runs()
    agents: list[dict[str, object]] = []
    confidence_by_turn: dict[int, list[float]] = defaultdict(list)
    endorsement_confidence_by_turn: dict[int, list[float]] = defaultdict(list)
    stance_by_turn: dict[int, Counter[str]] = defaultdict(Counter)

    for run_dir in run_dirs:
        trajectories = read_neutral_trajectories(run_dir)
        for agent_id, responses in trajectories.items():
            for turn, response in enumerate(responses, start=1):
                confidence_by_turn[turn].append(float(response["confidence"]))
                stance_by_turn[turn][str(response["stance"])] += 1
                if response["stance"] == "endorse":
                    endorsement_confidence_by_turn[turn].append(float(response["confidence"]))

            first_endorse_index = next(
                (index for index, response in enumerate(responses) if response["stance"] == "endorse"),
                None,
            )
            agents.append(
                {
                    "run": run_dir.name,
                    "agent": agent_id,
                    "responses": responses,
                    "firstEndorseIndex": first_endorse_index,
                }
            )

    ever_endorse = [agent for agent in agents if agent["firstEndorseIndex"] is not None]
    never_endorse = [agent for agent in agents if agent["firstEndorseIndex"] is None]
    endorsers_with_followup = [
        agent for agent in ever_endorse if int(agent["firstEndorseIndex"]) < 2
    ]

    first_confidences: list[float] = []
    pre_adoption_confidences: list[float] = []
    adoption_confidence_changes: list[float] = []
    first_endorsement_response_numbers: Counter[int] = Counter()
    final_confidences: list[float] = []
    paired_differences: list[float] = []
    followup_stances: Counter[str] = Counter()
    direction_counts: Counter[str] = Counter()
    post_endorse_transitions: Counter[str] = Counter()

    for agent in ever_endorse:
        responses = agent["responses"]
        first_index = int(agent["firstEndorseIndex"])
        first_confidence = float(responses[first_index]["confidence"])
        preceding_confidence = float(responses[first_index - 1]["confidence"])
        first_confidences.append(first_confidence)
        pre_adoption_confidences.append(preceding_confidence)
        adoption_confidence_changes.append(first_confidence - preceding_confidence)
        first_endorsement_response_numbers[first_index + 1] += 1
        for current, following in zip(responses[first_index:], responses[first_index + 1 :]):
            post_endorse_transitions[f'{current["stance"]}->{following["stance"]}'] += 1

    for agent in endorsers_with_followup:
        responses = agent["responses"]
        first_index = int(agent["firstEndorseIndex"])
        first_confidence = float(responses[first_index]["confidence"])
        final_confidence = float(responses[-1]["confidence"])
        difference = final_confidence - first_confidence
        final_confidences.append(final_confidence)
        paired_differences.append(difference)
        followup_stances[str(responses[-1]["stance"])] += 1
        if difference > 1e-12:
            direction_counts["higher"] += 1
        elif difference < -1e-12:
            direction_counts["lower"] += 1
        else:
            direction_counts["same"] += 1

    affected_runs = {agent["run"] for agent in ever_endorse}
    changed_after_endorse = sum(
        count
        for transition, count in post_endorse_transitions.items()
        if not transition.startswith("endorse->endorse")
    )

    return {
        "scope": {
            "runs": len(run_dirs),
            "neutralAgents": len(agents),
            "neutralResponses": len(agents) * 3,
            "affectedRuns": len(affected_runs),
            "traceFamilies": ["v2 seed 0", "v3 seeds 1 and 2"],
        },
        "adoption": {
            "agentsEverEndorsing": len(ever_endorse),
            "agentsNeverEndorsing": len(never_endorse),
            "agentsWithAResponseAfterFirstEndorsement": len(endorsers_with_followup),
            "agentsChangingAwayAfterAnEndorsement": changed_after_endorse,
            "postEndorsementTransitionCounts": dict(sorted(post_endorse_transitions.items())),
        },
        "byResponseNumber": {
            str(turn): {
                "stanceCounts": dict(sorted(stance_by_turn[turn].items())),
                "meanConfidenceAllNeutralResponses": rounded(mean(confidence_by_turn[turn])),
                "endorsingResponses": len(endorsement_confidence_by_turn[turn]),
                "meanConfidenceAmongEndorsingResponses": rounded(
                    mean(endorsement_confidence_by_turn[turn])
                ),
            }
            for turn in (1, 2, 3)
        },
        "withinAgentAfterFirstEndorsement": {
            "agents": len(endorsers_with_followup),
            "meanConfidenceAtFirstEndorsement": rounded(mean([
                float(agent["responses"][int(agent["firstEndorseIndex"])]["confidence"])
                for agent in endorsers_with_followup
            ])),
            "meanConfidenceAtFinalResponse": rounded(mean(final_confidences)),
            "meanPairedChange": rounded(mean(paired_differences)),
            "medianPairedChange": rounded(median(paired_differences)),
            "directionCounts": dict(sorted(direction_counts.items())),
            "finalStanceCounts": dict(sorted(followup_stances.items())),
        },
        "firstEndorsementConfidence": {
            "agents": len(first_confidences),
            "responseNumberCounts": {
                str(key): value for key, value in sorted(first_endorsement_response_numbers.items())
            },
            "meanConfidenceOnResponseBeforeAdoption": rounded(mean(pre_adoption_confidences)),
            "mean": rounded(mean(first_confidences)),
            "median": rounded(median(first_confidences)),
            "minimum": rounded(min(first_confidences) if first_confidences else None),
            "maximum": rounded(max(first_confidences) if first_confidences else None),
            "meanPairedIncreaseFromPriorResponse": rounded(mean(adoption_confidence_changes)),
            "agentsWithHigherConfidenceAtAdoption": sum(
                difference > 1e-12 for difference in adoption_confidence_changes
            ),
        },
        "interpretation": {
            "claim": (
                "Agents report higher confidence when they first switch from uncertainty to "
                "endorsement, and endorsement is usually stable afterward. Confidence does "
                "not continue to rise on average after adoption."
            ),
            "caveat": (
                "Confidence is model-reported, not calibrated, and the analysis is descriptive. "
                "It does not establish that an agent has a private or strengthening belief."
            ),
        },
    }


if __name__ == "__main__":
    print(json.dumps(analyze(), indent=2, sort_keys=True))
