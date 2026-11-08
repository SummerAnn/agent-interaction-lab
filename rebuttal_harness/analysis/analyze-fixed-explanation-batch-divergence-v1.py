#!/usr/bin/env python3
"""Audit where the six Haiku fixed-explanation shared-memory batches diverge.

This script is intentionally read-only.  It reconstructs the six batches cited
as the 139--185/240 range in the paper from their audit artifacts, validates
their trace databases, aligns runs by the *executed* first-round speaking
sequence, and reports neutral judgments by response number and early record
contents.

The script does not treat cross-batch differences as randomized contrasts.
The batches were run at different times and some were embedded in different
grids.  Alignment is therefore descriptive and is used only to locate the
first observable divergence and to select locked replay candidates.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median
from typing import Any, Iterable


TARGET_CONDITION = "content_mechanism_shared_memory"
OUTPUT_REL = Path("rebuttal_harness/output")
ANALYSIS_REL = Path("rebuttal_harness/analysis")


@dataclass(frozen=True)
class BatchSpec:
    batch_id: str
    label: str
    expected_endorsements: int
    artifact: Path
    source_kind: str
    selector: dict[str, Any]


BATCH_SPECS = (
    BatchSpec(
        "content_factorial_2026_10_21",
        "Content factorial (seed 101; two other exact repeats excluded)",
        139,
        ANALYSIS_REL / "content-factorial-v1-audit.json",
        "audit_runs_derived_path",
        {"conditionId": TARGET_CONDITION, "seed": 101},
    ),
    BatchSpec(
        "recording_rule_2026_10_22",
        "Interleaved recording-rule grid",
        185,
        OUTPUT_REL / "core_recording_rule_interleaved_v1-grid-results.json",
        "grid_cells",
        {"conditionId": TARGET_CONDITION, "seed": 606},
    ),
    BatchSpec(
        "debate_visibility_2026_10_31",
        "Debate-visibility ablation batch",
        178,
        OUTPUT_REL / "debate-visibility-ablation-ego-haiku-v1-audit.json",
        "audit_runs_db_path",
        {"conditionId": TARGET_CONDITION},
    ),
    BatchSpec(
        "same_batch_methods_2026_10_31",
        "Shared-memory/debate shuffled batch",
        171,
        ANALYSIS_REL / "experiment-b-same-batch-v1-audit.json",
        "audit_runs_derived_path",
        {"arm": "causal_explanation_shared_memory"},
    ),
    BatchSpec(
        "instruction_crossover_2026_10_31",
        "Instruction crossover (assess + shared memory)",
        155,
        ANALYSIS_REL / "prompt-frame-crossover-v2-audit.json",
        "audit_runs_db_path",
        {"arm": "causal_explanation__shared_memory__memory_assessment"},
    ),
    BatchSpec(
        "confidence_display_2026_11_07",
        "Confidence-display ablation batch (shown version)",
        182,
        ANALYSIS_REL / "confidence-display-ablation-v1-audit.json",
        "audit_runs_db_path",
        {"conditionId": TARGET_CONDITION},
    ),
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def matches(record: dict[str, Any], selector: dict[str, Any]) -> bool:
    return all(record.get(key) == value for key, value in selector.items())


def resolve_manifest_runs(root: Path, spec: BatchSpec) -> list[dict[str, Any]]:
    artifact_path = root / spec.artifact
    data = load_json(artifact_path)
    output_root = root / OUTPUT_REL

    if spec.source_kind == "grid_cells":
        records = [cell for cell in data["cells"] if matches(cell, spec.selector)]
        return [
            {
                "runId": cell["summary"]["runId"],
                "dbPath": cell["summary"]["dbPath"],
                "rosterId": cell["rosterId"],
                "artifact": str(artifact_path),
            }
            for cell in records
        ]

    records = [run for run in data["runs"] if matches(run, spec.selector)]
    resolved: list[dict[str, Any]] = []
    for run in records:
        db_path = run.get("dbPath")
        if not db_path:
            db_path = str(output_root / run["runId"] / "trace.db")
        resolved.append(
            {
                **run,
                "dbPath": db_path,
                "artifact": str(artifact_path),
            }
        )
    return resolved


def counter_dict(values: Iterable[str]) -> dict[str, int]:
    counts = Counter(values)
    return {key: counts.get(key, 0) for key in ("endorse", "reject", "uncertain")}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_json(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256_text(encoded)


def completed_run_row(connection: sqlite3.Connection) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM runs WHERE status = 'completed' ORDER BY rowid DESC LIMIT 1"
    ).fetchone()
    if row is None:
        raise ValueError("trace has no completed run row")
    return row


def parse_json(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def load_trace(root: Path, batch_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
    raw_path = Path(manifest["dbPath"])
    db_path = raw_path if raw_path.is_absolute() else root / raw_path
    if not db_path.exists() and raw_path.is_absolute():
        # Audit files contain the original absolute workspace.  Fall back to
        # the current checkout by locating the path under harness/output.
        marker = "rebuttal_harness/output/"
        if marker in str(raw_path):
            db_path = root / OUTPUT_REL / str(raw_path).split(marker, 1)[1]
    if not db_path.exists():
        raise FileNotFoundError(db_path)

    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        run_row = completed_run_row(connection)
        run_id = str(run_row["run_id"]).removesuffix("__finalized")
        base_run = connection.execute(
            "SELECT * FROM runs WHERE run_id = ? LIMIT 1", (run_id,)
        ).fetchone()
        if base_run is None:
            raise ValueError(f"missing base run row for {run_id}")

        calls = connection.execute(
            "SELECT step_index, agent_id, model_name, completion_tokens, created_at "
            "FROM model_calls WHERE run_id = ? ORDER BY step_index",
            (run_id,),
        ).fetchall()
        events = connection.execute(
            "SELECT step_index, agent_id, event_type, output_json, created_at "
            "FROM events WHERE run_id = ? AND event_type IN "
            "('agent_step', 'fixed_source_statement') ORDER BY step_index",
            (run_id,),
        ).fetchall()
        states = connection.execute(
            "SELECT step_index, agent_id, stance, score, confidence "
            "FROM agent_claim_states WHERE run_id = ? ORDER BY step_index, state_id",
            (run_id,),
        ).fetchall()
        entries = connection.execute(
            "SELECT memory_entry_id, step_index, agent_id, stance, confidence, "
            "visibility, source_type, entry_text FROM memory_entries "
            "WHERE run_id = ? ORDER BY step_index, memory_entry_id",
            (run_id,),
        ).fetchall()
        retrievals = connection.execute(
            "SELECT step_index, agent_id, retrieved_entry_ids_json, context_json "
            "FROM retrieval_traces WHERE run_id = ? ORDER BY step_index",
            (run_id,),
        ).fetchall()
    finally:
        connection.close()

    initial_states = [row for row in states if row["step_index"] == 0]
    updated_states = [row for row in states if row["step_index"] > 0]
    liar_ids = {row["agent_id"] for row in initial_states if row["stance"] == "endorse"}
    neutral_ids = {row["agent_id"] for row in initial_states if row["stance"] != "endorse"}

    # One event and one updated state should describe every executed step.
    event_by_step = {row["step_index"]: row for row in events}
    state_by_step = {row["step_index"]: row for row in updated_states}
    executed = [event_by_step[step]["agent_id"] for step in sorted(event_by_step)]
    first_round = executed[:12]
    order_key = ">".join(first_round)
    repeated_order = all(executed[offset : offset + 12] == first_round for offset in (0, 12, 24))

    response_number: dict[str, int] = defaultdict(int)
    neutral_responses: list[dict[str, Any]] = []
    all_responses: list[dict[str, Any]] = []
    for step in sorted(state_by_step):
        state = state_by_step[step]
        agent_id = state["agent_id"]
        response_number[agent_id] += 1
        item = {
            "step": step,
            "agentId": agent_id,
            "role": "liar" if agent_id in liar_ids else "neutral",
            "responseNumber": response_number[agent_id],
            "stance": state["stance"],
            "confidence": state["confidence"],
        }
        all_responses.append(item)
        if agent_id in neutral_ids:
            neutral_responses.append(item)

    entry_by_id = {row["memory_entry_id"]: dict(row) for row in entries}
    retrieval_by_step = {row["step_index"]: row for row in retrievals}
    prompt_audits = {
        row["step_index"]: parse_json(row["context_json"], {}).get("promptAudit")
        for row in retrievals
    }
    prompt_audits = {step: audit for step, audit in prompt_audits.items() if audit}
    for item in neutral_responses:
        audit = prompt_audits.get(item["step"])
        if audit:
            prompt_text = {
                "systemPrompt": audit.get("systemPrompt"),
                "userPrompt": audit.get("userPrompt"),
            }
            request_contract = {
                key: audit.get(key)
                for key in (
                    "model",
                    "temperature",
                    "maxTokens",
                    "systemPrompt",
                    "userPrompt",
                    "responseMode",
                    "structuredOutputName",
                    "structuredOutputSchema",
                )
            }
            item["promptTextHash"] = sha256_json(prompt_text)
            item["requestContractHash"] = sha256_json(request_contract)
        else:
            item["promptTextHash"] = None
            item["requestContractHash"] = None
    first_neutral = neutral_responses[0]
    first_retrieval = retrieval_by_step.get(first_neutral["step"])
    first_visible_ids = (
        parse_json(first_retrieval["retrieved_entry_ids_json"], []) if first_retrieval else []
    )
    first_visible = [entry_by_id[item] for item in first_visible_ids if item in entry_by_id]
    first_neutral_prompt_audit = prompt_audits.get(first_neutral["step"])
    first_neutral_prompt_text = None
    first_neutral_prompt_contract = None
    if first_neutral_prompt_audit:
        first_neutral_prompt_text = {
            "systemPrompt": first_neutral_prompt_audit.get("systemPrompt"),
            "userPrompt": first_neutral_prompt_audit.get("userPrompt"),
        }
        first_neutral_prompt_contract = {
            key: first_neutral_prompt_audit.get(key)
            for key in (
                "model",
                "temperature",
                "maxTokens",
                "systemPrompt",
                "userPrompt",
                "responseMode",
                "structuredOutputName",
                "structuredOutputSchema",
            )
        }

    neutral_by_response: dict[int, list[dict[str, Any]]] = {
        number: [item for item in neutral_responses if item["responseNumber"] == number]
        for number in (1, 2, 3)
    }
    final_by_agent = {
        item["agentId"]: item
        for item in neutral_responses
        if item["responseNumber"] == 3
    }

    first_neutral_entry = next(
        (dict(row) for row in entries if row["agent_id"] in neutral_ids), None
    )
    first_entry = dict(entries[0]) if entries else None
    source_texts = {
        parse_json(row["output_json"], {}).get("text", "")
        for row in events
        if row["event_type"] == "fixed_source_statement"
    }
    source_texts.discard("")

    def entry_counts(max_step: int) -> dict[str, int]:
        selected = [row for row in entries if row["step_index"] <= max_step]
        return {
            "total": len(selected),
            "liarEndorse": sum(
                row["agent_id"] in liar_ids and row["stance"] == "endorse"
                for row in selected
            ),
            "neutralEndorse": sum(
                row["agent_id"] in neutral_ids and row["stance"] == "endorse"
                for row in selected
            ),
            "neutralReject": sum(
                row["agent_id"] in neutral_ids and row["stance"] == "reject"
                for row in selected
            ),
        }

    first_endorse = next(
        (index + 1 for index, item in enumerate(neutral_responses) if item["stance"] == "endorse"),
        None,
    )
    first_round_first_endorse = next(
        (
            index + 1
            for index, item in enumerate(neutral_by_response[1])
            if item["stance"] == "endorse"
        ),
        None,
    )

    return {
        "batchId": batch_id,
        "runId": run_id,
        "dbPath": str(db_path),
        "artifact": manifest["artifact"],
        "scenarioId": base_run["scenario_id"],
        "conditionId": base_run["condition_id"],
        "seed": base_run["seed"],
        "createdAt": run_row["created_at"],
        "modelNames": sorted({row["model_name"] for row in calls}),
        "maxCompletionTokens": max(row["completion_tokens"] for row in calls),
        "callCount": len(calls),
        "eventCount": len(events),
        "executedStepCount": len(event_by_step),
        "fixedSourceStatementCount": sum(
            row["event_type"] == "fixed_source_statement" for row in events
        ),
        "updatedStateCount": len(updated_states),
        "initialAgentCount": len(initial_states),
        "liarIds": sorted(liar_ids),
        "neutralIds": sorted(neutral_ids),
        "initialStanceCounts": counter_dict(row["stance"] for row in initial_states),
        "executedOrder": first_round,
        "executedOrderKey": order_key,
        "orderRepeatsAcrossRounds": repeated_order,
        "neutralResponses": neutral_responses,
        "responseCounts": {
            str(number): counter_dict(item["stance"] for item in neutral_by_response[number])
            for number in (1, 2, 3)
        },
        "finalCounts": counter_dict(item["stance"] for item in final_by_agent.values()),
        "firstNeutral": first_neutral,
        "firstNeutralVisible": {
            "entryIds": first_visible_ids,
            "count": len(first_visible),
            "liarEndorse": sum(
                item["agent_id"] in liar_ids and item["stance"] == "endorse"
                for item in first_visible
            ),
            "neutralEndorse": sum(
                item["agent_id"] in neutral_ids and item["stance"] == "endorse"
                for item in first_visible
            ),
        },
        "promptAuditCount": len(prompt_audits),
        "promptAuditsByStep": {str(step): audit for step, audit in prompt_audits.items()},
        "firstNeutralPromptAudit": first_neutral_prompt_audit,
        "firstNeutralPromptTextHash": (
            sha256_json(first_neutral_prompt_text) if first_neutral_prompt_text else None
        ),
        "firstNeutralRequestContractHash": (
            sha256_json(first_neutral_prompt_contract)
            if first_neutral_prompt_contract
            else None
        ),
        "firstSavedEntry": first_entry,
        "firstNeutralSavedEntry": first_neutral_entry,
        "entriesAfterRound1": entry_counts(12),
        "entriesAfterRound2": entry_counts(24),
        "entriesAfterRound3": entry_counts(36),
        "firstNeutralEndorsementRankAllResponses": first_endorse,
        "firstNeutralEndorsementRankRound1": first_round_first_endorse,
        "sourceTextHashes": sorted(sha256_text(text) for text in source_texts),
        "sourceTexts": sorted(source_texts),
    }


def add_counts(records: Iterable[dict[str, int]]) -> dict[str, int]:
    total = Counter()
    for record in records:
        total.update(record)
    return {key: total.get(key, 0) for key in ("endorse", "reject", "uncertain")}


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    xbar, ybar = mean(xs), mean(ys)
    numerator = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys))
    xsum = sum((x - xbar) ** 2 for x in xs)
    ysum = sum((y - ybar) ** 2 for y in ys)
    denominator = math.sqrt(xsum * ysum)
    return numerator / denominator if denominator else None


def summarize_batch(spec: BatchSpec, runs: list[dict[str, Any]]) -> dict[str, Any]:
    final_counts = add_counts(run["finalCounts"] for run in runs)
    response_counts = {
        str(number): add_counts(run["responseCounts"][str(number)] for run in runs)
        for number in (1, 2, 3)
    }
    first_neutral_counts = counter_dict(run["firstNeutral"]["stance"] for run in runs)
    first_saved_roles = Counter(
        (
            "none"
            if run["firstSavedEntry"] is None
            else (
                "liar"
                if run["firstSavedEntry"]["agent_id"] in run["liarIds"]
                else "neutral"
            )
        )
        for run in runs
    )
    first_neutral_saved_stances = counter_dict(
        run["firstNeutralSavedEntry"]["stance"]
        for run in runs
        if run["firstNeutralSavedEntry"] is not None
    )
    per_order = []
    for run in runs:
        per_order.append(
            {
                "executedOrderKey": run["executedOrderKey"],
                "runId": run["runId"],
                "response1Endorse": run["responseCounts"]["1"]["endorse"],
                "response2Endorse": run["responseCounts"]["2"]["endorse"],
                "response3Endorse": run["responseCounts"]["3"]["endorse"],
                "firstNeutralStance": run["firstNeutral"]["stance"],
                "firstNeutralVisibleLiarEndorse": run["firstNeutralVisible"]["liarEndorse"],
                "neutralEntriesAfterRound1": run["entriesAfterRound1"]["neutralEndorse"],
                "neutralEntriesAfterRound2": run["entriesAfterRound2"]["neutralEndorse"],
                "firstNeutralEndorsementRankAllResponses": run[
                    "firstNeutralEndorsementRankAllResponses"
                ],
            }
        )

    within_r1_final = pearson(
        [row["response1Endorse"] for row in per_order],
        [row["response3Endorse"] for row in per_order],
    )
    return {
        "batchId": spec.batch_id,
        "label": spec.label,
        "expectedFinalEndorsements": spec.expected_endorsements,
        "observedFinalCounts": final_counts,
        "responseCounts": response_counts,
        "firstNeutralResponsePerRun": first_neutral_counts,
        "ordersWithAnyResponse1Endorsement": sum(
            row["response1Endorse"] > 0 for row in per_order
        ),
        "ordersWithAnyFinalEndorsement": sum(
            row["response3Endorse"] > 0 for row in per_order
        ),
        "ordersWithCompleteFinalSpread": sum(
            row["response3Endorse"] == 10 for row in per_order
        ),
        "meanNeutralEndorsementsPerOrder": {
            "response1": mean(row["response1Endorse"] for row in per_order),
            "response2": mean(row["response2Endorse"] for row in per_order),
            "response3": mean(row["response3Endorse"] for row in per_order),
        },
        "firstSavedEntryRole": dict(sorted(first_saved_roles.items())),
        "firstNeutralSavedEntryStance": first_neutral_saved_stances,
        "savedEntriesAfterRound1Totals": {
            key: sum(run["entriesAfterRound1"][key] for run in runs)
            for key in ("liarEndorse", "neutralEndorse", "neutralReject")
        },
        "meanNeutralSavedEndorsements": {
            "afterRound1": mean(
                run["entriesAfterRound1"]["neutralEndorse"] for run in runs
            ),
            "afterRound2": mean(
                run["entriesAfterRound2"]["neutralEndorse"] for run in runs
            ),
            "afterRound3": mean(
                run["entriesAfterRound3"]["neutralEndorse"] for run in runs
            ),
        },
        "withinBatchCorrelationResponse1VsFinal": within_r1_final,
        "executionWindow": {
            "first": min(run["createdAt"] for run in runs),
            "last": max(run["createdAt"] for run in runs),
        },
        "models": sorted({model for run in runs for model in run["modelNames"]}),
        "sourceTextHashes": sorted(
            {item for run in runs for item in run["sourceTextHashes"]}
        ),
        "perOrder": per_order,
    }


def response_signature(run: dict[str, Any]) -> list[tuple[str, str, int]]:
    return [
        (item["agentId"], item["stance"], item["responseNumber"])
        for item in run["neutralResponses"]
    ]


def paired_divergence(
    batch_a: str,
    batch_b: str,
    maps: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    shared_orders = sorted(set(maps[batch_a]) & set(maps[batch_b]))
    first_differences: list[int] = []
    first_round_differences = 0
    identical_all_neutral = 0
    rows = []
    for order_key in shared_orders:
        run_a, run_b = maps[batch_a][order_key], maps[batch_b][order_key]
        sig_a, sig_b = response_signature(run_a), response_signature(run_b)
        if [item[0] for item in sig_a] != [item[0] for item in sig_b]:
            raise ValueError(f"neutral sequence mismatch for {order_key}")
        first = next(
            (index + 1 for index, (left, right) in enumerate(zip(sig_a, sig_b)) if left != right),
            None,
        )
        if first is None:
            identical_all_neutral += 1
        else:
            first_differences.append(first)
            if first <= 10:
                first_round_differences += 1
        rows.append(
            {
                "executedOrderKey": order_key,
                "firstDifferentNeutralResponse": first,
                "finalEndorseA": run_a["finalCounts"]["endorse"],
                "finalEndorseB": run_b["finalCounts"]["endorse"],
                "round1EndorseA": run_a["responseCounts"]["1"]["endorse"],
                "round1EndorseB": run_b["responseCounts"]["1"]["endorse"],
            }
        )
    return {
        "batchA": batch_a,
        "batchB": batch_b,
        "alignedOrders": len(shared_orders),
        "ordersIdenticalAcrossAll30NeutralResponses": identical_all_neutral,
        "ordersFirstDifferingInRound1": first_round_differences,
        "medianFirstDifferentNeutralResponse": (
            median(first_differences) if first_differences else None
        ),
        "minFirstDifferentNeutralResponse": min(first_differences) if first_differences else None,
        "perOrder": rows,
    }


def saved_prompt_comparison(
    batch_a: str,
    batch_b: str,
    maps: dict[str, dict[str, dict[str, Any]]],
) -> dict[str, Any]:
    shared_orders = sorted(set(maps[batch_a]) & set(maps[batch_b]))
    rows = []
    contract_fields = (
        "model",
        "temperature",
        "maxTokens",
        "systemPrompt",
        "userPrompt",
        "responseMode",
        "structuredOutputName",
        "structuredOutputSchema",
    )
    differing_fields: set[str] = set()
    for order_key in shared_orders:
        left = maps[batch_a][order_key]
        right = maps[batch_b][order_key]
        left_audit = left["firstNeutralPromptAudit"]
        right_audit = right["firstNeutralPromptAudit"]
        if not left_audit or not right_audit:
            raise ValueError(f"missing saved prompt audit for {order_key}")
        differing_fields.update(
            key for key in contract_fields if left_audit.get(key) != right_audit.get(key)
        )
        left_responses = left["neutralResponses"]
        right_responses = right["neutralResponses"]
        left_sequence = [
            (item["agentId"], item["responseNumber"]) for item in left_responses
        ]
        right_sequence = [
            (item["agentId"], item["responseNumber"]) for item in right_responses
        ]
        if left_sequence != right_sequence:
            raise ValueError(f"neutral sequence mismatch for {order_key}")
        first_output_difference = next(
            (
                index
                for index, (left_item, right_item) in enumerate(
                    zip(left_responses, right_responses)
                )
                if left_item["stance"] != right_item["stance"]
                or left_item["confidence"] != right_item["confidence"]
            ),
            None,
        )
        prompt_match_at_difference = None
        contract_match_at_difference = None
        if first_output_difference is not None:
            prompt_match_at_difference = (
                left_responses[first_output_difference]["promptTextHash"]
                == right_responses[first_output_difference]["promptTextHash"]
            )
            contract_match_at_difference = (
                left_responses[first_output_difference]["requestContractHash"]
                == right_responses[first_output_difference]["requestContractHash"]
            )
        rows.append(
            {
                "executedOrderKey": order_key,
                "sameAgent": left["firstNeutral"]["agentId"]
                == right["firstNeutral"]["agentId"],
                "promptTextExact": left["firstNeutralPromptTextHash"]
                == right["firstNeutralPromptTextHash"],
                "fullRequestContractExact": left["firstNeutralRequestContractHash"]
                == right["firstNeutralRequestContractHash"],
                "maxTokensA": left_audit.get("maxTokens"),
                "maxTokensB": right_audit.get("maxTokens"),
                "originalStanceA": left["firstNeutral"]["stance"],
                "originalStanceB": right["firstNeutral"]["stance"],
                "firstDifferentNeutralOutputRank": (
                    first_output_difference + 1
                    if first_output_difference is not None
                    else None
                ),
                "promptTextExactAtFirstOutputDifference": prompt_match_at_difference,
                "fullContractExactAtFirstOutputDifference": contract_match_at_difference,
            }
        )
    return {
        "batchA": batch_a,
        "batchB": batch_b,
        "alignedOrders": len(rows),
        "sameFirstNeutralAgent": sum(row["sameAgent"] for row in rows),
        "exactSystemAndUserPrompt": sum(row["promptTextExact"] for row in rows),
        "exactFullRequestContract": sum(row["fullRequestContractExact"] for row in rows),
        "ordersWithAnyOutputDifference": sum(
            row["firstDifferentNeutralOutputRank"] is not None for row in rows
        ),
        "ordersWhoseFirstOutputDifferenceHasExactPromptText": sum(
            row["promptTextExactAtFirstOutputDifference"] is True for row in rows
        ),
        "ordersWhoseFirstOutputDifferenceHasExactFullContract": sum(
            row["fullContractExactAtFirstOutputDifference"] is True for row in rows
        ),
        "differingRequestContractFields": sorted(differing_fields),
        "maxObservedCompletionTokens": {
            batch_a: max(run["maxCompletionTokens"] for run in maps[batch_a].values()),
            batch_b: max(run["maxCompletionTokens"] for run in maps[batch_b].values()),
        },
        "contractDifference": (
            "The saved system and user prompts match for all aligned first-neutral calls, "
            "but the older crossover used maxTokens=1024 and the confidence-display batch "
            "used maxTokens=384. They are prompt-text matched, not exact request-contract "
            "replicates."
        ),
        "perOrder": rows,
    }


def replay_candidates(
    saved_prompt_runs: list[dict[str, Any]],
    *,
    neutral_response_rank: int,
    selection_rule: str,
) -> list[dict[str, Any]]:
    candidates = []
    for run in sorted(saved_prompt_runs, key=lambda item: item["executedOrderKey"]):
        selected = run["neutralResponses"][neutral_response_rank - 1]
        prompt_audit = run["promptAuditsByStep"].get(str(selected["step"]))
        if not prompt_audit:
            raise ValueError(f"candidate lacks exact saved prompt: {run['runId']}")
        prompt_text = {
            "systemPrompt": prompt_audit.get("systemPrompt"),
            "userPrompt": prompt_audit.get("userPrompt"),
        }
        request_contract = {
            key: prompt_audit.get(key)
            for key in (
                "model",
                "temperature",
                "maxTokens",
                "systemPrompt",
                "userPrompt",
                "responseMode",
                "structuredOutputName",
                "structuredOutputSchema",
            )
        }
        candidates.append(
            {
                "selectionRule": selection_rule,
                "runId": run["runId"],
                "dbPath": run["dbPath"],
                "createdAt": run["createdAt"],
                "executedOrderKey": run["executedOrderKey"],
                "neutralResponseRank": neutral_response_rank,
                "step": selected["step"],
                "agentId": selected["agentId"],
                "agentResponseNumber": selected["responseNumber"],
                "originalStance": selected["stance"],
                "originalConfidence": selected["confidence"],
                "requestContractHash": sha256_json(request_contract),
                "promptTextHash": sha256_json(prompt_text),
                "promptAudit": prompt_audit,
                "note": "The complete provider request contract is saved in promptAudit.",
            }
        )
    return candidates


def validate(spec: BatchSpec, runs: list[dict[str, Any]]) -> dict[str, Any]:
    order_keys = [run["executedOrderKey"] for run in runs]
    conditions = sorted({run["conditionId"] for run in runs})
    scenarios = sorted({run["scenarioId"] for run in runs})
    final_endorse = sum(run["finalCounts"]["endorse"] for run in runs)
    return {
        "batchId": spec.batch_id,
        "manifestRuns": len(runs),
        "uniqueRunIds": len({run["runId"] for run in runs}),
        "uniqueExecutedOrders": len(set(order_keys)),
        "conditions": conditions,
        "scenarios": scenarios,
        "allHave36Calls": all(run["callCount"] == 36 for run in runs),
        "allHave36ExecutedSteps": all(run["executedStepCount"] == 36 for run in runs),
        "allHaveSixFixedSourceStatements": all(
            run["fixedSourceStatementCount"] == 6 for run in runs
        ),
        "allHave36UpdatedStates": all(run["updatedStateCount"] == 36 for run in runs),
        "allHave12InitialAgents": all(run["initialAgentCount"] == 12 for run in runs),
        "allHaveTwoLiars": all(len(run["liarIds"]) == 2 for run in runs),
        "allHaveTenNeutralAgents": all(len(run["neutralIds"]) == 10 for run in runs),
        "allNeutralAgentsStartUncertain": all(
            run["initialStanceCounts"] == {"endorse": 2, "reject": 0, "uncertain": 10}
            for run in runs
        ),
        "oneLiarIdentitySet": len({tuple(run["liarIds"]) for run in runs}) == 1,
        "onePinnedModel": len({model for run in runs for model in run["modelNames"]}) == 1,
        "allRepeatOrderAcrossThreeRounds": all(
            run["orderRepeatsAcrossRounds"] for run in runs
        ),
        "promptAuditRuns": sum(run["promptAuditCount"] > 0 for run in runs),
        "allRunsHaveCompletePromptAudit": all(
            run["promptAuditCount"] == 36 for run in runs
        ),
        "observedFinalEndorsements": final_endorse,
        "matchesPaperCount": final_endorse == spec.expected_endorsements,
        "oneSourceTextHash": len(
            {item for run in runs for item in run["sourceTextHashes"]}
        )
        == 1,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Fixed-explanation batch divergence audit",
        "",
        "This is a descriptive audit of the six Haiku shared-memory batches behind the "
        "paper's 139--185/240 range. It does not treat batches as randomized contrasts.",
        "",
        "## Data-quality checks",
        "",
        "| Batch | Runs | Orders | Final E | Expected | Prompt-audit runs | Complete | Window |",
        "|---|---:|---:|---:|---:|---:|:---:|---|",
    ]
    summaries = {item["batchId"]: item for item in report["batchSummaries"]}
    for check in report["dataQuality"]:
        summary = summaries[check["batchId"]]
        complete = all(
            check[key]
            for key in (
                "allHave36Calls",
                "allHave36ExecutedSteps",
                "allHaveSixFixedSourceStatements",
                "allHave36UpdatedStates",
                "allHave12InitialAgents",
                "allHaveTwoLiars",
                "allHaveTenNeutralAgents",
                "allNeutralAgentsStartUncertain",
                "oneLiarIdentitySet",
                "onePinnedModel",
                "allRepeatOrderAcrossThreeRounds",
                "matchesPaperCount",
                "oneSourceTextHash",
            )
        )
        window = summary["executionWindow"]
        lines.append(
            f"| {check['batchId']} | {check['manifestRuns']} | "
            f"{check['uniqueExecutedOrders']} | {check['observedFinalEndorsements']} | "
            f"{summary['expectedFinalEndorsements']} | {check['promptAuditRuns']}/24 | "
            f"{'yes' if complete else 'NO'} | "
            f"{window['first']} to {window['last']} |"
        )

    lines.extend(
        [
            "",
            "All six batches use the same scenario ID, pinned Haiku model, two initial "
            "liar-agent identities, ten initially uncertain neutral agents, 36 calls, and "
            "the same fixed source text. The analysis aligns actual speaking sequences. "
            "It does not assume that roster filenames identify the executed order.",
            "",
            "The batches were run at different times and were embedded in different grids. "
            "Only the instruction-crossover and confidence-display traces retain complete "
            "prompt audits. Cross-batch differences therefore cannot by themselves be "
            "attributed to provider drift.",
            "The six source artifacts do not expose one uniform cryptographic trace-hash "
            "field. This audit therefore identifies traces by the artifact paths and run IDs, "
            "then checks their schema, counts, orders, source text, and reported outcomes "
            "directly.",
            "",
            "## Judgments by response number",
            "",
            "| Batch | Response 1 E/R/U | Response 2 E/R/U | Final E/R/U | First neutral E/R/U |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for summary in report["batchSummaries"]:
        response = summary["responseCounts"]
        first = summary["firstNeutralResponsePerRun"]
        def fmt(item: dict[str, int]) -> str:
            return f"{item['endorse']}/{item['reject']}/{item['uncertain']}"
        lines.append(
            f"| {summary['batchId']} | {fmt(response['1'])} | {fmt(response['2'])} | "
            f"{fmt(response['3'])} | {fmt(first)} |"
        )

    lines.extend(
        [
            "",
            "## Early-record summary",
            "",
            "| Batch | Round-1 record L-E/N-E/N-R | Mean neutral E after round 2 | final | r(round-1, final) |",
            "|---|---:|---:|---:|---:|",
        ]
    )
    for summary in report["batchSummaries"]:
        saved = summary["meanNeutralSavedEndorsements"]
        round1 = summary["savedEntriesAfterRound1Totals"]
        corr = summary["withinBatchCorrelationResponse1VsFinal"]
        lines.append(
            f"| {summary['batchId']} | {round1['liarEndorse']}/"
            f"{round1['neutralEndorse']}/{round1['neutralReject']} | "
            f"{saved['afterRound2']:.2f} | "
            f"{saved['afterRound3']:.2f} | "
            f"{'NA' if corr is None else f'{corr:.3f}'} |"
        )

    first_liar_entries = sum(
        summary["firstSavedEntryRole"].get("liar", 0)
        for summary in report["batchSummaries"]
    )
    lines.extend(
        [
            "",
            f"The first saved entry is written by a liar agent in {first_liar_entries}/144 "
            "aligned runs. After the first round, five batches contain only the two liar "
            "endorsements per run. The instruction-crossover batch additionally saves eight "
            "neutral rejections. No batch has a saved neutral endorsement after round 1.",
        ]
    )

    pooled = report["pooledAssociations"]
    r1_text = (
        "undefined (all first-response endorsement counts are zero)"
        if pooled["response1VsFinalCorrelation"] is None
        else f"{pooled['response1VsFinalCorrelation']:.3f}"
    )
    r2_text = (
        "undefined"
        if pooled["response2VsFinalCorrelation"] is None
        else f"{pooled['response2VsFinalCorrelation']:.3f}"
    )
    lines.extend(
        [
            "",
            "## What the timing does and does not show",
            "",
            f"Across all {pooled['orderBatchObservations']} order-by-batch observations, "
            f"the correlation between the number of first-response endorsements and final "
            f"endorsements is {r1_text}. The correlation between second-response and final "
            f"endorsements is {r2_text}.",
            "These correlations are descriptive. The 144 observations are 24 speaking "
            "orders repeated across six batches, not 144 independent draws.",
            "",
            report["interpretation"]["finding"],
            "",
            report["interpretation"]["limit"],
            "",
            "## Exact saved-prompt comparison",
            "",
            report["savedPromptComparison"]["contractDifference"],
            "Across the 24 aligned orders, the system and user prompt text for the first "
            f"neutral call matches in {report['savedPromptComparison']['exactSystemAndUserPrompt']}/24 "
            "pairs. The full request contract matches in "
            f"{report['savedPromptComparison']['exactFullRequestContract']}/24 because the "
            "token cap differs. The first differing neutral output is elicited by identical "
            "system and user prompt text in "
            f"{report['savedPromptComparison']['ordersWhoseFirstOutputDifferenceHasExactPromptText']}/"
            f"{report['savedPromptComparison']['ordersWithAnyOutputDifference']} orders that "
            "differ at all. No observed completion reaches the smaller 384-token cap, but "
            "the cap remains a request-contract difference.",
            "",
            "## Locked replay candidates",
            "",
            "The JSON report contains 24 candidates selected without looking at replay "
            "outcomes: the first neutral response in each executed speaking order from the "
            "2026-10-31 instruction-crossover assess/shared-memory version. Each candidate "
            "contains the saved prompt audit and request hash, so it can be replayed without "
            "reconstructing an old prompt. The older 139, 171, and 178 batches must not be "
            "called exact-input replay sources because their traces lack prompt audits.",
            "",
            "Because all six batches agree on these first responses, that replay checks the "
            "stability of starting judgments but cannot explain the 139--185 range. The JSON "
            "therefore includes a separate exploratory set at neutral-response rank 16, the "
            "earliest aligned divergence among the five non-crossover batches. That later "
            "set targets the observed divergence but was selected after seeing this audit and "
            "must be labeled exploratory.",
            "",
            "## Reproduction",
            "",
            "```bash",
            "python3 rebuttal_harness/analysis/"
            "analyze-fixed-explanation-batch-divergence-v1.py",
            "```",
            "",
            "The machine-readable output is `fixed-explanation-batch-divergence-v1-results.json` "
            "in the same analysis directory.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[4],
        help="multiagentworld repository root",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        default=Path(__file__).with_name(
            "fixed-explanation-batch-divergence-v1-results.json"
        ),
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=Path(__file__).with_name(
            "fixed-explanation-batch-divergence-v1-results.md"
        ),
    )
    args = parser.parse_args()
    root = args.root.resolve()

    traces: dict[str, list[dict[str, Any]]] = {}
    summaries = []
    checks = []
    for spec in BATCH_SPECS:
        manifests = resolve_manifest_runs(root, spec)
        batch_runs = [load_trace(root, spec.batch_id, item) for item in manifests]
        traces[spec.batch_id] = batch_runs
        checks.append(validate(spec, batch_runs))
        summaries.append(summarize_batch(spec, batch_runs))

    required_boolean_checks = (
        "allHave36Calls",
        "allHave36ExecutedSteps",
        "allHaveSixFixedSourceStatements",
        "allHave36UpdatedStates",
        "allHave12InitialAgents",
        "allHaveTwoLiars",
        "allHaveTenNeutralAgents",
        "allNeutralAgentsStartUncertain",
        "oneLiarIdentitySet",
        "onePinnedModel",
        "allRepeatOrderAcrossThreeRounds",
        "matchesPaperCount",
        "oneSourceTextHash",
    )
    failed = [
        check
        for check in checks
        if check["manifestRuns"] != 24
        or check["uniqueRunIds"] != 24
        or check["uniqueExecutedOrders"] != 24
        or len(check["conditions"]) != 1
        or len(check["scenarios"]) != 1
        or not all(check[key] for key in required_boolean_checks)
    ]
    if failed:
        raise ValueError(f"data-quality validation failed: {failed}")

    # All six should share the same 24 actual speaking sequences.
    run_maps = {
        batch_id: {run["executedOrderKey"]: run for run in runs}
        for batch_id, runs in traces.items()
    }
    all_order_sets = [set(mapping) for mapping in run_maps.values()]
    common_orders = set.intersection(*all_order_sets)
    if len(common_orders) != 24 or any(order_set != common_orders for order_set in all_order_sets):
        raise ValueError("the six batches do not contain the same 24 executed orders")
    all_runs = [run for runs in traces.values() for run in runs]
    if len({run["scenarioId"] for run in all_runs}) != 1:
        raise ValueError("the six batches do not use one scenario")
    if len({tuple(run["liarIds"]) for run in all_runs}) != 1:
        raise ValueError("the six batches do not use one liar-agent identity set")
    if len({model for run in all_runs for model in run["modelNames"]}) != 1:
        raise ValueError("the six batches do not use one pinned model")
    if len({item for run in all_runs for item in run["sourceTextHashes"]}) != 1:
        raise ValueError("the six batches do not use one fixed source text")

    pairwise = [
        paired_divergence(left, right, run_maps)
        for left, right in itertools.combinations(run_maps, 2)
    ]
    observations = [
        {
            "batchId": batch_id,
            "orderKey": run["executedOrderKey"],
            "response1": run["responseCounts"]["1"]["endorse"],
            "response2": run["responseCounts"]["2"]["endorse"],
            "final": run["responseCounts"]["3"]["endorse"],
        }
        for batch_id, runs in traces.items()
        for run in runs
    ]
    r1_final = pearson(
        [item["response1"] for item in observations],
        [item["final"] for item in observations],
    )
    r2_final = pearson(
        [item["response2"] for item in observations],
        [item["final"] for item in observations],
    )
    first_response_totals = {
        summary["batchId"]: summary["responseCounts"]["1"]["endorse"]
        for summary in summaries
    }
    final_totals = {
        summary["batchId"]: summary["observedFinalCounts"]["endorse"]
        for summary in summaries
    }
    first_range = max(first_response_totals.values()) - min(first_response_totals.values())
    final_range = max(final_totals.values()) - min(final_totals.values())
    second_response_totals = {
        summary["batchId"]: summary["responseCounts"]["2"]["endorse"]
        for summary in summaries
    }
    standard_batch_ids = {
        spec.batch_id
        for spec in BATCH_SPECS
        if spec.batch_id != "instruction_crossover_2026_10_31"
    }
    standard_pairwise = [
        item
        for item in pairwise
        if item["batchA"] in standard_batch_ids and item["batchB"] in standard_batch_ids
    ]
    earliest_standard_difference = min(
        item["minFirstDifferentNeutralResponse"]
        for item in standard_pairwise
        if item["minFirstDifferentNeutralResponse"] is not None
    )
    finding = (
        "No neutral agent endorses on its first response in any batch. Five batches have "
        "240/240 uncertain first responses; the instruction-crossover batch instead has "
        "232 uncertain and 8 rejecting judgments. Among the other five batches, aligned "
        f"trajectories first diverge no earlier than neutral response "
        f"{earliest_standard_difference}, in the second round. Second-response endorsement "
        f"totals then span {min(second_response_totals.values())} to "
        f"{max(second_response_totals.values())}, before widening to "
        f"{min(final_totals.values())} to {max(final_totals.values())} at the final response. "
        "The variation therefore does not begin in the first neutral judgments. It first "
        "appears during the second response, and the between-batch range is larger by the "
        "final response."
    )

    report = {
        "analysisId": "fixed-explanation-batch-divergence-v1",
        "scope": {
            "description": (
                "Six Haiku ego-depletion shared-memory batches using the same fixed causal "
                "explanation and 24 position-balanced speaking orders."
            ),
            "causalStatus": "descriptive cross-batch audit; not a randomized contrast",
            "traceIdentity": (
                "The source artifacts do not expose one uniform trace-hash field. Traces are "
                "identified by artifact path and run ID and validated by direct content checks."
            ),
            "excludedExactRepeats": (
                "Seeds 202 and 303 from the 2026-10-21 content factorial are exact repeats "
                "of seed 101 and are not counted as separate batches."
            ),
        },
        "dataQuality": checks,
        "commonExecutedOrdersAcrossAllBatches": len(common_orders),
        "batchSummaries": summaries,
        "pairwiseAlignedDivergence": pairwise,
        "savedPromptComparison": saved_prompt_comparison(
            "instruction_crossover_2026_10_31",
            "confidence_display_2026_11_07",
            run_maps,
        ),
        "pooledAssociations": {
            "orderBatchObservations": len(observations),
            "response1VsFinalCorrelation": r1_final,
            "response2VsFinalCorrelation": r2_final,
            "batchResponse1EndorsementRange": first_range,
            "batchResponse2EndorsementRange": (
                max(second_response_totals.values())
                - min(second_response_totals.values())
            ),
            "batchFinalEndorsementRange": final_range,
        },
        "interpretation": {
            "finding": finding,
            "limit": (
                "The analysis locates the first observable divergence but cannot identify "
                "its external cause. Different execution dates and grid contexts remain "
                "confounded, and the trace databases do not store complete provider "
                "requests. A locked replay is needed to test current-provider drift."
            ),
        },
        "lockedReplayCandidates": replay_candidates(
            traces["instruction_crossover_2026_10_31"],
            neutral_response_rank=1,
            selection_rule=(
                "first neutral response in each executed speaking order from the "
                "2026-10-31 instruction-crossover assess/shared-memory version"
            ),
        ),
        "exploratoryDivergenceTargetedReplayCandidates": replay_candidates(
            traces["instruction_crossover_2026_10_31"],
            neutral_response_rank=16,
            selection_rule=(
                "neutral-response rank 16 in each executed speaking order from the "
                "2026-10-31 instruction-crossover assess/shared-memory version; selected "
                "after the descriptive audit because rank 16 is the earliest aligned "
                "difference among the five non-crossover batches"
            ),
        ),
    }

    args.json_output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.markdown_output.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps({
        "json": str(args.json_output),
        "markdown": str(args.markdown_output),
        "commonOrders": len(common_orders),
        "firstResponseTotals": first_response_totals,
        "finalTotals": final_totals,
        "r1Final": r1_final,
        "r2Final": r2_final,
    }, indent=2))


if __name__ == "__main__":
    main()
