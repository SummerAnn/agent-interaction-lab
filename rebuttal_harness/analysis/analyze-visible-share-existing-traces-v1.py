#!/usr/bin/env python3
"""Describe visible-message composition using completed traces only.

This script makes no model or API calls. It analyzes (1) the matched-instruction
Haiku crossover and (2) the completed debate-visibility ablation. Turn-level
rows are descriptive and correlated within speaking-order runs; they are not
treated as independent observations or as a causal mediation analysis.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from statistics import fmean


ROOT = Path(__file__).resolve().parents[1]
PROMPT_AUDIT = ROOT / "analysis" / "prompt-frame-crossover-v2-audit.json"
VISIBILITY_AUDIT = ROOT / "output" / "debate-visibility-ablation-ego-haiku-v1-audit.json"
RECORDING_GRID = ROOT / "output" / "core_recording_rule_interleaved_v1-grid-results.json"
OUTPUT_JSON = ROOT / "analysis" / "visible-share-existing-traces-v1-results.json"
OUTPUT_MD = ROOT / "analysis" / "visible-share-existing-traces-v1-results.md"


def db_rows(db_path: str, sql: str, params: tuple = ()) -> list[dict]:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in db.execute(sql, params)]
    finally:
        db.close()


def shares(visible: list[dict], source_ids: set[str]) -> dict:
    total = len(visible)
    endorsing = sum(row.get("stance") == "endorse" for row in visible)
    source = sum(row.get("agent_id") in source_ids for row in visible)
    source_endorsing = sum(
        row.get("agent_id") in source_ids and row.get("stance") == "endorse"
        for row in visible
    )
    return {
        "visible_count": total,
        "visible_endorsements": endorsing,
        "visible_source_entries": source,
        "visible_source_endorsements": source_endorsing,
        "endorsement_share": None if total == 0 else endorsing / total,
        "source_share": None if total == 0 else source / total,
        "source_share_of_endorsements": None if endorsing == 0 else source_endorsing / endorsing,
    }


def shared_turns(run: dict, dataset: str, order: int | str, condition: str) -> list[dict]:
    db_path = run["dbPath"]
    source_ids = set(run.get("sourceAgentIds") or ["analyst_1", "analyst_7"])
    entries = {
        row["memory_entry_id"]: row
        for row in db_rows(db_path, """
            SELECT memory_entry_id, step_index, agent_id, stance, confidence
            FROM memory_entries
            ORDER BY step_index, memory_entry_id
        """)
    }
    retrieval = {
        (row["step_index"], row["agent_id"]): json.loads(row["retrieved_entry_ids_json"])
        for row in db_rows(db_path, """
            SELECT step_index, agent_id, retrieved_entry_ids_json
            FROM retrieval_traces
            ORDER BY retrieval_trace_id
        """)
    }
    states = db_rows(db_path, """
        SELECT state_id, step_index, agent_id, stance, confidence
        FROM agent_claim_states
        WHERE step_index > 0
        ORDER BY state_id
    """)
    response_number: Counter[str] = Counter()
    turns = []
    for state in states:
        agent_id = state["agent_id"]
        response_number[agent_id] += 1
        if agent_id in source_ids:
            continue
        visible = [entries[entry_id] for entry_id in retrieval.get((state["step_index"], agent_id), [])]
        turns.append({
            "dataset": dataset,
            "condition": condition,
            "protocol": "shared_memory",
            "order": order,
            "run_id": run["runId"],
            "step": state["step_index"],
            "agent_id": agent_id,
            "response_number": response_number[agent_id],
            "response_stance": state["stance"],
            "response_confidence": state["confidence"],
            **shares(visible, source_ids),
        })
    return turns


def debate_turns(
    run: dict,
    dataset: str,
    order: int | str,
    condition: str,
    hide_uncertain: bool = False,
    limit: int | None = None,
) -> list[dict]:
    db_path = run["dbPath"]
    source_ids = set(run.get("sourceAgentIds") or ["analyst_1", "analyst_7"])
    messages = db_rows(db_path, """
        SELECT message_id, step_index, round, agent_id, stance, confidence
        FROM chat_messages
        ORDER BY message_id
    """)
    turns = []
    for index, message in enumerate(messages):
        if message["agent_id"] in source_ids:
            continue
        visible = [row for row in messages[:index] if row["agent_id"] != message["agent_id"]]
        if hide_uncertain:
            visible = [row for row in visible if row["stance"] != "uncertain"]
        if limit is not None:
            visible = visible[-limit:]
        turns.append({
            "dataset": dataset,
            "condition": condition,
            "protocol": "live_debate",
            "order": order,
            "run_id": run["runId"],
            "step": message["message_id"],
            "agent_id": message["agent_id"],
            "response_number": message["round"],
            "response_stance": message["stance"],
            "response_confidence": message["confidence"],
            **shares(visible, source_ids),
        })
    return turns


def mean_or_none(values: list[float]) -> float | None:
    return None if not values else fmean(values)


def summarize_turns(rows: list[dict]) -> dict:
    nonempty = [row for row in rows if row["visible_count"] > 0]
    all_endorse = [row for row in nonempty if row["endorsement_share"] == 1]
    all_source_endorse = [
        row for row in all_endorse
        if row["source_share"] == 1
    ]
    final_rows = [row for row in rows if row["response_number"] == 3]
    first_rows = [row for row in rows if row["response_number"] == 1]
    visible_total = sum(row["visible_count"] for row in rows)
    visible_endorsement_total = sum(row["visible_endorsements"] for row in rows)
    visible_source_total = sum(row["visible_source_entries"] for row in rows)
    return {
        "turns": len(rows),
        "nonempty_turns": len(nonempty),
        "empty_turns": len(rows) - len(nonempty),
        "response_counts": dict(Counter(row["response_stance"] for row in rows)),
        "final_response_counts": dict(Counter(row["response_stance"] for row in final_rows)),
        "first_response_counts": dict(Counter(row["response_stance"] for row in first_rows)),
        "response_counts_by_number": {
            str(number): dict(Counter(
                row["response_stance"] for row in rows if row["response_number"] == number
            ))
            for number in (1, 2, 3)
        },
        "mean_confidence_by_response_number": {
            str(number): mean_or_none([
                row["response_confidence"]
                for row in rows if row["response_number"] == number
            ])
            for number in (1, 2, 3)
        },
        "mean_endorsement_confidence_by_response_number": {
            str(number): mean_or_none([
                row["response_confidence"]
                for row in rows
                if row["response_number"] == number and row["response_stance"] == "endorse"
            ])
            for number in (1, 2, 3)
        },
        "mean_visible_count": mean_or_none([row["visible_count"] for row in rows]),
        "mean_visible_endorsement_count": mean_or_none([
            row["visible_endorsements"] for row in rows
        ]),
        "mean_visible_source_count": mean_or_none([
            row["visible_source_entries"] for row in rows
        ]),
        "mean_endorsement_share_nonempty": mean_or_none([row["endorsement_share"] for row in nonempty]),
        "mean_source_share_nonempty": mean_or_none([row["source_share"] for row in nonempty]),
        "pooled_endorsement_share": (
            None if visible_total == 0 else visible_endorsement_total / visible_total
        ),
        "pooled_source_share": (
            None if visible_total == 0 else visible_source_total / visible_total
        ),
        "visible_composition_by_response_number": {
            str(number): {
                "mean_visible_count": mean_or_none([
                    row["visible_count"]
                    for row in rows if row["response_number"] == number
                ]),
                "mean_endorsement_share_nonempty": mean_or_none([
                    row["endorsement_share"]
                    for row in rows
                    if row["response_number"] == number and row["visible_count"] > 0
                ]),
                "mean_source_share_nonempty": mean_or_none([
                    row["source_share"]
                    for row in rows
                    if row["response_number"] == number and row["visible_count"] > 0
                ]),
            }
            for number in (1, 2, 3)
        },
        "mean_source_share_of_endorsements": mean_or_none([
            row["source_share_of_endorsements"]
            for row in rows if row["source_share_of_endorsements"] is not None
        ]),
        "turns_all_visible_endorse": len(all_endorse),
        "endorse_responses_when_all_visible_endorse": sum(
            row["response_stance"] == "endorse" for row in all_endorse
        ),
        "turns_all_visible_source_endorse": len(all_source_endorse),
        "endorse_responses_when_all_visible_source_endorse": sum(
            row["response_stance"] == "endorse" for row in all_source_endorse
        ),
    }


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    mx, my = fmean(xs), fmean(ys)
    dx = [x - mx for x in xs]
    dy = [y - my for y in ys]
    denominator = math.sqrt(sum(x * x for x in dx) * sum(y * y for y in dy))
    return None if denominator == 0 else sum(x * y for x, y in zip(dx, dy)) / denominator


def order_summary(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, int | str], list[dict]] = defaultdict(list)
    for row in rows:
        grouped[(row["condition"], row["order"])].append(row)
    result = []
    for (condition, order), items in sorted(grouped.items(), key=lambda pair: (pair[0][0], str(pair[0][1]))):
        nonempty = [item for item in items if item["visible_count"] > 0]
        final = [item for item in items if item["response_number"] == 3]
        first = [item for item in items if item["response_number"] == 1]
        result.append({
            "condition": condition,
            "order": order,
            "mean_endorsement_share_nonempty": mean_or_none([item["endorsement_share"] for item in nonempty]),
            "mean_source_share_nonempty": mean_or_none([item["source_share"] for item in nonempty]),
            "final_endorsements": sum(item["response_stance"] == "endorse" for item in final),
            "first_endorsements": sum(item["response_stance"] == "endorse" for item in first),
        })
    return result


def response_summary(rows: list[dict]) -> dict:
    """Summarize responses and the rest of the visible context in one stratum."""
    visible_counts = [row["visible_count"] for row in rows]
    counts = Counter(row["response_stance"] for row in rows)
    return {
        "turns": len(rows),
        "response_counts": dict(counts),
        "endorsement_rate": (
            None if not rows else counts.get("endorse", 0) / len(rows)
        ),
        "mean_visible_count": mean_or_none(visible_counts),
        "visible_count_min": None if not visible_counts else min(visible_counts),
        "visible_count_max": None if not visible_counts else max(visible_counts),
    }


def same_exposure_comparison(rows: list[dict]) -> dict:
    """Compare matched-prompt methods at the same focal exposure counts.

    The focal exposure is response number, visible endorsements, and entries
    written by the two repeating agents. Other visible messages can still
    differ, so these strata are descriptive rather than exchangeable or
    causal comparisons.
    """
    selected = [
        row for row in rows
        if row["condition"] in {"matched_shared", "matched_debate"}
    ]
    grouped: dict[tuple[int, int, int], dict[str, list[dict]]] = defaultdict(
        lambda: defaultdict(list)
    )
    exact_context: dict[tuple[int, int, int, int], dict[str, list[dict]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for row in selected:
        focal_key = (
            row["response_number"],
            row["visible_endorsements"],
            row["visible_source_entries"],
        )
        grouped[focal_key][row["condition"]].append(row)
        exact_key = (*focal_key, row["visible_count"])
        exact_context[exact_key][row["condition"]].append(row)

    overlap = []
    for key, by_condition in sorted(grouped.items()):
        if set(by_condition) != {"matched_shared", "matched_debate"}:
            continue
        response_number, visible_endorsements, visible_source_entries = key
        overlap.append({
            "response_number": response_number,
            "visible_endorsements": visible_endorsements,
            "visible_source_entries": visible_source_entries,
            "shared_memory": response_summary(by_condition["matched_shared"]),
            "live_debate": response_summary(by_condition["matched_debate"]),
        })

    exact_overlap = []
    for key, by_condition in sorted(exact_context.items()):
        if set(by_condition) != {"matched_shared", "matched_debate"}:
            continue
        response_number, visible_endorsements, visible_source_entries, visible_count = key
        exact_overlap.append({
            "response_number": response_number,
            "visible_endorsements": visible_endorsements,
            "visible_source_entries": visible_source_entries,
            "visible_count": visible_count,
            "shared_memory": response_summary(by_condition["matched_shared"]),
            "live_debate": response_summary(by_condition["matched_debate"]),
        })

    high_exposure = {}
    for condition in ("matched_shared", "matched_debate"):
        condition_rows = [
            row for row in selected
            if row["condition"] == condition
            and row["response_number"] in {2, 3}
            and 4 <= row["visible_endorsements"] <= 6
            and row["visible_source_entries"] == row["visible_endorsements"]
        ]
        high_exposure[condition] = response_summary(condition_rows)

    return {
        "scope": (
            "Rows match response number and the counts of visible endorsements and "
            "repeating-agent entries. They do not generally match the total visible "
            "context, which is much larger in debate. The comparison is descriptive, "
            "not a causal estimate of communication method."
        ),
        "overlap_strata": overlap,
        "high_exposure_summary": {
            "definition": (
                "Second or third response with four to six visible endorsements, all "
                "written by the two repeating agents."
            ),
            **high_exposure,
        },
        "exact_total_context_overlap": {
            "scope": (
                "These rows additionally match the total number of visible messages. "
                "Overlap occurs only on first responses with zero or one visible endorsement. "
                "Neither method produces endorsement in these strata."
            ),
            "strata": exact_overlap,
        },
    }


def main() -> None:
    prompt = json.loads(PROMPT_AUDIT.read_text())
    visibility = json.loads(VISIBILITY_AUDIT.read_text())
    recording = json.loads(RECORDING_GRID.read_text())
    if prompt.get("status") != "complete" or prompt.get("failures") or not prompt.get("checks", {}).get("valid"):
        raise SystemExit("Prompt-frame audit is not clean")
    if not visibility.get("eligibleForAnalysis"):
        raise SystemExit("Debate-visibility audit is not clean")

    turns: list[dict] = []
    matched_runs = [
        run for run in prompt["runs"]
        if run["sourceCondition"] == "causal_explanation"
        and run["promptFrame"] == "memory_assessment"
    ]
    for run in matched_runs:
        if run["protocolFlow"] == "shared_memory":
            turns.extend(shared_turns(run, "matched_instructions", run["order"], "matched_shared"))
        elif run["protocolFlow"] == "live_debate":
            turns.extend(debate_turns(run, "matched_instructions", run["order"], "matched_debate"))

    settings = {
        "content_mechanism_live_debate": (False, None),
        "causal_live_debate_hide_uncertain": (True, None),
        "causal_live_debate_last6": (False, 6),
        "causal_live_debate_hide_uncertain_last6": (True, 6),
    }
    for run in visibility["runs"]:
        condition = run["conditionId"]
        order = run["executedOrderId"]
        adapted = {
            "dbPath": run["dbPath"],
            "runId": run["runId"],
            "sourceAgentIds": ["analyst_1", "analyst_7"],
        }
        if condition == "content_mechanism_shared_memory":
            turns.extend(shared_turns(adapted, "visibility_ablation", order, condition))
        else:
            hide_uncertain, limit = settings[condition]
            turns.extend(debate_turns(
                adapted,
                "visibility_ablation",
                order,
                condition,
                hide_uncertain=hide_uncertain,
                limit=limit,
            ))

    recording_conditions = {
        "content_mechanism_shared_memory": "recording_omit_uncertain",
        "content_mechanism_shared_memory_save_uncertain": "recording_save_uncertain",
    }
    recording_cells = [
        cell for cell in recording["cells"] if cell["conditionId"] in recording_conditions
    ]
    for cell in recording_cells:
        adapted = {
            "dbPath": cell["summary"]["dbPath"],
            "runId": cell["summary"]["runId"],
            "sourceAgentIds": ["analyst_1", "analyst_7"],
        }
        turns.extend(shared_turns(
            adapted,
            "recording_rule",
            cell["rosterId"],
            recording_conditions[cell["conditionId"]],
        ))

    expected_matched = 48 * 30
    expected_visibility = 120 * 30
    expected_recording = 48 * 30
    matched_count = sum(row["dataset"] == "matched_instructions" for row in turns)
    visibility_count = sum(row["dataset"] == "visibility_ablation" for row in turns)
    recording_count = sum(row["dataset"] == "recording_rule" for row in turns)
    if (
        matched_count != expected_matched
        or visibility_count != expected_visibility
        or recording_count != expected_recording
    ):
        raise AssertionError((matched_count, visibility_count, recording_count))

    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in turns:
        grouped[row["condition"]].append(row)
    summaries = {key: summarize_turns(value) for key, value in sorted(grouped.items())}
    orders = order_summary(turns)
    exposure_comparison = same_exposure_comparison(turns)

    matched_shared_orders = [row for row in orders if row["condition"] == "matched_shared"]
    correlations = {
        "matched_shared_order_mean_endorsement_share_vs_final_endorsements": pearson(
            [row["mean_endorsement_share_nonempty"] for row in matched_shared_orders],
            [row["final_endorsements"] for row in matched_shared_orders],
        ),
        "matched_shared_order_mean_source_share_vs_final_endorsements": pearson(
            [row["mean_source_share_nonempty"] for row in matched_shared_orders],
            [row["final_endorsements"] for row in matched_shared_orders],
        ),
        "matched_shared_order_mean_endorsement_share_vs_first_endorsements": pearson(
            [row["mean_endorsement_share_nonempty"] for row in matched_shared_orders],
            [row["first_endorsements"] for row in matched_shared_orders],
        ),
        "matched_shared_order_mean_source_share_vs_first_endorsements": pearson(
            [row["mean_source_share_nonempty"] for row in matched_shared_orders],
            [row["first_endorsements"] for row in matched_shared_orders],
        ),
    }

    result = {
        "status": "pass",
        "scope": (
            "Descriptive analysis of completed traces. Turn-level rows are correlated within runs, "
            "and visible composition is partly affected by earlier neutral responses. These results "
            "do not identify a causal mediator."
        ),
        "inputs": {
            "prompt_frame_audit": str(PROMPT_AUDIT.relative_to(ROOT)),
            "visibility_audit": str(VISIBILITY_AUDIT.relative_to(ROOT)),
            "matched_runs": len(matched_runs),
            "visibility_runs": len(visibility["runs"]),
            "recording_rule_runs": len(recording_cells),
        },
        "summaries": summaries,
        "matched_focal_exposure_comparison": exposure_comparison,
        "order_level_correlations": correlations,
        "order_summaries": orders,
    }
    OUTPUT_JSON.write_text(json.dumps(result, indent=2) + "\n")

    lines = [
        "# Visible-share analysis from existing traces",
        "",
        result["scope"],
        "",
        "| Condition | Neutral turns | Mean visible count | Mean endorsement share | Mean source share | Endorsing responses / turns when all visible items endorse | Final E/R/U |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for condition, summary in summaries.items():
        final = summary["final_response_counts"]
        lines.append(
            f"| {condition} | {summary['turns']} | {summary['mean_visible_count']:.3f} | "
            f"{summary['mean_endorsement_share_nonempty']:.3f} | "
            f"{summary['mean_source_share_nonempty']:.3f} | "
            f"{summary['endorse_responses_when_all_visible_endorse']}/{summary['turns_all_visible_endorse']} | "
            f"{final.get('endorse', 0)}/{final.get('reject', 0)}/{final.get('uncertain', 0)} |"
        )

    lines += [
        "",
        "## Same focal exposure under shared memory and debate",
        "",
        "The next table holds fixed the response number, number of visible endorsements, and number of entries written by the two repeating agents. It does not hold the rest of the visible context fixed.",
        "",
        "| Response | Visible endorsements | Repeating-agent entries | Shared memory endorses / turns | Shared mean total visible | Debate endorses / turns | Debate mean total visible |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for stratum in exposure_comparison["overlap_strata"]:
        shared = stratum["shared_memory"]
        debate = stratum["live_debate"]
        lines.append(
            f"| {stratum['response_number']} | {stratum['visible_endorsements']} | "
            f"{stratum['visible_source_entries']} | "
            f"{shared['response_counts'].get('endorse', 0)}/{shared['turns']} | "
            f"{shared['mean_visible_count']:.3f} | "
            f"{debate['response_counts'].get('endorse', 0)}/{debate['turns']} | "
            f"{debate['mean_visible_count']:.3f} |"
        )

    high = exposure_comparison["high_exposure_summary"]
    shared_high = high["matched_shared"]
    debate_high = high["matched_debate"]
    lines += [
        "",
        f"On second and third responses with four to six visible endorsements from the repeating agents, shared-memory agents endorse in {shared_high['response_counts'].get('endorse', 0)} of {shared_high['turns']} turns ({100 * shared_high['endorsement_rate']:.1f}%), while debate agents endorse in {debate_high['response_counts'].get('endorse', 0)} of {debate_high['turns']}. Debate shows an average of {debate_high['mean_visible_count']:.1f} total earlier messages in these rows, compared with {shared_high['mean_visible_count']:.1f} under shared memory, so this difference cannot be attributed to presentation alone.",
        "",
        "When total visible-message count is matched too, overlap exists only for first responses with zero or one visible endorsement. Neither method produces endorsement in those rows. The completed traces therefore do not provide a fully matched high-exposure comparison.",
        "",
        "## Interpretation",
        "",
        "The shared record makes the visible stream much more endorsement-heavy because uncertain judgments are omitted. This composition is associated with adoption inside shared memory, but it is not a causal explanation by itself. The visible composition is partly produced by the cascade: once neutral agents endorse, their entries increase the endorsement share seen later.",
        "",
        "The matched recording-rule comparison supplies the clearest intervention on composition. Saving uncertain entries lowers the visible endorsement share and changes 185 final endorsements to zero, with all 240 neutral agents remaining uncertain. This supports the claim that selective recording contributes to adoption in this Haiku setting.",
        "",
        "The debate ablations are a narrower check. Hiding uncertain debate messages, limiting debate to six recent messages, or making both changes produces 0, 0, and 1 final false endorsement, compared with 178 under shared memory in the same 24 orders. These debate arms use the discussion instructions, which lead agents to reject at the start, and their visible streams remain dominated by rejections. They therefore rule out those two interface changes under the tested prompt but do not provide a causal mediation test under an uncertain starting point.",
        "",
        "At the same focal exposure of four to six visible repeating-agent endorsements, shared-memory agents sometimes endorse and debate agents do not. The rest of the context is not the same: debate also shows many more messages, including rejections and uncertainty. This comparison therefore narrows the explanation but does not show that presentation alone causes the memory–debate gap.",
        "",
        "Together, the existing data show that selective visibility contributes to the result but do not establish that endorsement share or source share fully explains the memory–debate gap. Source share is also not a monotone predictor: as neutral agents become persuaded, they add endorsements of their own and the fraction written by the two original sources falls.",
        "",
        "Order-level correlations are included in the JSON output for audit, not as independent-sample estimates or causal mediation effects.",
    ]
    OUTPUT_MD.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "status": "pass",
        "json": str(OUTPUT_JSON),
        "markdown": str(OUTPUT_MD),
        "summaries": summaries,
        "order_level_correlations": correlations,
    }, indent=2))


if __name__ == "__main__":
    main()
