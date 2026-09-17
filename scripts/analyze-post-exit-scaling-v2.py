#!/usr/bin/env python3
import json
import sqlite3
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output"
ROSTERS = ROOT / "rosters" / "post-exit-scaling-v2"


def roster_for(summary: dict) -> dict:
    config_id = summary["configId"]
    matches = [path for path in ROSTERS.glob("*.json") if path.stem in config_id]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one roster for {config_id}, found {matches}")
    return json.loads(matches[0].read_text())


def final_neutral_states(db_path: Path, neutral_ids: list[str]) -> list[str]:
    placeholders = ",".join("?" for _ in neutral_ids)
    query = f"""
        SELECT states.agent_id, states.stance
        FROM agent_claim_states AS states
        JOIN (
          SELECT agent_id, claim_id, MAX(step_index) AS final_step
          FROM agent_claim_states
          WHERE step_index > 0 AND agent_id IN ({placeholders})
          GROUP BY agent_id, claim_id
        ) AS final
          ON states.agent_id = final.agent_id
         AND states.claim_id = final.claim_id
         AND states.step_index = final.final_step
        WHERE states.claim_id = 'claim_ego_depletion'
        ORDER BY states.agent_id
    """
    with sqlite3.connect(db_path) as connection:
        return [row[1] for row in connection.execute(query, neutral_ids)]


def event_count(db_path: Path, event_type: str) -> int:
    with sqlite3.connect(db_path) as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM events WHERE event_type = ?", (event_type,)
        ).fetchone()[0]


groups = defaultdict(lambda: {
    "runs": 0,
    "neutral_answers": 0,
    "endorse": 0,
    "reject": 0,
    "uncertain": 0,
    "runs_any": 0,
    "runs_all": 0,
    "removed_entries": 0,
})

for summary_path in sorted(OUTPUT.glob("post_exit_scaling_v2_*/summary.json")):
    summary = json.loads(summary_path.read_text())
    roster = roster_for(summary)
    neutral_ids = [
        agent["id"] for agent in roster["agents"] if agent["role"] == "neutral_agent"
    ]
    stances = final_neutral_states(summary_path.parent / "trace.db", neutral_ids)
    if len(stances) != len(neutral_ids):
        raise RuntimeError(
            f"Incomplete neutral final states in {summary_path.parent.name}: "
            f"expected {len(neutral_ids)}, found {len(stances)}"
        )
    roster_id = roster["id"]
    ratio = "equal" if "_equal_" in roster_id else "lower"
    size = len(roster["agents"])
    condition = "retained" if "retained" in summary["conditionId"] else "cleared"
    key = (ratio, size, condition)
    group = groups[key]
    group["runs"] += 1
    group["neutral_answers"] += len(stances)
    for stance in ("endorse", "reject", "uncertain"):
        group[stance] += stances.count(stance)
    endorsements = stances.count("endorse")
    group["runs_any"] += int(endorsements > 0)
    group["runs_all"] += int(endorsements == len(stances))
    group["removed_entries"] += event_count(
        summary_path.parent / "trace.db", "memory_entry_removed_after_exit"
    )

print("ratio\tsize\tcondition\truns\tneutral_false\tneutral_total\tFE_t\tany\tall\treject\tuncertain\tremoved")
for key in sorted(groups, key=lambda item: (item[1], item[0], item[2])):
    ratio, size, condition = key
    group = groups[key]
    rate = group["endorse"] / group["neutral_answers"] if group["neutral_answers"] else 0
    print(
        f"{ratio}\t{size}\t{condition}\t{group['runs']}\t{group['endorse']}\t"
        f"{group['neutral_answers']}\t{rate:.3f}\t{group['runs_any']}\t"
        f"{group['runs_all']}\t{group['reject']}\t{group['uncertain']}\t"
        f"{group['removed_entries']}"
    )
