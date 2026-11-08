#!/usr/bin/env python3
"""Build one source-backed table of completed intervention outcomes.

The script makes no model or API calls. It transcribes only counts reported in
the current main text and appendix, checks that each source row is still
present, and writes JSON, CSV, and a readable Markdown table. A blank reject or
uncertain count means that the cited source reports endorsement only. It must
not be interpreted as zero.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path


ANALYSIS_DIR = Path(__file__).resolve().parent
WORKSPACE = Path(__file__).resolve().parents[4]
MAIN = WORKSPACE / "authoritative_source_2026-10-21" / "source" / "main.tex"
APPENDIX = WORKSPACE / "authoritative_source_2026-10-21" / "source" / "appendix_results.tex"
PROTOCOL = WORKSPACE / "rebuttal_harness" / "TRUE_ANSWER_WARNING_V1_PROTOCOL.md"
SIX_AGENT_AUDIT = ANALYSIS_DIR / "six-agent-defense-final-counts-v1-results.json"
OUTPUT_JSON = ANALYSIS_DIR / "intervention-outcome-summary-v1-results.json"
OUTPUT_CSV = ANALYSIS_DIR / "intervention-outcome-summary-v1-results.csv"
OUTPUT_MD = ANALYSIS_DIR / "intervention-outcome-summary-v1-results.md"


def row(
    family: str,
    model: str,
    task: str,
    intervention: str,
    repeated_input: str,
    endorse: int | None,
    reject: int | None,
    uncertain: int | None,
    total: int | None,
    source: str,
    needle: str,
    *,
    timepoint: str = "final",
    status: str = "completed",
    note: str = "",
) -> dict:
    return {
        "family": family,
        "model": model,
        "task": task,
        "intervention": intervention,
        "repeated_input": repeated_input,
        "timepoint": timepoint,
        "endorse": endorse,
        "reject": reject,
        "uncertain": uncertain,
        "total": total,
        "three_way_split_reported": all(value is not None for value in (endorse, reject, uncertain)),
        "status": status,
        "source": source,
        "source_needle": needle,
        "note": note,
    }


def add_main_six_agent(rows: list[dict]) -> None:
    values = [
        ("Standard shared memory", 23, 0, 1, "Standard shared memory & 23/24 & 95.8\\% & 12/12"),
        ("Reliable external check", 0, 24, 0, "Reliable external check & 0/24 & 0.0\\% & 0/12"),
        ("Early correction", 0, 9, 15, "Early correction & 0/24 & 0.0\\% & 0/12"),
        ("Late correction", 7, 2, 15, "Late correction & 7/24 & 29.2\\% & 6/12"),
        ("Older entries shown less prominently", 17, 1, 6, "Older entries shown less prominently & 17/24 & 70.8\\% & 9/12"),
        ("Answer counts and dependence warning", 0, 1, 23, "Answer counts + warning & 0/24 & 0.0\\% & 0/12"),
        ("Earlier-statement links and repetition warning", 0, 0, 24, "Links to earlier statements + warning & 0/24 & 0.0\\% & 0/12"),
    ]
    for intervention, endorse, reject, uncertain, needle in values:
        rows.append(row(
            "Six-agent record changes",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Four agents repeat false claim",
            endorse,
            reject,
            uncertain,
            24,
            "Main Table 2",
            needle,
            note="R/U recovered from the exact archived traces selected for Main Table 2.",
        ))


def add_provenance_across_tasks(rows: list[dict]) -> None:
    topics = {
        "Ego depletion": ([0.500, 0.200, 0.200, 0.000], "Ego depletion & 0.500 & 0.200 & 0.200 & \\textbf{0.000}"),
        "PANDAS": ([0.400, 0.400, 0.300, 0.400], "PANDAS & 0.400 & 0.400 & 0.300 & 0.400"),
        "LK-99": ([0.400, 0.000, 0.000, 0.000], "LK-99 & 0.400 & 0.000 & 0.000 & \\textbf{0.000}"),
        "STAP cells": ([0.100, 0.000, 0.000, 0.000], "STAP cells & 0.100 & 0.000 & 0.000 & \\textbf{0.000}"),
        "Climate attribution": ([0.000, 0.000, 0.000, 0.000], "Climate & 0.000 & 0.000 & 0.000 & 0.000"),
        "MMR/autism": ([0.000, 0.000, 0.000, 0.000], "MMR/autism & 0.000 & 0.000 & 0.000 & 0.000"),
    }
    interventions = [
        "Standard shared memory",
        "Answer counts and dependence warning",
        "One statement per recorded origin",
        "Earlier-statement links and repetition warning",
    ]
    for task, (rates, needle) in topics.items():
        for intervention, rate in zip(interventions, rates):
            rows.append(row(
                "Warnings and origin information across tasks",
                "Claude Haiku 4.5",
                task,
                intervention,
                "Four agents repeat claim",
                round(rate * 10),
                None,
                None,
                10,
                "Appendix Table 44",
                needle,
                note=(
                    "PANDAS reports agreement, not accuracy. Reject and uncertain counts are not reported."
                    if task == "PANDAS"
                    else "Reject and uncertain counts are not reported."
                ),
            ))


def add_warning_model_checks(rows: list[dict]) -> None:
    numerical = {
        "Claude Haiku 4.5": [
            ("Standard shared memory", 24, "Haiku 4.5 & Standard shared memory & 66.7\\% (24/36)"),
            ("Earlier-statement marker", 21, "Haiku 4.5 & Earlier-statement marker & 58.3\\% (21/36)"),
            ("Earlier-statement links and repetition warning", 3, "Haiku 4.5 & Marker + repetition warning & \\textbf{8.3\\% (3/36)}"),
        ],
        "Ministral 8B 2512": [
            ("Standard shared memory", 33, "Ministral 8B 2512 & Standard shared memory & 91.7\\% (33/36)"),
            ("Earlier-statement marker", 25, "Ministral 8B 2512 & Earlier-statement marker & 69.4\\% (25/36)"),
            ("Earlier-statement links and repetition warning", 21, "Ministral 8B 2512 & Marker + repetition warning & \\textbf{58.3\\% (21/36)}"),
        ],
    }
    for model, model_rows in numerical.items():
        for intervention, endorse, needle in model_rows:
            rows.append(row(
                "Warning on numerical task",
                model,
                "6/3 proposed answer 4",
                intervention,
                "Three agents repeat false answer",
                endorse,
                None,
                None,
                36,
                "Appendix Table 46",
                needle,
                note="Reject and uncertain counts are not reported.",
            ))

    crossmodel = {
        "Claude Haiku 4.5": ([0.500, 0.300, 0.000], "Claude Haiku 4.5 & 0.500 & 0.300 & \\textbf{0.000}"),
        "Claude Sonnet 4.6": ([0.500, 0.300, 0.000], "Claude Sonnet 4.6 & 0.500 & 0.300 & \\textbf{0.000}"),
        "GPT-4o-mini": ([0.500, 0.500, 0.200], "GPT-4o-mini & 0.500 & 0.500 & 0.200"),
    }
    interventions = [
        "Standard shared memory",
        "Earlier-statement marker",
        "Earlier-statement links and repetition warning",
    ]
    for model, (rates, needle) in crossmodel.items():
        for intervention, rate in zip(interventions, rates):
            rows.append(row(
                "Warning across models",
                model,
                "Ego depletion",
                intervention,
                "Four agents repeat false claim",
                round(rate * 10),
                None,
                None,
                10,
                "Appendix Table 47",
                needle,
                note="Reject and uncertain counts are not reported.",
            ))


def add_recording_rule(rows: list[dict]) -> None:
    values = [
        ("Claude Haiku 4.5", "Ego depletion", "Explanation of false claim", "Uncertainty omitted", 185, 0, 55, "Haiku 4.5 & Ego depletion & Explanation of false claim & Omitted & 185 & 55 & 0"),
        ("Claude Haiku 4.5", "Ego depletion", "Explanation of false claim", "Uncertainty saved", 0, 0, 240, "Haiku 4.5 & Ego depletion & Explanation of false claim & Saved & 0 & 240 & 0"),
        ("Claude Haiku 4.5", "Ego depletion", "Correct rejection", "Uncertainty omitted", 0, 240, 0, "Haiku 4.5 & Ego depletion & Correct rejection & Omitted & 0 & 0 & 240"),
        ("Claude Haiku 4.5", "Ego depletion", "Correct rejection", "Uncertainty saved", 0, 180, 60, "Haiku 4.5 & Ego depletion & Correct rejection & Saved & 0 & 60 & 180"),
        ("Claude Sonnet 4.6", "PANDAS", "Explanation of claim", "Uncertainty omitted", 0, 0, 240, "Sonnet 4.6 & PANDAS & Explanation of claim & Omitted & 0 & 240 & 0"),
        ("Claude Sonnet 4.6", "PANDAS", "Explanation of claim", "Uncertainty saved", 0, 0, 240, "Sonnet 4.6 & PANDAS & Explanation of claim & Saved & 0 & 240 & 0"),
        ("Claude Opus 4.6", "PANDAS", "Explanation of claim", "Uncertainty omitted", 196, 0, 44, "Opus 4.6 & PANDAS & Explanation of claim & Omitted & 196 & 44 & 0"),
        ("Claude Opus 4.6", "PANDAS", "Explanation of claim", "Uncertainty saved", 0, 0, 240, "Opus 4.6 & PANDAS & Explanation of claim & Saved & 0 & 240 & 0"),
        ("Claude Sonnet 4.6", "SciTaT-A", "Explanation of false claim", "Uncertainty omitted", 240, 0, 0, "Sonnet 4.6 & SciTaT-A & Explanation of false claim & Omitted & 240 & 0 & 0"),
        ("Claude Sonnet 4.6", "SciTaT-A", "Explanation of false claim", "Uncertainty saved", 70, 0, 170, "Sonnet 4.6 & SciTaT-A & Explanation of false claim & Saved & 70 & 170 & 0"),
        ("Claude Opus 4.6", "SciTaT-A", "Explanation of false claim", "Uncertainty omitted", 240, 0, 0, "Opus 4.6 & SciTaT-A & Explanation of false claim & Omitted & 240 & 0 & 0"),
        ("Claude Opus 4.6", "SciTaT-A", "Explanation of false claim", "Uncertainty saved", 240, 0, 0, "Opus 4.6 & SciTaT-A & Explanation of false claim & Saved & 240 & 0 & 0"),
        ("GPT-6.1 Sol", "SciTaT-A", "Explanation of false claim", "Uncertainty omitted", 240, 0, 0, "GPT-6.1 Sol & SciTaT-A & Explanation of false claim & Omitted & 240 & 0 & 0"),
        ("GPT-6.1 Sol", "SciTaT-A", "Explanation of false claim", "Uncertainty saved", 108, 0, 132, "GPT-6.1 Sol & SciTaT-A & Explanation of false claim & Saved & 108 & 132 & 0"),
    ]
    for model, task, repeated, intervention, e, r, u, needle in values:
        rows.append(row(
            "Saving uncertainty",
            model,
            task,
            intervention,
            repeated,
            e,
            r,
            u,
            240,
            "Appendix Table 51",
            needle,
            note="PANDAS is agreement rather than accuracy." if task == "PANDAS" else "",
        ))


def add_full_count_followups(rows: list[dict]) -> None:
    reply_rows = [
        ("Control", 0, 0, 240, "Control & 0 & 240 & 0 & 0/24"),
        ("Answers to earlier entries, links hidden", 0, 40, 200, "Answers to earlier entries, links hidden & 0 & 200 & 40 & 7/24"),
        ("Answers to earlier entries, links shown", 0, 13, 227, "Answers to earlier entries, links shown & 0 & 227 & 13 & 2/24"),
    ]
    for intervention, e, r, u, needle in reply_rows:
        rows.append(row(
            "Answers to earlier entries",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Two agents repeat false explanation",
            e, r, u, 240,
            "Appendix Table 52",
            needle,
        ))

    tool_rows = [
        ("Correct tool result, shared notes", "Correct tool result", 0, 25, 0, "Correct tool result, shared notes & 0/0/25 & 0/0/25"),
        ("False tool result, shared notes", "False tool result", 25, 0, 0, "False tool result, shared notes & 25/0/0 & 25/0/0"),
        ("False tool result, personal notes", "False tool result", 0, 0, 25, "False tool result, personal notes & 0/25/0 & 0/25/0"),
        ("False shared note with verified correction", "False tool result then correct check", 0, 25, 0, "False tool result, shared notes, verified correction & 25/0/0 & 0/0/25"),
    ]
    for intervention, repeated, e, r, u, needle in tool_rows:
        rows.append(row(
            "Tool-result notes",
            "Claude Haiku 4.5",
            "Rollback-threshold calculation",
            intervention,
            repeated,
            e, r, u, 25,
            "Appendix Table 53",
            needle,
        ))

    debate_rows = [
        ("Standard debate", 0, 212, 28, "Standard debate & 0 & 212 & 28"),
        ("Debate, uncertain answers hidden", 0, 217, 23, "Debate, uncertain answers hidden & 0 & 217 & 23"),
        ("Debate, six most recent messages", 0, 240, 0, "Debate, six most recent messages & 0 & 240 & 0"),
        ("Debate, both changes", 1, 238, 1, "Debate, both changes & 1 & 238 & 1"),
        ("Standard shared memory", 178, 1, 61, "Standard shared memory & 178 & 1 & 61"),
    ]
    for intervention, e, r, u, needle in debate_rows:
        rows.append(row(
            "Changing debate visibility",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Two agents repeat false explanation",
            e, r, u, 240,
            "Appendix Table 54",
            needle,
        ))

    corrections = [
        ("Early correction with equal recovery", 0, 240, 0, "Early & 0 & 240 & 0"),
        ("Late correction with equal recovery", 0, 180, 60, "Late & 0 & 180 & 60"),
    ]
    for intervention, e, r, u, needle in corrections:
        rows.append(row(
            "Correction timing",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Two agents repeat false explanation",
            e, r, u, 240,
            "Appendix Table 58",
            needle,
        ))

    removal = {
        "Personal history": {
            "At removal": (183, 0, 57),
            "Turn 1": (21, 0, 219),
            "Turn 2": (106, 0, 134),
            "Turn 3": (85, 0, 155),
        },
        "No history": {
            "At removal": (188, 0, 52),
            "Turn 1": (0, 0, 240),
            "Turn 2": (0, 0, 240),
            "Turn 3": (0, 0, 240),
        },
    }
    needles = {
        "Personal history": "Personal history & 183/0/57 & 21/0/219 & 106/0/134 & 85/0/155",
        "No history": "No history & 188/0/52 & 0/0/240 & 0/0/240 & 0/0/240",
    }
    for intervention, timepoints in removal.items():
        for timepoint, (e, r, u) in timepoints.items():
            rows.append(row(
                "Record removal",
                "Claude Haiku 4.5",
                "Ego depletion",
                intervention,
                "Two agents repeat false explanation before removal",
                e, r, u, 240,
                "Appendix Table 59",
                needles[intervention],
                timepoint=timepoint,
            ))


def add_not_run_correct_warning(rows: list[dict]) -> None:
    for intervention in (
        "Answer counts and dependence warning",
        "Earlier-statement links and repetition warning",
    ):
        rows.append(row(
            "Correct-answer warning mirror",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Two agents repeat correct rejection",
            None, None, None, None,
            "True-answer warning mirror v1 protocol",
            "This package is **prepared but not executed**.",
            status="not run",
            note="Prepared comparison. No outcome may be inferred until execution is authorized and audited.",
        ))


def add_equal_recovery_corrections(rows: list[dict]) -> None:
    values = [
        ("Early correction with equal recovery", 0, 240, 0, "Early & 0 & 240 & 0"),
        ("Late correction with equal recovery", 0, 180, 60, "Late & 0 & 180 & 60"),
    ]
    for intervention, e, r, u, needle in values:
        rows.append(row(
            "Correction timing",
            "Claude Haiku 4.5",
            "Ego depletion",
            intervention,
            "Two agents repeat false explanation",
            e, r, u, 240,
            "Appendix Table 58",
            needle,
        ))


def validate(rows: list[dict]) -> None:
    main_text = MAIN.read_text()
    appendix_text = APPENDIX.read_text()
    protocol_text = PROTOCOL.read_text()
    six_agent_audit = json.loads(SIX_AGENT_AUDIT.read_text())
    if six_agent_audit.get("status") != "pass":
        raise AssertionError("Six-agent trace audit is not clean")
    audit_aliases = {
        "Standard shared memory": "Standard shared memory",
        "Reliable external check": "Correct external verification",
        "Early correction": "Early correction",
        "Late correction": "Late correction",
        "Older entries shown less prominently": "Fading old entries",
        "Answer counts and dependence warning": "Current answer counts with warning",
        "Earlier-statement links and repetition warning": "Earlier statement shown with warning",
    }
    audited_six_agent = {
        item["label"]: item["final_counts"] for item in six_agent_audit["rows"]
    }
    sources = {
        "Main Table 2": main_text,
        "Appendix Table 44": appendix_text,
        "Appendix Table 46": appendix_text,
        "Appendix Table 47": appendix_text,
        "Appendix Table 51": appendix_text,
        "Appendix Table 52": appendix_text,
        "Appendix Table 53": appendix_text,
        "Appendix Table 54": appendix_text,
        "Appendix Table 58": appendix_text,
        "Appendix Table 59": appendix_text,
        "True-answer warning mirror v1 protocol": protocol_text,
    }
    for item in rows:
        if item["source"] not in sources:
            raise AssertionError(f"Unknown source: {item['source']}")
        if item["source_needle"] not in sources[item["source"]]:
            raise AssertionError(
                f"Source row not found for {item['source']}: {item['source_needle']}"
            )
        if item["status"] == "completed":
            known = [item[key] for key in ("endorse", "reject", "uncertain")]
            if item["three_way_split_reported"]:
                if sum(known) != item["total"]:
                    raise AssertionError(f"Counts do not sum for {item}")
            elif item["endorse"] is None or item["total"] is None:
                raise AssertionError(f"Incomplete reported row lacks endorsement/total: {item}")
        if item["family"] == "Six-agent record changes":
            expected = audited_six_agent[audit_aliases[item["intervention"]]]
            observed = {
                "endorse": item["endorse"],
                "reject": item["reject"],
                "uncertain": item["uncertain"],
            }
            if observed != expected:
                raise AssertionError(
                    f"Six-agent counts disagree with trace audit for {item['intervention']}: "
                    f"{observed} != {expected}"
                )


def write_outputs(rows: list[dict]) -> None:
    metadata = {
        "status": "pass",
        "scope": (
            "Compact reviewer-facing summary of the highlighted six-agent record changes, "
            "the cross-model uncertainty-saving comparison, and equal-time corrections."
        ),
        "rows": len(rows),
        "completed_rows": sum(item["status"] == "completed" for item in rows),
        "not_run_rows": sum(item["status"] == "not run" for item in rows),
        "rows_with_full_three_way_split": sum(item["three_way_split_reported"] for item in rows),
        "inputs": [str(MAIN), str(APPENDIX), str(PROTOCOL), str(SIX_AGENT_AUDIT)],
    }
    OUTPUT_JSON.write_text(json.dumps({"metadata": metadata, "rows": rows}, indent=2) + "\n")

    fields = list(rows[0].keys())
    with OUTPUT_CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    def show(value: object) -> str:
        return "--" if value is None else str(value)

    lines = [
        "# Intervention outcomes reported in the current paper",
        "",
        metadata["scope"],
        "",
        f"The table has {metadata['completed_rows']} completed rows. "
        f"A full endorsement/rejection/uncertainty split is available for "
        f"{metadata['rows_with_full_three_way_split']} of them. Two prepared correct-answer warning cells are marked not run.",
        "",
        "| Family | Model | Task | Intervention | Repeated input | Time | E | R | U | Total | Status | Source |",
        "|---|---|---|---|---|---|---:|---:|---:|---:|---|---|",
    ]
    for item in rows:
        lines.append(
            f"| {item['family']} | {item['model']} | {item['task']} | "
            f"{item['intervention']} | {item['repeated_input']} | {item['timepoint']} | "
            f"{show(item['endorse'])} | {show(item['reject'])} | {show(item['uncertain'])} | "
            f"{show(item['total'])} | {item['status']} | {item['source']} |"
        )
    lines += [
        "",
        "## How to read this table",
        "",
        "E, R, and U mean endorsement, rejection, and uncertainty. For PANDAS, endorsement is agreement with a disputed statement rather than a scored error. The first seven rows use E/R/U recovered from the exact archived traces selected for Main Table 2.",
        "",
        "The sharpest true-answer gap remains the two warnings highlighted in the main text. Their correct-answer mirror is prepared but has not been run. Saving uncertainty is the only record intervention currently tested with both a false repeated answer and the correct repeated answer in a matched 24-order comparison.",
        "",
        "Broader warning results appear in Appendix Tables 44, 46, and 47. They are not repeated here because those tables report endorsement but not the rejection/uncertainty split requested by the reviewer.",
        "",
        "## Source check",
        "",
        "Every completed row is checked against its exact LaTeX source row when this script runs. The first seven are also checked against the trace-level six-agent audit. The JSON retains the source string and notes for audit. No model or API calls are made.",
    ]
    OUTPUT_MD.write_text("\n".join(lines) + "\n")


def main() -> None:
    rows: list[dict] = []
    add_main_six_agent(rows)
    add_recording_rule(rows)
    add_equal_recovery_corrections(rows)
    add_not_run_correct_warning(rows)
    validate(rows)
    write_outputs(rows)
    print(json.dumps({
        "status": "pass",
        "rows": len(rows),
        "json": str(OUTPUT_JSON),
        "csv": str(OUTPUT_CSV),
        "markdown": str(OUTPUT_MD),
    }, indent=2))


if __name__ == "__main__":
    main()
