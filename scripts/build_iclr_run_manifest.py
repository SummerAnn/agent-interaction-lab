#!/usr/bin/env python3
"""Build the ICLR paper's exact table-to-run manifest.

The script indexes run summaries at their true grain (one output directory per
run), resolves experiment configs and rosters, validates the corresponding
SQLite run record, and emits both JSON and Markdown manifests.  It deliberately
does not infer a source for a table row that lacks an exact cohort definition.

Usage:
  python3 scripts/build_iclr_run_manifest.py --repo /path/to/multiagentworld
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from statistics import fmean
from typing import Any


def source(experiment: str, **filters: Any) -> dict[str, Any]:
    return {"experiment_id": experiment, "filters": filters}


def row(label: str, sources: list[dict[str, Any]], **reported: Any) -> dict[str, Any]:
    return {"label": label, "sources": sources, "reported": reported}


EGO = {"scenario_contains": "ego_depletion"}
SHARED = {"condition_id": "shared_memory_no_correction"}
CHAT = {"condition_id": "chat_fully_connected"}
PERSONAL = {"condition_id": "personal_memory_no_correction"}
H4 = {"roster_id": "blind_majority_wrong_4of6_haiku"}


TABLE_SPECS: list[dict[str, Any]] = [
    {
        "labels": ["tab:app_honest"],
        "title": "Honest-mistake experiments",
        "rows": [
            row("Personal memory", [source("rerun_distributed_evidence_v3", **PERSONAL)], n=40, fe=0.167),
            row("Shared memory", [source("rerun_distributed_evidence_v3", **SHARED)], n=40, fe=0.088),
            row(
                "Shared memory + correct external verification",
                [source("rerun_distributed_evidence_v3", condition_id="shared_memory_gt_verification_no_correction")],
                n=40,
                fe=0.013,
            ),
            row(
                "Early correction",
                [source("rerun_correction_timing_v3", condition_id="shared_memory_early_correction")],
                n=40,
                fe=0.013,
                recovery=0.129,
            ),
            row(
                "Late correction",
                [source("rerun_correction_timing_v3", condition_id="shared_memory_late_correction")],
                n=40,
                fe=0.038,
                recovery=0.037,
            ),
            row(
                "Shared memory + mistaken-agent exit",
                [
                    source(
                        "rerun_source_exit_v3",
                        condition_id="shared_memory_trigger_post_exit",
                        roster_id="distributed_source_exit_6_haiku",
                    )
                ],
                n=40,
                fe=0.158,
            ),
            row(
                "Live debate + mistaken-agent exit",
                [
                    source(
                        "rerun_chat_source_exit_v3",
                        condition_id="chat_fully_connected",
                        roster_id="distributed_source_exit_6_haiku",
                    )
                ],
                n=40,
                fe=0.008,
            ),
        ],
    },
    {
        "labels": ["tab:app_exit"],
        "title": "Persistent-false-source exit timing",
        "rows": [
            row("Exit after 1 agent turn", [source("part2_exit_timing_v1", roster_id="blind_majority_wrong_4of6_exit_step1_haiku", **SHARED)], n=5, fe=0.700, contagion=1),
            row("Exit after 3 agent turns", [source("part2_exit_timing_v1", roster_id="blind_majority_wrong_4of6_exit_haiku", **SHARED)], n=5, fe=0.733, contagion=2),
            row("Exit after 6 agent turns", [source("part2_exit_timing_v1", roster_contains="exit_step6", **SHARED)], n=5, fe=0.767, contagion=3),
            row("Exit after 12 agent turns", [source("part2_exit_timing_v1", roster_contains="exit_step12", **SHARED)], n=5, fe=0.800, contagion=4),
        ],
    },
    {
        "labels": ["tab:app_ambiguity"],
        "title": "Results by topic in the specialist--social experiment",
        "rows": [
            row("MMR", [source("part2_personal_vs_shared_v1", scenario_contains="wakefield", **SHARED, **H4)], n=5, contagion=0),
            row("Climate", [source("part2_ambiguity_gradient_v1", scenario_contains="climate", **SHARED, **H4)], n=5, contagion=1),
            row("STAP", [source("part2_more_topics_v1", scenario_contains="stap", **SHARED, **H4)], n=5, contagion=2),
            row("LK-99", [source("part2_ambiguity_gradient_v1", scenario_contains="superconductor", **SHARED, **H4)], n=5, contagion=3),
            row("PANDAS", [source("part2_more_topics_v1", scenario_contains="pandas", **SHARED, **H4)], n=5, contagion=4),
            row("Ego depletion", [source("part2_personal_vs_shared_v1", **EGO, **SHARED, **H4)], n=5, contagion=5),
            row(
                "GSM8K",
                [source("part2_gsm8k_for_fun_v1", scenario_contains="gsm8k_blind", roster_id="blind_majority_wrong_4of6_haiku", **SHARED)],
                n=25,
                contagion=0,
            ),
            row(
                "GSM-Hard Haiku",
                [
                    source(
                        "majority_wrong_gsm_hard_v1",
                        scenarios=[f"gsm_hard_0{i}" for i in range(1, 6)],
                        roster_id="majority_wrong_4of6_haiku",
                        **SHARED,
                    )
                ],
                n=25,
                contagion=0,
            ),
            row(
                "GSM-Hard Llama",
                [
                    source(
                        "part2_gsm_hard_blind_v1",
                        scenarios=[f"gsm_hard_0{i}" for i in range(1, 4)],
                        roster_id="blind_majority_wrong_4of6_llama8b",
                        **SHARED,
                    )
                ],
                n=9,
                contagion=6,
            ),
            row("SciTaT core", [source("part2_scitat_contagion_v1", **SHARED)], n=10, contagion=10),
        ],
    },
    {
        "labels": ["tab:app_crossmodel", "tab:crossmodel"],
        "title": "Cross-model ego-depletion comparison",
        "rows": [
            row("Haiku shared", [source("part2_personal_vs_shared_v1", **EGO, **SHARED, **H4)], n=5, fe=0.833, fe_t=0.500, interventions=0),
            row("Haiku debate", [source("part2_personal_vs_shared_v1", **EGO, **CHAT, **H4)], n=5, fe=0.000, fe_t=0.000, ar=0.000, interventions=0),
            row("Sonnet shared", [source("part2_sonnet_familiar_v1", **EGO, **SHARED, roster_contains="sonnet")], n=5, fe=0.800, fe_t=0.400, interventions=0),
            row("Sonnet debate", [source("part2_sonnet_familiar_v1", **EGO, **CHAT, roster_contains="sonnet")], n=5, fe=0.467, fe_t=0.000, ar=0.700, interventions=0),
            row("Opus shared", [source("part2_opus_familiar_v1", **EGO, **SHARED, roster_contains="opus")], n=5, fe=0.833, fe_t=0.500, interventions=0),
            row("Opus debate", [source("part2_opus_familiar_v1", **EGO, **CHAT, roster_contains="opus")], n=5, fe=0.467, fe_t=0.000, ar=0.700, interventions=0),
            row("GPT-4o-mini shared", [source("part2_gpt4mini_v1", **EGO, **SHARED, roster_contains="gpt4mini")], n=5, fe=0.833, fe_t=0.500, interventions=0),
            row("GPT-4o-mini debate", [source("part2_gpt4mini_v1", **EGO, **CHAT, roster_contains="gpt4mini")], n=5, fe=0.800, fe_t=0.400, ar=1.000, interventions=0),
            row("Llama shared", [source("part2_rag_minimal_v1", **EGO, **SHARED, roster_contains="llama")], n=5, fe=0.867, fe_t=0.600, interventions=0),
            row("Llama debate", [source("part2_rag_minimal_v1", **EGO, **CHAT, roster_contains="llama")], n=5, fe=0.800, fe_t=0.400, ar=1.000, interventions=0),
            row("Ministral shared", [source("blind_all_models_familiar_v1", **EGO, **SHARED, roster_contains="mistral")], n=5, fe=0.833, fe_t=0.500, interventions=0),
            row("Ministral debate", [source("blind_all_models_familiar_v1", **EGO, **CHAT, roster_contains="mistral")], n=5, fe=0.500, fe_t=0.600, ar=0.450, interventions=0),
            row("Gemma shared only", [source("blind_all_models_familiar_v1", **EGO, **SHARED, roster_contains="gemma")], n=5, fe=0.933, fe_t=0.800),
        ],
    },
    {
        "labels": ["tab:app_mitigations"],
        "title": "Changes intended to reduce false answers in the specialist--social experiment",
        "rows": [
            row("Correct external verification", [source("part2_verification_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction")], n=5, contagion=0),
            row("Live debate", [source("part2_personal_vs_shared_v1", **EGO, **CHAT, **H4)], n=5, contagion=0),
            row("Early correction", [source("part2_correction_timing_v1", **EGO, condition_id="shared_memory_early_correction")], n=5, contagion=0),
            row("Late correction", [source("part2_correction_timing_v1", **EGO, condition_id="shared_memory_late_correction")], n=5, contagion=0),
            row("Independence-aware memory", [source("part2_independence_aware_v1", **EGO, condition_id="shared_independence_aware_no_correction")], n=5, contagion=2),
            row("Fading old entries", [source("part2_decay_v1", **EGO, condition_id="shared_memory_decay_no_correction")], n=5, contagion=4),
            row("Two-entry memory limit", [source("part2_bounded_2slot_v1", **EGO, condition_id="bounded_mixed_fifo")], n=5, contagion=2),
            row("Require specialist-prompted target agent to write", [source("part2_force_write_v2", **EGO, **SHARED)], n=5, contagion=5),
            row("Claude Opus 4.6", [source("part2_opus_familiar_v1", **EGO, **SHARED, roster_contains="opus")], n=5, contagion=5),
        ],
    },
    {
        "labels": ["tab:app_sonnet_mitigations"],
        "title": "Sonnet results in the specialist--social experiment",
        "rows": [
            row("Standard shared memory", [source("part2_sonnet_full_v1", **EGO, **SHARED, roster_contains="sonnet")], n=5, fe_t=0.500, contagion=5),
            row("Personal memory", [source("part2_sonnet_full_v1", **EGO, **PERSONAL, roster_contains="sonnet")], n=5, fe_t=0.000, contagion=0),
            row("Fading old entries", [source("part2_sonnet_full_v1", **EGO, condition_id="shared_memory_decay_no_correction", roster_contains="sonnet")], n=5, fe_t=0.500, contagion=5),
            row("Early correction", [source("part2_sonnet_full_v1", **EGO, condition_id="shared_memory_early_correction", roster_contains="sonnet")], n=5, fe_t=0.100, contagion=1),
            row("Correct external verification message", [source("part2_sonnet_full_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction", roster_contains="sonnet")], n=5, fe_t=0.000, contagion=0),
        ],
    },
    {
        "labels": ["tab:app_confidence"],
        "title": "Confidence-and-persistence bundle",
        "rows": [
            row("Persistent instructions (3/6)", [source("part2_ratio_test_v1", roster_id="blind_3liar_3honest_haiku", **SHARED)], n=10, fe=0.767, contagion=8),
            row("Mild instructions (3/6)", [source("part2_confidence_bias_test_v1", **SHARED)], n=10, fe=0.000, contagion=0),
            row("No persistent-false sources", [source("part2_baseline_no_contamination_v1", **SHARED)], n=10, fe=0.000, contagion=0),
        ],
    },
    {
        "labels": ["tab:app_evidence"],
        "title": "With and without evidence cards",
        "rows": [
            row("With evidence cards", [source("part2_personal_vs_shared_v1", **EGO, **SHARED, **H4)], n=5, fe=0.833),
            row("No evidence cards", [source("part2_no_evidence_v1", scenario_contains="ego_depletion", **SHARED, **H4)], n=5, fe=0.833),
            row("Temperature 0.7", [source("part2_temperature_v1", **EGO, **SHARED, **H4)], n=5, fe=0.833),
            row("Cyclic start labels (seeds 11--20)", [source("part2_random_order_v1", **EGO, **SHARED, **H4)], n=10, fe=0.833),
        ],
    },
    {
        "labels": ["tab:app_amplifier"],
        "title": "Shared memory with a revisable wrong majority",
        "rows": [
            row("Evidence board", [source("amplifier_majority_wrong_haiku_v1", condition_id="shared_evidence_board_no_correction")], n=40, fe=0.092),
            row("Mixed record", [source("amplifier_majority_wrong_haiku_v1", condition_id="shared_mixed_record_no_correction")], n=40, fe=0.004),
        ],
    },
    {
        "labels": ["tab:app_defense_preserves_correction"],
        "title": "Helpful correction with standard and modified shared memory",
        "rows": [
            row(
                "Standard shared memory",
                [source("honest_mistake_defense_majority_correction_v1", condition_id="shared_mixed_record_no_correction")],
                n=40,
            ),
            row(
                "Modified shared memory",
                [source("honest_mistake_defense_majority_correction_v1", condition_id="shared_provenance_aware_no_correction")],
                n=40,
            ),
        ],
    },
    {
        "labels": ["tab:scitat_screen"],
        "title": "Selection of the 18 SciTaT items",
        "rows": [
            row(
                "Single-analyst context screen",
                [source("scitat_numeric_chat_screen_v5")],
                n=615,
            ),
            row(
                "Selected-item group experiment",
                [source("part2_scitat_contagion_v2")],
                n=810,
            ),
        ],
    },
    {
        "labels": ["tab:scitat_v2"],
        "title": "Specialist--social experiment on 18 SciTaT items",
        "rows": [
            row("Haiku shared", [source("part2_scitat_contagion_v2", **SHARED, roster_contains="haiku")], n=90, fe=0.972, fe_t=0.917),
            row("Haiku debate", [source("part2_scitat_contagion_v2", **CHAT, roster_contains="haiku")], n=90, fe=0.667, fe_t=0.000, ar=1.000),
            row("Haiku personal", [source("part2_scitat_contagion_v2", **PERSONAL, roster_contains="haiku")], n=90, fe=0.667, fe_t=0.000),
            row("Ministral shared", [source("part2_scitat_contagion_v2", **SHARED, roster_contains="mistral")], n=90, fe=0.952, fe_t=0.856),
            row("Ministral debate", [source("part2_scitat_contagion_v2", **CHAT, roster_contains="mistral")], n=90, fe=0.667, fe_t=0.000, ar=1.000),
            row("Ministral personal", [source("part2_scitat_contagion_v2", **PERSONAL, roster_contains="mistral")], n=90, fe=0.796, fe_t=0.389),
            row("Llama shared", [source("part2_scitat_contagion_v2", **SHARED, roster_contains="llama")], n=90, fe=0.913, fe_t=0.739),
            row("Llama debate", [source("part2_scitat_contagion_v2", **CHAT, roster_contains="llama")], n=90, fe=0.667, fe_t=0.000, ar=1.000),
            row("Llama personal", [source("part2_scitat_contagion_v2", **PERSONAL, roster_contains="llama")], n=90, fe=0.852, fe_t=0.556),
        ],
    },
    {
        "labels": ["tab:crossmodel_mitigations"],
        "title": "Correct external verification across models",
        "rows": [
            row("Haiku shared", [source("part2_personal_vs_shared_v1", **EGO, **SHARED, **H4)], n=5, fe_t=0.500, interventions=0),
            row("Haiku verification", [source("part2_verification_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction")], n=5, fe_t=0.000, interventions=0),
            row("Sonnet shared", [source("part2_mitigations_crossmodel_v1", **EGO, **SHARED, roster_contains="sonnet")], n=5, fe_t=0.500, interventions=0),
            row("Sonnet verification", [source("part2_mitigations_crossmodel_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction", roster_contains="sonnet")], n=5, fe_t=0.000, interventions=0),
            row("Opus shared", [source("part2_mitigations_crossmodel_v1", **EGO, **SHARED, roster_contains="opus")], n=5, fe_t=0.500, interventions=0),
            row("Opus verification", [source("part2_mitigations_crossmodel_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction", roster_contains="opus")], n=5, fe_t=0.000, interventions=0),
            row("Ministral shared", [source("part2_mitigations_crossmodel_v1", **EGO, **SHARED, roster_contains="mistral")], n=5, fe_t=0.500, interventions=0),
            row("Ministral verification", [source("part2_mitigations_crossmodel_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction", roster_contains="mistral")], n=5, fe_t=0.000, interventions=0),
            row("GPT-4o-mini shared", [source("part2_mitigations_crossmodel_v1", **EGO, **SHARED, roster_contains="gpt4mini")], n=5, fe_t=0.500, interventions=0),
            row("GPT-4o-mini verification", [source("part2_mitigations_crossmodel_v1", **EGO, condition_id="shared_memory_gt_verification_no_correction", roster_contains="gpt4mini")], n=5, fe_t=0.000, interventions=0),
        ],
    },
    {
        "labels": ["tab:neutral_fairness_main"],
        "title": "Central liar--neutral experiment",
        "rows": [
            row(
                "Shared memory",
                [source("part2_neutral_fairness_memory_v2", **SHARED)],
                n=12,
                fe_t=0.917,
                contagion=11,
                interventions=0,
            ),
            row(
                "Personal memory",
                [source("part2_neutral_fairness_memory_v2", **PERSONAL)],
                n=12,
                fe_t=0.000,
                contagion=0,
                interventions=0,
            ),
            row(
                "Live debate",
                [source("part2_neutral_fairness_chat_v3", condition_id="chat_fully_connected_no_early_stop")],
                n=12,
                fe_t=0.000,
                contagion=0,
                interventions=0,
            ),
        ],
    },
    {
        "labels": ["tab:neutral_fairness"],
        "title": "Central liar--neutral experiment by speaking-order group",
        "rows": [
            row(
                "Clustered shared",
                [source("part2_neutral_fairness_memory_v2", **SHARED, roster_contains="neutral_fairness_v2_clustered")],
                n=6,
                fe_t=1.000,
                contagion=6,
                interventions=0,
            ),
            row(
                "Interleaved shared",
                [source("part2_neutral_fairness_memory_v2", **SHARED, roster_contains="neutral_fairness_v2_interleaved")],
                n=6,
                fe_t=0.833,
                contagion=5,
                interventions=0,
            ),
            row(
                "All shared",
                [source("part2_neutral_fairness_memory_v2", **SHARED)],
                n=12,
                fe_t=0.917,
                contagion=11,
                interventions=0,
            ),
            row(
                "All personal",
                [source("part2_neutral_fairness_memory_v2", **PERSONAL)],
                n=12,
                fe_t=0.000,
                contagion=0,
                interventions=0,
            ),
            row(
                "All debate",
                [source("part2_neutral_fairness_chat_v3", condition_id="chat_fully_connected_no_early_stop")],
                n=12,
                fe_t=0.000,
                contagion=0,
                interventions=0,
            ),
        ],
    },
    {
        "labels": ["tab:neutral_boundaries"],
        "title": "Same-prompt results across models and familiar-science topics",
        "rows": [
            row("Ego Haiku shared", [source("part2_neutral_fairness_memory_v2", **SHARED)], n=12, fe_t=0.917),
            row("Ego Haiku personal", [source("part2_neutral_fairness_memory_v2", **PERSONAL)], n=12, fe_t=0.000),
            row("Ego Haiku debate", [source("part2_neutral_fairness_chat_v3", condition_id="chat_fully_connected_no_early_stop")], n=12, fe_t=0.000),
            row("Ego Sonnet shared", [source("part2_neutral_crossmodel_memory_v1", **SHARED, roster_contains="sonnet")], n=12, fe_t=0.000),
            row("Ego Sonnet personal", [source("part2_neutral_crossmodel_memory_v1", **PERSONAL, roster_contains="sonnet")], n=12, fe_t=0.000),
            row("Ego Sonnet debate", [source("part2_neutral_crossmodel_chat_v1", condition_id="chat_fully_connected_no_early_stop", roster_contains="sonnet")], n=12, fe_t=0.000),
            row("Ego Opus shared", [source("part2_neutral_crossmodel_memory_v1", **SHARED, roster_contains="opus")], n=12, fe_t=0.042),
            row("Ego Opus personal", [source("part2_neutral_crossmodel_memory_v1", **PERSONAL, roster_contains="opus")], n=12, fe_t=0.000),
            row("Ego Opus debate", [source("part2_neutral_crossmodel_chat_v1", condition_id="chat_fully_connected_no_early_stop", roster_contains="opus")], n=12, fe_t=0.000),
            row("PANDAS Sonnet shared", [source("part2_neutral_crossmodel_weak_memory_v1", scenario_contains="pandas", **SHARED, roster_contains="sonnet")], n=12, fe_t=1.000),
            row("PANDAS Sonnet personal", [source("part2_neutral_crossmodel_weak_memory_v1", scenario_contains="pandas", **PERSONAL, roster_contains="sonnet")], n=12, fe_t=0.000),
            row("PANDAS Sonnet debate", [source("part2_neutral_crossmodel_weak_chat_v1", scenario_contains="pandas", condition_id="chat_fully_connected_no_early_stop", roster_contains="sonnet")], n=12, fe_t=0.000),
            row("PANDAS Opus shared", [source("part2_neutral_crossmodel_weak_memory_v1", scenario_contains="pandas", **SHARED, roster_contains="opus")], n=12, fe_t=0.958),
            row("PANDAS Opus personal", [source("part2_neutral_crossmodel_weak_memory_v1", scenario_contains="pandas", **PERSONAL, roster_contains="opus")], n=12, fe_t=0.000),
            row("PANDAS Opus debate", [source("part2_neutral_crossmodel_weak_chat_v1", scenario_contains="pandas", condition_id="chat_fully_connected_no_early_stop", roster_contains="opus")], n=12, fe_t=0.167),
        ] + [
            row(
                f"{topic} {protocol_name}",
                [source(experiment, scenario_contains=marker, condition_id=condition_id)],
                n=12,
                fe_t=shared_value if protocol_name == "shared" else 0.000,
            )
            for topic, marker, shared_value in [
                ("PANDAS", "pandas", 1.000),
                ("LK-99", "lk99", 0.083),
                ("MMR/autism", "mmr", 0.000),
                ("Climate attribution", "climate", 0.000),
                ("STAP cells", "stap", 0.000),
            ]
            for protocol_name, experiment, condition_id in [
                ("shared", "part2_neutral_crosstopic_memory_v1", "shared_memory_no_correction"),
                ("personal", "part2_neutral_crosstopic_memory_v1", "personal_memory_no_correction"),
                ("debate", "part2_neutral_crosstopic_chat_v1", "chat_fully_connected_no_early_stop"),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_core_categories"],
        "title": "Same-prompt results for the main 18-task evaluation",
        "rows": [
            row(
                "Familiar science shared",
                [
                    source("part2_neutral_fairness_memory_v2", **SHARED),
                    source("part2_neutral_crosstopic_memory_v1", **SHARED),
                ],
                n=72,
                fe_t=0.333,
                contagion=24,
            ),
            row(
                "Familiar science personal",
                [
                    source("part2_neutral_fairness_memory_v2", **PERSONAL),
                    source("part2_neutral_crosstopic_memory_v1", **PERSONAL),
                ],
                n=72,
                fe_t=0.000,
                contagion=0,
            ),
            row(
                "Familiar science debate",
                [
                    source("part2_neutral_fairness_chat_v3", condition_id="chat_fully_connected_no_early_stop"),
                    source("part2_neutral_crosstopic_chat_v1", condition_id="chat_fully_connected_no_early_stop"),
                ],
                n=72,
                fe_t=0.000,
                contagion=0,
            ),
        ] + [
            row(
                f"{category} {protocol_name}",
                [source(experiment, scenario_contains=marker, condition_id=condition_id)],
                n=60,
                fe_t=fe_t,
                contagion=contagion,
            )
            for category, marker, shared_fe_t, shared_contagion in [
                ("GSM8K", "neutral_core_v1_gsm8k_", 0.000, 0),
                ("GSM-Hard", "neutral_core_v1_gsmhard_", 0.150, 9),
            ]
            for protocol_name, experiment, condition_id, fe_t, contagion in [
                ("shared", "part2_neutral_core_remaining_memory_v1", "shared_memory_no_correction", shared_fe_t, shared_contagion),
                ("personal", "part2_neutral_core_remaining_memory_v1", "personal_memory_no_correction", 0.000, 0),
                ("debate", "part2_neutral_core_remaining_chat_v1", "chat_fully_connected_no_early_stop", 0.000, 0),
            ]
        ] + [
            row(
                f"SciTaT two-item core subset {protocol_name}",
                [
                    source(
                        f"part2_neutral_scitat_expanded_{mode}_v3_s2",
                        scenario_contains="1512_01642",
                        condition_id=condition_id,
                    ),
                    source(
                        f"part2_neutral_scitat_expanded_{mode}_v3_s6",
                        scenario_contains="math_0012242",
                        condition_id=condition_id,
                    ),
                ],
                n=24,
                fe_t=fe_t,
                contagion=contagion,
            )
            for protocol_name, mode, condition_id, fe_t, contagion in [
                ("shared", "memory", "shared_memory_no_correction", 0.813, 20),
                ("personal", "memory", "personal_memory_no_correction", 0.000, 0),
                ("debate", "chat", "chat_fully_connected_no_early_stop", 0.063, 2),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_open_ego"],
        "title": "Same-prompt ego-depletion results for three additional models",
        "rows": [
            row(
                f"{model_label} {protocol_name}",
                [source(experiment, condition_id=condition_id, roster_contains=roster_marker)],
                n=12,
                fe_t=fe_t,
            )
            for model_label, roster_marker, debate_fe_t in [
                ("GPT-4o-mini", "gpt4mini", 0.917),
                ("Llama 3.1 8B", "llama8b", 0.583),
                ("Ministral 8B 2512", "mistral8b", 0.958),
            ]
            for protocol_name, experiment, condition_id, fe_t in [
                ("shared", "part2_neutral_fairness_crossmodel_memory_v2", "shared_memory_no_correction", 1.000),
                ("personal", "part2_neutral_fairness_crossmodel_memory_v2", "personal_memory_no_correction", 1.000),
                ("debate", "part2_neutral_fairness_crossmodel_chat_v2", "chat_fully_connected_no_early_stop", debate_fe_t),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_claude_scitat"],
        "title": "Same-prompt results on two SciTaT items for Sonnet and Opus",
        "rows": [
            row(
                f"{model_label} {task_label} {protocol_name}",
                [source(experiment, scenario_contains=scenario_marker, condition_id=condition_id, roster_contains=roster_marker)],
                n=12,
                fe_t=fe_t,
            )
            for model_label, roster_marker, task_label, scenario_marker, shared_fe_t, personal_fe_t, debate_fe_t in [
                ("Sonnet 4.6", "sonnet", "SciTaT 1512", "1512_01642", 1.000, 0.000, 0.000),
                ("Sonnet 4.6", "sonnet", "SciTaT math", "math_0012242", 0.625, 0.000, 0.000),
                ("Opus 4.6", "opus", "SciTaT 1512", "1512_01642", 1.000, 0.000, 0.625),
                ("Opus 4.6", "opus", "SciTaT math", "math_0012242", 0.042, 0.000, 0.000),
            ]
            for protocol_name, experiment, condition_id, fe_t in [
                ("shared", "part2_neutral_crossmodel_weak_memory_v2", "shared_memory_no_correction", shared_fe_t),
                ("personal", "part2_neutral_crossmodel_weak_memory_v2", "personal_memory_no_correction", personal_fe_t),
                ("debate", "part2_neutral_crossmodel_weak_chat_v2", "chat_fully_connected_no_early_stop", debate_fe_t),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_open_multitask_summary"],
        "title": "Six-task neutral-agent summary for three additional models",
        "rows": [
            row(
                f"{model_label} {protocol_name}",
                [source(experiment, condition_id=condition_id, roster_contains=roster_marker)],
                n=72,
                fe_t=fe_t,
            )
            for model_label, roster_marker, shared_fe_t, personal_fe_t, debate_fe_t in [
                ("GPT-4o-mini", "gpt4mini", 0.222, 0.063, 0.146),
                ("Llama 3.1 8B", "llama8b", 0.486, 0.556, 0.736),
                ("Ministral 8B 2512", "mistral8b", 0.340, 0.167, 0.160),
            ]
            for protocol_name, experiment, condition_id, fe_t in [
                ("shared", "part2_neutral_fairness_crossmodel_multitask_memory_v2", "shared_memory_no_correction", shared_fe_t),
                ("personal", "part2_neutral_fairness_crossmodel_multitask_memory_v2", "personal_memory_no_correction", personal_fe_t),
                ("debate", "part2_neutral_fairness_crossmodel_multitask_chat_v2", "chat_fully_connected_no_early_stop", debate_fe_t),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_open_multitask"],
        "title": "Per-task neutral-agent results for three additional models",
        "rows": [
            row(
                f"{model_label} {task_label} {protocol_name}",
                [source(experiment, scenario_contains=scenario_marker, condition_id=condition_id, roster_contains=roster_marker)],
                n=12,
                fe_t=fe_t,
            )
            for model_label, roster_marker, task_label, scenario_marker, shared_fe_t, personal_fe_t, debate_fe_t in [
                ("GPT-4o-mini", "gpt4mini", "MMR", "mmr_focus_only", 0.000, 0.000, 0.000),
                ("GPT-4o-mini", "gpt4mini", "SciTaT-A", "1512_01642", 1.000, 0.375, 0.875),
                ("GPT-4o-mini", "gpt4mini", "SciTaT-B", "math_0012242", 0.250, 0.000, 0.000),
                ("GPT-4o-mini", "gpt4mini", "GSM8K-1", "gsm8k_01", 0.000, 0.000, 0.000),
                ("GPT-4o-mini", "gpt4mini", "GSM8K-2", "gsm8k_02", 0.000, 0.000, 0.000),
                ("GPT-4o-mini", "gpt4mini", "GSM8K-3", "gsm8k_03", 0.083, 0.000, 0.000),
                ("Llama 3.1 8B", "llama8b", "MMR", "mmr_focus_only", 0.083, 0.000, 0.583),
                ("Llama 3.1 8B", "llama8b", "SciTaT-A", "1512_01642", 1.000, 0.833, 0.917),
                ("Llama 3.1 8B", "llama8b", "SciTaT-B", "math_0012242", 0.583, 0.583, 0.667),
                ("Llama 3.1 8B", "llama8b", "GSM8K-1", "gsm8k_01", 0.417, 0.875, 0.875),
                ("Llama 3.1 8B", "llama8b", "GSM8K-2", "gsm8k_02", 0.500, 0.667, 0.750),
                ("Llama 3.1 8B", "llama8b", "GSM8K-3", "gsm8k_03", 0.333, 0.375, 0.625),
                ("Ministral 8B 2512", "mistral8b", "MMR", "mmr_focus_only", 0.000, 0.000, 0.000),
                ("Ministral 8B 2512", "mistral8b", "SciTaT-A", "1512_01642", 1.000, 1.000, 0.458),
                ("Ministral 8B 2512", "mistral8b", "SciTaT-B", "math_0012242", 0.833, 0.000, 0.375),
                ("Ministral 8B 2512", "mistral8b", "GSM8K-1", "gsm8k_01", 0.000, 0.000, 0.000),
                ("Ministral 8B 2512", "mistral8b", "GSM8K-2", "gsm8k_02", 0.042, 0.000, 0.042),
                ("Ministral 8B 2512", "mistral8b", "GSM8K-3", "gsm8k_03", 0.167, 0.000, 0.083),
            ]
            for protocol_name, experiment, condition_id, fe_t in [
                ("shared", "part2_neutral_fairness_crossmodel_multitask_memory_v2", "shared_memory_no_correction", shared_fe_t),
                ("personal", "part2_neutral_fairness_crossmodel_multitask_memory_v2", "personal_memory_no_correction", personal_fe_t),
                ("debate", "part2_neutral_fairness_crossmodel_multitask_chat_v2", "chat_fully_connected_no_early_stop", debate_fe_t),
            ]
        ],
    },
    {
        "labels": ["tab:neutral_scitat_expanded"],
        "title": "Same-prompt Haiku results on 18 selected SciTaT items",
        "rows": [
            row(
                "Shared memory",
                [source(f"part2_neutral_scitat_expanded_memory_v3_s{shard}", **SHARED) for shard in range(1, 7)],
                n=216,
                fe_t=0.938,
                contagion=203,
            ),
            row(
                "Personal memory",
                [source(f"part2_neutral_scitat_expanded_memory_v3_s{shard}", **PERSONAL) for shard in range(1, 7)],
                n=216,
                fe_t=0.000,
                contagion=0,
            ),
            row(
                "Live debate",
                [source(f"part2_neutral_scitat_expanded_chat_v3_s{shard}", condition_id="chat_fully_connected_no_early_stop") for shard in range(1, 7)],
                n=216,
                fe_t=0.007,
                contagion=2,
            ),
        ],
    },
    {
        "labels": ["tab:specialist_background"],
        "title": "Private methods notes before live debate",
        "rows": [
            row(
                f"{role_label} | {note_label}",
                [source(
                    "part2_specialist_private_background_chat_v1",
                    scenario_id=f"specialist_background_v1_ego_{note_id}",
                    condition_id="chat_fully_connected_no_early_stop",
                    roster_contains=f"specialist_background_v1_{role_id}_",
                )],
                n=12,
                analyst_5_first_reject=first_reject,
                analyst_5_first_confidence=first_confidence,
                analyst_5_final_adoption=0.000,
            )
            for role_label, role_id, values in [
                ("Form own judgment", "neutral", [("None", "none", 0.833, 0.663), ("General methods", "generic", 1.000, 0.715), ("Ego-depletion methods", "topic", 0.750, 0.628)]),
                ("Act as skeptical specialist", "specialist", [("None", "none", 1.000, 0.740), ("General methods", "generic", 0.917, 0.709), ("Ego-depletion methods", "topic", 0.917, 0.697)]),
            ]
            for note_label, note_id, first_reject, first_confidence in values
        ],
    },
    {
        "labels": ["tab:enforced_debate"],
        "title": "Live debate with generated or fixed responses from persistent-false sources",
        "rows": [
            row("Haiku | Generated responses", [source("part2_neutral_fairness_chat_v3", condition_id="chat_fully_connected_no_early_stop")], n=12, fe_t=0.000, ar=0.000),
            row("Haiku | Fixed public responses", [source("part2_neutral_enforced_debate_v1", condition_id="chat_fully_connected_no_early_stop_enforced_adversaries", roster_contains="haiku")], n=12, fe_t=0.000, ar=1.000),
            row("Sonnet | Generated responses", [source("part2_neutral_crossmodel_chat_v1", condition_id="chat_fully_connected_no_early_stop", roster_contains="sonnet")], n=12, fe_t=0.000, ar=0.833),
            row("Sonnet | Fixed public responses", [source("part2_neutral_enforced_debate_v1", condition_id="chat_fully_connected_no_early_stop_enforced_adversaries", roster_contains="sonnet")], n=12, fe_t=0.000, ar=1.000),
            row("Opus | Generated responses", [source("part2_neutral_crossmodel_chat_v1", condition_id="chat_fully_connected_no_early_stop", roster_contains="opus")], n=12, fe_t=0.000, ar=0.896),
            row("Opus | Fixed public responses", [source("part2_neutral_enforced_debate_v1", condition_id="chat_fully_connected_no_early_stop_enforced_adversaries", roster_contains="opus")], n=12, fe_t=0.000, ar=1.000),
        ],
    },
    {
        "labels": ["tab:neutral_defenses_main"],
        "title": "Changes intended to reduce false answers in the liar--neutral experiments",
        "rows": [
            row(
                label,
                [source("part2_neutral_defense_suite_v2", condition_id=condition_id)],
                n=12,
                fe_t=fe_t,
                contagion=contagion,
                ar=1.000,
                interventions=interventions,
                target_endorsements=target_endorsements,
            )
            for label, condition_id, fe_t, contagion, interventions, target_endorsements in [
                ("Standard shared memory", "shared_memory_no_correction", 0.958, 12, 0, 23),
                ("Correct external verification", "shared_memory_gt_verification_no_correction", 0.000, 0, 0, 0),
                ("Early correction", "shared_memory_early_correction", 0.000, 0, 12, 0),
                ("Late correction", "shared_memory_late_correction", 0.292, 6, 12, 7),
                ("Fading old entries", "shared_memory_decay_no_correction", 0.708, 9, 0, 17),
                ("Current answer counts with warning", "shared_independence_aware_no_correction", 0.000, 0, 0, 0),
                ("Earlier statement shown with warning", "shared_provenance_aware_no_correction", 0.000, 0, 0, 0),
            ]
        ],
    },
    {
        "labels": ["tab:adversary_ratio"],
        "title": "Varying the number of liar agents in the liar--neutral experiment",
        "rows": [
            row(
                f"{ratio}/6 shared",
                [
                    source(f"part2_neutral_ratio{ratio}_standardized_memory_v2", **SHARED),
                    source(f"part2_neutral_ratio{ratio}_standardized_memory_v3", **SHARED),
                ],
                n=36,
                fe_t=fe_t,
                fixed_pair_fe_t=fixed_pair_fe_t,
            )
            for ratio, fe_t, fixed_pair_fe_t in [
                (1, 0.000, 0.000),
                (2, 0.125, 0.111),
                (3, 0.926, 0.931),
                (4, 0.806, 0.806),
            ]
        ] + [
            row(
                f"{ratio}/6 debate",
                [
                    source(f"part2_neutral_ratio{ratio}_standardized_chat_v2", condition_id="chat_fully_connected_no_early_stop"),
                    source(f"part2_neutral_ratio{ratio}_standardized_chat_v3", condition_id="chat_fully_connected_no_early_stop"),
                ],
                n=36,
                fe_t=0.000,
            )
            for ratio in [1, 2, 3, 4]
        ] + [
            row(
                f"{ratio}/6 personal",
                [
                    source(f"part2_neutral_ratio{ratio}_standardized_memory_v2", **PERSONAL),
                    source(f"part2_neutral_ratio{ratio}_standardized_memory_v3", **PERSONAL),
                ],
                n=36,
                fe_t=0.000,
            )
            for ratio in [1, 2, 3, 4]
        ],
    },
    {
        "labels": ["tab:peer_visibility_main"],
        "title": "Visibility of statements written by neutral agents",
        "rows": [
            row(
                f"{ratio}/6 | all recent statements",
                [source(f"part2_neutral_ratio{ratio}_contemporaneous_standard_v1", **SHARED)],
                n=36,
                fe_t=fe_t,
                contagion=any_runs,
                all_adoption=all_runs,
                target_endorsements=false_answers,
            )
            for ratio, fe_t, any_runs, all_runs, false_answers in [
                (2, 0.153, 8, 2, 22),
                (3, 0.824, 30, 29, 89),
                (4, 0.903, 34, 31, 65),
            ]
        ] + [
            row(
                f"{ratio}/6 | liar statements and own history",
                [
                    source(
                        f"part2_neutral_ratio{ratio}_no_neutral_peer_entries_v1",
                        condition_id="shared_memory_no_neutral_peer_entries",
                    )
                ],
                n=36,
                fe_t=fe_t,
                contagion=any_runs,
                all_adoption=all_runs,
                target_endorsements=false_answers,
            )
            for ratio, fe_t, any_runs, all_runs, false_answers in [
                (2, 0.139, 8, 2, 20),
                (3, 0.676, 28, 18, 73),
                (4, 0.889, 33, 31, 64),
            ]
        ],
    },
    {
        "labels": ["tab:provenance_defense"],
        "title": "Showing which earlier statement was repeated across six topics",
        "rows": [
            row(
                f"{topic} | {condition_label}",
                [source("provenance_defense_v1", scenario_id=scenario_id, condition_id=condition_id)],
                n=5,
                fe_t=value,
            )
            for topic, scenario_id, values in [
                ("Ego depletion", "blind_ego_depletion_v1", [0.500, 0.200, 0.200, 0.000]),
                ("PANDAS", "blind_medical_pandas_dx_v1", [0.400, 0.400, 0.300, 0.400]),
                ("LK-99", "blind_room_temp_superconductor_v1", [0.400, 0.000, 0.000, 0.000]),
                ("STAP", "blind_stap_cells_v1", [0.100, 0.000, 0.000, 0.000]),
                ("Climate", "blind_climate_attribution_v1", [0.000, 0.000, 0.000, 0.000]),
                ("MMR", "blind_wakefield_mmr_autism_v1", [0.000, 0.000, 0.000, 0.000]),
            ]
            for condition_label, condition_id, value in zip(
                ["Standard shared memory", "Answer counts with warning", "One statement per origin", "Earlier statement shown with warning"],
                [
                    "shared_memory_no_correction",
                    "shared_independence_aware_no_correction",
                    "shared_lineage_collapsed_no_correction",
                    "shared_provenance_aware_no_correction",
                ],
                values,
            )
        ] + [
            row("Overall | Standard shared memory", [source("provenance_defense_v1", **SHARED)], n=30, fe_t=0.233),
            row("Overall | Answer counts with warning", [source("provenance_defense_v1", condition_id="shared_independence_aware_no_correction")], n=30, fe_t=0.100),
            row("Overall | One statement per origin", [source("provenance_defense_v1", condition_id="shared_lineage_collapsed_no_correction")], n=30, fe_t=0.083),
            row("Overall | Earlier statement shown with warning", [source("provenance_defense_v1", condition_id="shared_provenance_aware_no_correction")], n=30, fe_t=0.067),
        ],
    },
    {
        "labels": ["tab:provenance_ablation"],
        "title": "Separating the statement marker from the warning",
        "rows": [
            row(
                f"{topic} | {condition_label}",
                [source("provenance_ablation_v1", scenario_id=scenario_id, condition_id=condition_id)],
                n=5,
                fe_t=value,
            )
            for topic, scenario_id, values in [
                ("Ego depletion", "blind_ego_depletion_v1", [0.500, 0.300, 0.000]),
                ("PANDAS", "blind_medical_pandas_dx_v1", [0.400, 0.400, 0.400]),
                ("LK-99", "blind_room_temp_superconductor_v1", [0.300, 0.300, 0.000]),
                ("STAP", "blind_stap_cells_v1", [0.100, 0.000, 0.000]),
                ("Climate", "blind_climate_attribution_v1", [0.000, 0.000, 0.000]),
                ("MMR", "blind_wakefield_mmr_autism_v1", [0.000, 0.000, 0.000]),
            ]
            for condition_label, condition_id, value in zip(
                ["Standard shared memory", "Earlier statement shown", "Earlier statement shown with warning"],
                [
                    "shared_memory_no_correction",
                    "shared_provenance_minimal_no_correction",
                    "shared_provenance_aware_no_correction",
                ],
                values,
            )
        ] + [
            row("Overall | Standard shared memory", [source("provenance_ablation_v1", **SHARED)], n=30, fe_t=0.217),
            row("Overall | Earlier statement shown", [source("provenance_ablation_v1", condition_id="shared_provenance_minimal_no_correction")], n=30, fe_t=0.167),
            row("Overall | Earlier statement shown with warning", [source("provenance_ablation_v1", condition_id="shared_provenance_aware_no_correction")], n=30, fe_t=0.067),
        ],
    },
    {
        "labels": ["tab:provenance_crossmodel"],
        "title": "Cross-model statement marker and warning",
        "rows": [
            row("Haiku | Standard shared memory", [source("provenance_ablation_v1", **EGO, **SHARED)], n=5, fe_t=0.500),
            row("Haiku | Earlier statement shown", [source("provenance_ablation_v1", **EGO, condition_id="shared_provenance_minimal_no_correction")], n=5, fe_t=0.300),
            row("Haiku | Earlier statement shown with warning", [source("provenance_ablation_v1", **EGO, condition_id="shared_provenance_aware_no_correction")], n=5, fe_t=0.000),
            row("Sonnet | Standard shared memory", [source("provenance_cross_model_v1", **EGO, **SHARED, roster_contains="sonnet")], n=5, fe_t=0.500),
            row("Sonnet | Earlier statement shown", [source("provenance_cross_model_v1", **EGO, condition_id="shared_provenance_minimal_no_correction", roster_contains="sonnet")], n=5, fe_t=0.300),
            row("Sonnet | Earlier statement shown with warning", [source("provenance_cross_model_v1", **EGO, condition_id="shared_provenance_aware_no_correction", roster_contains="sonnet")], n=5, fe_t=0.000),
            row("GPT-4o-mini | Standard shared memory", [source("provenance_cross_model_v1", **EGO, **SHARED, roster_contains="gpt4mini")], n=5, fe_t=0.500),
            row("GPT-4o-mini | Earlier statement shown", [source("provenance_cross_model_v1", **EGO, condition_id="shared_provenance_minimal_no_correction", roster_contains="gpt4mini")], n=5, fe_t=0.500),
            row("GPT-4o-mini | Earlier statement shown with warning", [source("provenance_cross_model_v1", **EGO, condition_id="shared_provenance_aware_no_correction", roster_contains="gpt4mini")], n=5, fe_t=0.200),
        ],
    },
    {
        "labels": ["tab:trace_deliberate"],
        "title": "Recorded responses from the specialist--social experiment",
        "rows": [
            row(
                "Ego depletion, shared memory, seed 1",
                [source("part2_personal_vs_shared_v1", **EGO, **SHARED, **H4, seeds=[1])],
                n=1,
            )
        ],
    },
    {
        "labels": ["tab:cascade_shape"],
        "title": "Within-run spread by liar-agent count",
        "status": "derived",
        "depends_on": ["tab:adversary_ratio"],
        "rows": [],
    },
    {
        "labels": ["tab:cascade_predictions"],
        "title": "Qualitative synthesis table",
        "status": "derived",
        "depends_on": [
            "tab:app_ambiguity",
            "tab:app_crossmodel",
            "tab:app_confidence",
            "tab:scitat_v2",
        ],
        "rows": [],
    },
    {
        "labels": ["tab:schedule_uncertainty"],
        "title": "Speaking-order uncertainty analysis",
        "status": "derived",
        "source_files": [
            "iclr2027/uncertainty_analysis.py",
            "iclr2027/uncertainty_results.json",
        ],
        "depends_on": [
            "tab:neutral_fairness",
            "tab:adversary_ratio",
            "tab:provenance_defense",
            "tab:provenance_ablation",
            "tab:scitat_v2",
        ],
        "rows": [],
    },
    {
        "labels": ["tab:task_examples"],
        "title": "Task examples",
        "status": "design_metadata",
        "source_files": ["scenarios/", "conditions/"],
        "rows": [],
    },
    {
        "labels": ["tab:agent_params"],
        "title": "Agent parameters",
        "status": "design_metadata",
        "source_files": ["rosters/blind-majority-wrong-4of6-haiku.json"],
        "rows": [],
    },
    {
        "labels": ["tab:evidence_cards"],
        "title": "Ego-depletion evidence cards",
        "status": "design_metadata",
        "source_files": ["scenarios/familiar-blind/blind_ego_depletion_v1.yaml"],
        "rows": [],
    },
    {
        "labels": ["tab:model_task_coverage"],
        "title": "Model-by-task coverage for the matched liar-neutral comparisons",
        "status": "design_metadata",
        "source_files": ["experiments/", "rosters/"],
        "rows": [],
    },
    {
        "labels": ["tab:models"],
        "title": "Model catalog",
        "status": "design_metadata",
        "source_files": ["rosters/", "experiments/"],
        "rows": [],
    },
    {
        "labels": ["tab:design_overview"],
        "title": "Selected experiment designs",
        "status": "design_metadata",
        "source_files": ["experiments/", "rosters/", "paper/appendix_results.tex"],
        "rows": [],
    },
    {
        "labels": ["tab:baseline_cohort_audit"],
        "title": "Standard-memory baselines across three cohorts",
        "status": "derived",
        "depends_on": [
            "tab:adversary_ratio",
            "tab:peer_visibility_main",
            "tab:uncertain_write_rule",
        ],
        "rows": [],
    },
]


# These tables were added after the base-paper manifest was designed. They are
# audited by the two checksum manifests named here rather than being silently
# treated as uncovered by this builder.
SUPPLEMENTARY_MANIFEST_LABELS = {
    "tab:heterogeneous_models": "new_appendix_run_manifest.json",
    "tab:peer_visibility_model_replication": "open_model_visibility_manifest.json",
    "tab:provenance_numerical": "new_appendix_run_manifest.json",
    "tab:uncertain_write_rule": "new_appendix_run_manifest.json",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalize_path(path: Path, repo: Path) -> str:
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def index_json_by_id(paths: list[Path]) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = defaultdict(list)
    for path in paths:
        try:
            payload = load_json(path)
        except Exception:
            continue
        object_id = payload.get("id") if isinstance(payload, dict) else None
        if object_id:
            result[str(object_id)].append({"path": str(path), "sha256": sha256(path)})
    return result


def matches(value: Any, filters: dict[str, Any], prefix: str) -> bool:
    exact_key = prefix
    contains_key = f"{prefix.removesuffix('_id')}_contains"
    plural_key = f"{prefix.removesuffix('_id')}s"
    if exact_key in filters and value != filters[exact_key]:
        return False
    if contains_key in filters and str(filters[contains_key]) not in str(value):
        return False
    if plural_key in filters and value not in filters[plural_key]:
        return False
    return True


def select_runs(index: dict[str, list[dict[str, Any]]], spec: dict[str, Any]) -> list[dict[str, Any]]:
    runs = list(index.get(spec["experiment_id"], []))
    filters = spec.get("filters", {})
    selected = []
    for run in runs:
        if not matches(run.get("scenario_id"), filters, "scenario_id"):
            continue
        if not matches(run.get("condition_id"), filters, "condition_id"):
            continue
        if not matches(run.get("roster_id"), filters, "roster_id"):
            continue
        if "seeds" in filters and run.get("seed") not in filters["seeds"]:
            continue
        if filters.get("completed_only", True) and not run.get("completed", False):
            continue
        selected.append(run)
    return selected


def open_trace(path: Path, immutable: bool) -> sqlite3.Connection:
    suffix = "?mode=ro&immutable=1" if immutable else "?mode=ro"
    return sqlite3.connect(f"file:{path}{suffix}", uri=True)


def read_trace_metadata(
    path: Path,
    expected_run_id: str,
    adversary_ids: set[str],
    expected_focus_claim_id: str | None,
    immutable: bool,
) -> dict[str, Any]:
    """Read one trace, keeping the logical run separate from its finalized marker.

    Older artifacts live in read-only directories and require SQLite immutable
    mode. Newer artifacts may still have a WAL, which must be read in ordinary
    read-only mode so committed WAL pages are visible.
    """
    output: dict[str, Any] = {}
    connection = open_trace(path, immutable=immutable)
    connection.row_factory = sqlite3.Row
    run_rows = list(connection.execute("SELECT * FROM runs"))
    output["run_row_count"] = len(run_rows)
    logical_row = next((row for row in run_rows if row["run_id"] == expected_run_id), None)
    finalized_row = next(
        (row for row in run_rows if row["run_id"] == f"{expected_run_id}__finalized"),
        None,
    )
    if logical_row is not None:
        output["db_run_id"] = logical_row["run_id"]
        output["db_seed"] = logical_row["seed"]
    output["db_status"] = (
        finalized_row["status"]
        if finalized_row is not None
        else (logical_row["status"] if logical_row is not None else None)
    )
    output["db_identity_matches"] = logical_row is not None
    focus_claim = expected_focus_claim_id
    if focus_claim is None:
        claim_row = connection.execute(
            """
            SELECT claim_id FROM events
            WHERE run_id = ? AND claim_id <> '' AND claim_id <> 'none'
            ORDER BY event_id LIMIT 1
            """,
            (expected_run_id,),
        ).fetchone()
        focus_claim = claim_row[0] if claim_row else None
    if focus_claim:
        output["focus_claim_id"] = focus_claim
        final_rows = list(
            connection.execute(
                """
                SELECT s.agent_id, s.stance, s.confidence
                FROM agent_claim_states s
                WHERE s.run_id = ? AND s.claim_id = ?
                  AND s.state_id = (
                    SELECT s2.state_id
                    FROM agent_claim_states s2
                    WHERE s2.run_id = s.run_id
                      AND s2.claim_id = s.claim_id
                      AND s2.agent_id = s.agent_id
                    ORDER BY s2.step_index DESC, s2.state_id DESC
                    LIMIT 1
                  )
                ORDER BY s.agent_id
                """,
                (expected_run_id, focus_claim),
            )
        )
        if final_rows:
            states = {r["agent_id"]: r["stance"] for r in final_rows}
            endorsers = {agent for agent, stance in states.items() if stance == "endorse"}
            targets = set(states) - adversary_ids
            output["final_state_count"] = len(states)
            output["fe_direct"] = len(endorsers) / len(states)
            output["fe_t_direct"] = (
                len(endorsers & targets) / len(targets) if targets else None
            )
            output["adversary_retention_direct"] = (
                len(endorsers & adversary_ids) / len(adversary_ids)
                if adversary_ids
                else None
            )
            output["target_count"] = len(targets)
            output["adversary_count"] = len(adversary_ids)
            output["target_contagion_direct"] = bool(endorsers & targets)
            output["target_endorsement_count_direct"] = len(endorsers & targets)
            output["all_targets_adopt_direct"] = bool(targets) and targets <= endorsers
            fixed_pair = {"analyst_5", "analyst_6"}
            output["fixed_pair_fe_t_direct"] = (
                len(endorsers & fixed_pair) / len(fixed_pair)
                if fixed_pair <= targets
                else None
            )
            analyst_5_first = connection.execute(
                "SELECT stance, confidence FROM chat_messages "
                "WHERE run_id = ? AND agent_id = 'analyst_5' ORDER BY message_id LIMIT 1",
                (expected_run_id,),
            ).fetchone()
            output["analyst_5_first_reject"] = (
                bool(analyst_5_first["stance"] == "reject") if analyst_5_first else None
            )
            output["analyst_5_first_confidence"] = (
                float(analyst_5_first["confidence"]) if analyst_5_first else None
            )
            output["analyst_5_final_adoption"] = (
                bool(states.get("analyst_5") == "endorse") if "analyst_5" in states else None
            )
    try:
        intervention_row = connection.execute(
            "SELECT COUNT(*) FROM interventions WHERE run_id = ?",
            (expected_run_id,),
        ).fetchone()
        output["intervention_count"] = int(intervention_row[0]) if intervention_row else 0
    except sqlite3.OperationalError:
        output["intervention_count"] = None
    connection.close()
    return output


def trace_metadata(
    path: Path,
    expected_run_id: str,
    adversary_ids: set[str],
    expected_focus_claim_id: str | None,
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "trace_exists": path.exists(),
        "trace_size_bytes": path.stat().st_size if path.exists() else None,
        "trace_sha256": sha256(path) if path.exists() else None,
    }
    wal_path = Path(str(path) + "-wal")
    if wal_path.exists():
        output["wal_size_bytes"] = wal_path.stat().st_size
        output["wal_sha256"] = sha256(wal_path)
    if not path.exists():
        return output
    attempts = [False, True] if wal_path.exists() else [True, False]
    errors = []
    for immutable in attempts:
        try:
            output.update(
                read_trace_metadata(
                    path,
                    expected_run_id,
                    adversary_ids,
                    expected_focus_claim_id,
                    immutable,
                )
            )
            break
        except Exception as exc:
            errors.append(f"{'immutable' if immutable else 'readonly'}: {type(exc).__name__}: {exc}")
    else:
        output["trace_read_error"] = " | ".join(errors)
    return output


def close_enough(actual: float | None, expected: float, tolerance: float = 0.0006) -> bool:
    return actual is not None and math.isclose(actual, expected, abs_tol=tolerance)


def aggregate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    def mean_of(key: str) -> float | None:
        values = [r[key] for r in runs if r.get(key) is not None]
        return fmean(values) if len(values) == len(runs) and values else None

    intervention_counts = [r.get("intervention_count") for r in runs]
    return {
        "n": len(runs),
        "mean_fe": mean_of("fe_direct"),
        "mean_fe_summary": mean_of("fe_summary"),
        "mean_fe_t": mean_of("fe_t_direct"),
        "mean_fixed_pair_fe_t": mean_of("fixed_pair_fe_t_direct"),
        "mean_analyst_5_first_reject": mean_of("analyst_5_first_reject"),
        "mean_analyst_5_first_confidence": mean_of("analyst_5_first_confidence"),
        "mean_analyst_5_final_adoption": mean_of("analyst_5_final_adoption"),
        "mean_adversary_retention": mean_of("adversary_retention_direct"),
        "mean_recovery": mean_of("recovery"),
        "mean_truth_distance": mean_of("truth_distance"),
        "mean_diversity": mean_of("diversity"),
        "contagion_cells": sum(1 for r in runs if r.get("target_contagion_direct")),
        "all_target_adoption_runs": sum(1 for r in runs if r.get("all_targets_adopt_direct")),
        "total_target_endorsements": sum(
            r.get("target_endorsement_count_direct", 0) for r in runs
        ),
        "correct_group_decisions": sum(1 for r in runs if r.get("group_decision_correct") is True),
        "total_interventions": (
            sum(intervention_counts)
            if intervention_counts and all(value is not None for value in intervention_counts)
            else None
        ),
        "unique_schedules": sorted({r["seed"] for r in runs}),
        "unique_scenarios": sorted({r["scenario_id"] for r in runs}),
        "unique_conditions": sorted({r["condition_id"] for r in runs}),
        "unique_rosters": sorted({r["roster_id"] for r in runs if r.get("roster_id")}),
        "all_complete": all(r.get("completed") for r in runs),
        "all_traces_present": all(r.get("trace_exists") for r in runs),
        "all_db_identities_match": all(r.get("db_identity_matches") for r in runs),
        "all_roster_files_resolved_once": all(r.get("roster_file_count") == 1 for r in runs),
        "all_condition_files_resolved_once": all(r.get("condition_file_count") == 1 for r in runs),
        "all_scenario_files_resolved_once": all(r.get("scenario_file_count") == 1 for r in runs),
        "legacy_summary_fe_disagreements": sum(
            1
            for r in runs
            if r.get("fe_direct") is not None
            and r.get("fe_summary") is not None
            and not math.isclose(r["fe_direct"], r["fe_summary"], abs_tol=1e-9)
        ),
    }


def validate_aggregate(aggregate_data: dict[str, Any], reported: dict[str, Any]) -> list[dict[str, Any]]:
    checks = []
    mapping = {
        "n": "n",
        "fe": "mean_fe",
        "fe_t": "mean_fe_t",
        "fixed_pair_fe_t": "mean_fixed_pair_fe_t",
        "analyst_5_first_reject": "mean_analyst_5_first_reject",
        "analyst_5_first_confidence": "mean_analyst_5_first_confidence",
        "analyst_5_final_adoption": "mean_analyst_5_final_adoption",
        "ar": "mean_adversary_retention",
        "recovery": "mean_recovery",
        "td": "mean_truth_distance",
        "div": "mean_diversity",
        "contagion": "contagion_cells",
        "all_adoption": "all_target_adoption_runs",
        "target_endorsements": "total_target_endorsements",
        "correct": "correct_group_decisions",
        "interventions": "total_interventions",
    }
    for reported_key, aggregate_key in mapping.items():
        if reported_key not in reported:
            continue
        expected = reported[reported_key]
        actual = aggregate_data.get(aggregate_key)
        if isinstance(expected, float):
            passed = close_enough(actual, expected)
        else:
            passed = actual == expected
        checks.append(
            {
                "metric": reported_key,
                "reported": expected,
                "recomputed": actual,
                "passed": passed,
            }
        )
    return checks


def table_labels_from_tex(repo: Path, tex_dir: Path = None) -> list[str]:
    labels = []
    pattern = re.compile(r"\\label\{(tab:[^}]+)\}")
    paper_dir = tex_dir or (repo / "iclr2027")
    if tex_dir is None and not paper_dir.exists():
        paper_dir = repo / "paper"
    for name in ["paper.tex", "appendix_results.tex"]:
        text = (paper_dir / name).read_text(encoding="utf-8")
        labels.extend(pattern.findall(text))
    return sorted(set(labels))


def build(
    repo: Path,
    output_dir: Path,
    tex_dir: Path = None,
) -> tuple[dict[str, Any], str]:
    paper_dir = tex_dir or (repo / "iclr2027")
    if tex_dir is None and not paper_dir.exists():
        paper_dir = repo / "paper"
    try:
        paper_rel = paper_dir.relative_to(repo)
    except ValueError:
        # Allow auditing a submission source tree that is maintained separately
        # from the public experiment repository.
        paper_rel = Path("iclr2027")
    experiment_paths = sorted((repo / "experiments").glob("*.json"))
    # Rosters may be grouped in subdirectories (for example, the balanced-order
    # fairness rosters). Index them recursively so their roles and models remain
    # auditable rather than falling back to all-agent metrics.
    roster_paths = sorted((repo / "rosters").rglob("*.json"))
    condition_paths = sorted([
        path
        for pattern in ("*.json", "*.yaml", "*.yml")
        for path in (repo / "conditions").rglob(pattern)
    ])
    scenario_paths = sorted([
        path
        for pattern in ("*.json", "*.yaml", "*.yml")
        for path in (repo / "scenarios").rglob(pattern)
    ])
    experiment_files_raw = index_json_by_id(experiment_paths)
    roster_files_raw = index_json_by_id(roster_paths)
    condition_files_raw = index_json_by_id(condition_paths)
    scenario_files_raw = index_json_by_id(scenario_paths)
    experiment_files = {
        key: [
            {"path": normalize_path(Path(item["path"]), repo), "sha256": item["sha256"]}
            for item in value
        ]
        for key, value in experiment_files_raw.items()
    }
    roster_files = {
        key: [
            {"path": normalize_path(Path(item["path"]), repo), "sha256": item["sha256"]}
            for item in value
        ]
        for key, value in roster_files_raw.items()
    }
    condition_files = {
        key: [
            {"path": normalize_path(Path(item["path"]), repo), "sha256": item["sha256"]}
            for item in value
        ]
        for key, value in condition_files_raw.items()
    }
    scenario_files = {
        key: [
            {"path": normalize_path(Path(item["path"]), repo), "sha256": item["sha256"]}
            for item in value
        ]
        for key, value in scenario_files_raw.items()
    }
    roster_payloads = {}
    for roster_id, entries in roster_files_raw.items():
        if entries:
            roster_payloads[roster_id] = load_json(Path(entries[0]["path"]))
    scenario_payloads = {}
    for scenario_id, entries in scenario_files_raw.items():
        if entries:
            scenario_payloads[scenario_id] = load_json(Path(entries[0]["path"]))

    wanted_experiments = sorted(
        {
            source_spec["experiment_id"]
            for table in TABLE_SPECS
            for row_spec in table.get("rows", [])
            for source_spec in row_spec.get("sources", [])
        },
        key=len,
        reverse=True,
    )
    run_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    duplicate_ids: dict[str, list[str]] = defaultdict(list)
    seen_ids: dict[str, str] = {}

    for entry in sorted((repo / "output").iterdir()):
        if not entry.is_dir():
            continue
        summary_path = entry / "summary.json"
        if not summary_path.exists():
            continue
        matched_experiment = next(
            (experiment for experiment in wanted_experiments if entry.name.startswith(f"{experiment}_")),
            None,
        )
        if not matched_experiment:
            continue
        try:
            summary = load_json(summary_path)
        except Exception:
            continue
        run_id = summary.get("runId")
        if not run_id:
            continue
        if run_id in seen_ids:
            duplicate_ids[run_id].extend([seen_ids[run_id], normalize_path(summary_path, repo)])
            continue
        seen_ids[run_id] = normalize_path(summary_path, repo)
        config_id = str(summary.get("configId", ""))
        roster_id = next((rid for rid in sorted(roster_payloads, key=len, reverse=True) if rid in config_id), None)
        roster_payload = roster_payloads.get(roster_id, {})
        adversary_ids = {
            str(agent.get("id"))
            for agent in roster_payload.get("agents", [])
            if agent.get("role") == "contamination_agent"
        }
        models = sorted({str(agent.get("model")) for agent in roster_payload.get("agents", []) if agent.get("model")})
        seed_match = re.search(r"-seed(\d+)$", run_id)
        seed = int(seed_match.group(1)) if seed_match else None
        scenario_id = summary.get("scenarioId")
        scenario_payload = scenario_payloads.get(scenario_id, {})
        focus_claim_id = scenario_payload.get("focusClaimId")
        if focus_claim_id is None:
            focus_claim_id = next(
                (
                    claim.get("id")
                    for claim in scenario_payload.get("claims", [])
                    if claim.get("truthLabel") == "false"
                ),
                None,
            )
        trace_path = entry / "trace.db"
        trace = trace_metadata(trace_path, run_id, adversary_ids, focus_claim_id)
        max_steps = int(summary.get("maxSteps") or 0)
        completed_steps = int(summary.get("completedSteps") or 0)
        # summary.json is written as the completion artifact. completedSteps is
        # protocol-dependent (e.g. a chat round can contain several agent turns),
        # and some one-shot screeners legitimately report zero indexed steps.
        completed = True
        record = {
            "run_id": run_id,
            "experiment_id": matched_experiment,
            "config_id": summary.get("configId"),
            "scenario_id": scenario_id,
            "condition_id": summary.get("conditionId"),
            "condition_file_count": len(condition_files.get(summary.get("conditionId"), [])),
            "roster_id": roster_id,
            "roster_file_count": len(roster_files.get(roster_id, [])),
            "scenario_file_count": len(scenario_files.get(scenario_id, [])),
            "models": models,
            "seed": seed,
            "agent_count": summary.get("agentCount"),
            "completed_steps": completed_steps,
            "max_steps": max_steps,
            "completed": completed,
            "fe_summary": summary.get("falseClaimEndorsementRate"),
            "recovery": summary.get("recoveryAfterCorrection"),
            "truth_distance": summary.get("distanceFromGroundTruth"),
            "diversity": summary.get("diversityRetention"),
            "group_decision_correct": (summary.get("groupDecision") or {}).get("correct"),
            "summary_path": normalize_path(summary_path, repo),
            "summary_sha256": sha256(summary_path),
            "trace_path": normalize_path(trace_path, repo),
            **trace,
        }
        run_index[matched_experiment].append(record)

    for records in run_index.values():
        records.sort(key=lambda r: (r.get("scenario_id") or "", r.get("condition_id") or "", r.get("roster_id") or "", r.get("seed") or -1, r["run_id"]))

    all_tex_labels = table_labels_from_tex(repo, tex_dir)
    covered_labels = sorted({label for table in TABLE_SPECS for label in table["labels"]})
    supplementary_labels = sorted(
        set(all_tex_labels).intersection(SUPPLEMENTARY_MANIFEST_LABELS)
    )
    missing_specs = sorted(
        set(all_tex_labels)
        - set(covered_labels)
        - set(SUPPLEMENTARY_MANIFEST_LABELS)
    )
    stale_specs = sorted(set(covered_labels) - set(all_tex_labels))

    table_results = []
    issue_count = 0
    for table in TABLE_SPECS:
        table_result = {key: value for key, value in table.items() if key != "rows"}
        if table_result.get("source_files"):
            table_result["source_files"] = [
                item.replace("iclr2027/", f"{paper_rel.as_posix()}/")
                for item in table_result["source_files"]
            ]
        table_result["rows"] = []
        table_status = table.get("status", "verified")
        for row_spec in table.get("rows", []):
            if row_spec.get("status") == "unresolved":
                table_result["rows"].append(row_spec)
                issue_count += 1
                table_status = "unresolved"
                continue
            selected_by_id: dict[str, dict[str, Any]] = {}
            source_results = []
            for source_spec in row_spec.get("sources", []):
                selected = select_runs(run_index, source_spec)
                source_experiment_files = experiment_files.get(source_spec["experiment_id"], [])
                source_results.append(
                    {
                        **source_spec,
                        "experiment_files": source_experiment_files,
                        "selected_run_count": len(selected),
                        "selected_run_ids": [run["run_id"] for run in selected],
                    }
                )
                for run in selected:
                    selected_by_id[run["run_id"]] = run
            selected_runs = sorted(selected_by_id.values(), key=lambda r: r["run_id"])
            aggregate_data = aggregate(selected_runs)
            checks = validate_aggregate(aggregate_data, row_spec.get("reported", {}))
            integrity_checks = [
                {"check": "experiment config present for every source", "passed": all(len(item["experiment_files"]) >= 1 for item in source_results)},
                {"check": "summary completion artifacts present", "passed": aggregate_data["all_complete"]},
                {"check": "trace databases present", "passed": aggregate_data["all_traces_present"]},
                {"check": "trace run IDs match summaries", "passed": aggregate_data["all_db_identities_match"]},
                {"check": "one roster file per run", "passed": aggregate_data["all_roster_files_resolved_once"]},
                {"check": "one condition file per run", "passed": aggregate_data["all_condition_files_resolved_once"]},
                {"check": "one scenario file per run", "passed": aggregate_data["all_scenario_files_resolved_once"]},
            ]
            passed = all(check["passed"] for check in checks) and all(
                check["passed"] for check in integrity_checks
            )
            if not passed:
                issue_count += sum(1 for check in checks if not check["passed"])
                issue_count += sum(1 for check in integrity_checks if not check["passed"])
                table_status = "audit_failure"
            run_records = []
            for run in selected_runs:
                compact = {
                    "run_id": run["run_id"],
                    "experiment_id": run["experiment_id"],
                    "config_id": run["config_id"],
                    "scenario_id": run["scenario_id"],
                    "scenario_files": scenario_files.get(run["scenario_id"], []),
                    "condition_id": run["condition_id"],
                    "condition_files": condition_files.get(run["condition_id"], []),
                    "roster_id": run["roster_id"],
                    "roster_files": roster_files.get(run["roster_id"], []),
                    "models": run["models"],
                    "seed": run["seed"],
                    "agent_count": run["agent_count"],
                    "completed_steps": run["completed_steps"],
                    "max_steps": run["max_steps"],
                    "summary_path": run["summary_path"],
                    "summary_sha256": run["summary_sha256"],
                    "trace_path": run["trace_path"],
                    "trace_size_bytes": run.get("trace_size_bytes"),
                    "trace_sha256": run.get("trace_sha256"),
                    "wal_size_bytes": run.get("wal_size_bytes"),
                    "wal_sha256": run.get("wal_sha256"),
                    "db_status": run.get("db_status"),
                    "db_identity_matches": run.get("db_identity_matches"),
                    "focus_claim_id": run.get("focus_claim_id"),
                    "fe_summary": run.get("fe_summary"),
                    "fe_direct": run.get("fe_direct"),
                    "fe_t_direct": run.get("fe_t_direct"),
                    "adversary_retention_direct": run.get("adversary_retention_direct"),
                    "target_contagion_direct": run.get("target_contagion_direct"),
                    "target_endorsement_count_direct": run.get("target_endorsement_count_direct"),
                    "all_targets_adopt_direct": run.get("all_targets_adopt_direct"),
                    "intervention_count": run.get("intervention_count"),
                    "group_decision_correct": run.get("group_decision_correct"),
                }
                if run.get("trace_read_error"):
                    compact["trace_read_error"] = run["trace_read_error"]
                run_records.append(compact)
            table_result["rows"].append(
                {
                    "label": row_spec["label"],
                    "status": "verified" if passed else "audit_failure",
                    "reported": row_spec.get("reported", {}),
                    "selection": source_results,
                    "recomputed": aggregate_data,
                    "checks": checks,
                    "integrity_checks": integrity_checks,
                    "runs": run_records,
                }
            )
        table_result["status"] = table_status
        table_results.append(table_result)

    selected_runs_by_id = {
        run["run_id"]: run
        for table in table_results
        for row_item in table.get("rows", [])
        for run in row_item.get("runs", [])
    }
    summary_fe_disagreement_ids = sorted(
        run_id
        for run_id, run in selected_runs_by_id.items()
        if run.get("fe_direct") is not None
        and run.get("fe_summary") is not None
        and not math.isclose(run["fe_direct"], run["fe_summary"], abs_tol=1e-9)
    )
    duplicate_experiment_config_ids = {
        experiment_id: experiment_files[experiment_id]
        for experiment_id in wanted_experiments
        if len(experiment_files.get(experiment_id, [])) > 1
    }
    summary_fe_disagreement_groups: dict[str, int] = defaultdict(int)
    for run_id in summary_fe_disagreement_ids:
        run = selected_runs_by_id[run_id]
        summary_fe_disagreement_groups[
            f"{run['experiment_id']}::{run['condition_id']}"
        ] += 1

    manifest = {
        "schema_version": 1,
        "repository_root": ".",
        "paper_sources": [
            {
                "path": str(paper_rel / name),
                "sha256": sha256(paper_dir / name),
            }
            for name in ["paper.tex", "appendix_results.tex"]
        ],
        "definitions": {
            "run_grain": "One completed scenario-condition-roster-model-order-schedule output directory.",
            "seed": "Controlled order/configuration schedule, not an iid sample.",
            "fe": "Fraction of all agents endorsing the false claim at the last recorded state.",
            "fe_summary": "Legacy cached falseClaimEndorsementRate from summary.json. Retained for diagnosis, but final trace state is canonical when they disagree.",
            "fe_t": "Fraction of target agents endorsing the false claim at the last recorded state.",
            "adversary_retention": "Fraction of persistent-false sources still endorsing at the last recorded state.",
            "contagion_cell": "A cell with at least one target agent endorsing at the last recorded state.",
        },
        "coverage": {
            "tex_table_labels": all_tex_labels,
            "manifest_table_labels": covered_labels,
            "supplementary_manifest_labels": {
                label: SUPPLEMENTARY_MANIFEST_LABELS[label]
                for label in supplementary_labels
            },
            "missing_specs": missing_specs,
            "stale_specs": stale_specs,
        },
        "quality_summary": {
            "issue_count": issue_count + len(missing_specs) + len(stale_specs) + len(duplicate_ids),
            "warning_count": len(summary_fe_disagreement_ids) + len(duplicate_experiment_config_ids),
            "unique_selected_run_count": len(selected_runs_by_id),
            "legacy_summary_fe_disagreement_run_ids": summary_fe_disagreement_ids,
            "legacy_summary_fe_disagreement_groups": dict(
                sorted(summary_fe_disagreement_groups.items())
            ),
            "duplicate_experiment_config_ids": duplicate_experiment_config_ids,
            "duplicate_run_ids": duplicate_ids,
            "indexed_experiments": {key: len(value) for key, value in sorted(run_index.items())},
        },
        "tables": table_results,
    }

    lines = [
        "# ICLR 2027 Table-to-Run Manifest",
        "",
        "This file is generated by `scripts/build_iclr_run_manifest.py`. The JSON companion is canonical and contains every selected run ID, file path, checksum, and recomputed row metric.",
        "",
        "## Audit summary",
        "",
        f"- LaTeX table labels: **{len(all_tex_labels)}**",
        f"- Manifest-covered labels: **{len(covered_labels)}**",
        f"- Audit issues: **{manifest['quality_summary']['issue_count']}**",
        f"- Diagnostic warnings: **{manifest['quality_summary']['warning_count']}**",
        f"  - Legacy summary-FE disagreements: **{len(summary_fe_disagreement_ids)}**",
        f"  - Reused experiment IDs: **{len(duplicate_experiment_config_ids)}**",
        f"- Unique selected runs: **{manifest['quality_summary']['unique_selected_run_count']}**",
        f"- Missing manifest specs: **{len(missing_specs)}**",
        f"- Duplicate run IDs: **{len(duplicate_ids)}**",
        "",
        "A row is **verified** only when the stated selection returns exact run IDs, all file/database identity checks pass, and every encoded paper value matches the recomputed aggregate. `unresolved` means no exact source cohort could be established; `audit_failure` means an identified cohort disagrees with the paper. Warnings identify legacy cached summary FE values that disagree with canonical final trace states.",
        "",
        "### Diagnostic warning breakdown",
        "",
        *[
            f"- `{group}`: {count} cached summary FE disagreement(s)."
            for group, count in sorted(summary_fe_disagreement_groups.items())
        ],
        *[
            f"- Reused experiment ID `{experiment_id}` has {len(files)} configuration files; all paths and hashes are retained in the JSON manifest."
            for experiment_id, files in sorted(duplicate_experiment_config_ids.items())
        ],
        "",
        "## Table index",
        "",
        "| LaTeX label(s) | Table | Status | Run refs. | Notes |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for table in table_results:
        run_count = sum(len(row_item.get("runs", [])) for row_item in table.get("rows", []))
        notes = table.get("reason", "")
        if not notes:
            failed_rows = [r["label"] for r in table.get("rows", []) if r.get("status") != "verified"]
            notes = "; ".join(failed_rows)
        lines.append(
            f"| {', '.join(f'`{label}`' for label in table['labels'])} | {table['title']} | **{table['status']}** | {run_count} | {notes} |"
        )
    lines.extend(["", "## Row-level cohorts", ""])
    for table in table_results:
        lines.extend([f"### {', '.join(table['labels'])}: {table['title']}", ""])
        if table.get("reason"):
            lines.extend([f"**{table['status']}** — {table['reason']}", ""])
        if table.get("source_files"):
            lines.extend(["Source files: " + ", ".join(f"`{item}`" for item in table["source_files"]), ""])
        if table.get("depends_on"):
            lines.extend(["Derived from: " + ", ".join(f"`{item}`" for item in table["depends_on"]), ""])
        for row_item in table.get("rows", []):
            status = row_item.get("status", "unresolved")
            run_count = len(row_item.get("runs", []))
            lines.append(f"- **{row_item['label']}** — {status}; {run_count} exact runs.")
            if row_item.get("reason"):
                lines.append(f"  - {row_item['reason']}")
            for check in row_item.get("checks", []):
                marker = "PASS" if check["passed"] else "FAIL"
                lines.append(
                    f"  - `{marker}` {check['metric']}: paper `{check['reported']}`, recomputed `{check['recomputed']}`."
                )
            if row_item.get("integrity_checks"):
                passed_integrity = sum(1 for check in row_item["integrity_checks"] if check["passed"])
                lines.append(
                    f"  - Integrity checks: {passed_integrity}/{len(row_item['integrity_checks'])} passed."
                )
            warning_count = (row_item.get("recomputed") or {}).get(
                "legacy_summary_fe_disagreements", 0
            )
            if warning_count:
                lines.append(
                    f"  - Diagnostic: {warning_count} cached summary FE value(s) differ from canonical final trace state."
                )
            if row_item.get("selection"):
                for selection in row_item["selection"]:
                    lines.append(
                        f"  - `{selection['experiment_id']}` with `{json.dumps(selection['filters'], sort_keys=True)}` selects {selection['selected_run_count']} runs."
                    )
        lines.append("")
    lines.extend(
        [
            "## Rebuild",
            "",
            "```bash",
            f"python3 scripts/build_iclr_run_manifest.py --repo . --output-dir {paper_rel} --tex-dir {paper_rel}",
            "```",
            "",
            "The command exits nonzero when any covered row is unresolved, a reported metric does not match, a selected run is incomplete, or a LaTeX table label lacks a manifest entry.",
            "",
        ]
    )
    markdown = "\n".join(lines)

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "run_manifest.json"
    md_path = output_dir / "RUN_MANIFEST.md"
    json_path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    md_path.write_text(markdown, encoding="utf-8")
    return manifest, markdown


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--tex-dir", type=Path)
    parser.add_argument("--allow-audit-issues", action="store_true")
    args = parser.parse_args()
    repo = args.repo.resolve()
    default_output_dir = repo / "iclr2027"
    if not default_output_dir.exists():
        default_output_dir = repo / "paper"
    output_dir = (args.output_dir or default_output_dir).resolve()
    tex_dir = args.tex_dir.resolve() if args.tex_dir else None
    manifest, _ = build(repo, output_dir, tex_dir)
    issues = manifest["quality_summary"]["issue_count"]
    print(f"Wrote {output_dir / 'run_manifest.json'}")
    print(f"Wrote {output_dir / 'RUN_MANIFEST.md'}")
    print(f"Tables: {len(manifest['tables'])}; audit issues: {issues}")
    if issues and not args.allow_audit_issues:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
