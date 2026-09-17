#!/usr/bin/env python3
"""Classify malformed-response recoveries in paper-facing experiment traces."""

from __future__ import annotations

import importlib.util
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
ANALYZER = REPO / "scripts" / "analyze_neutral_confound_suite_v1.py"
EXPLICIT_STANCE = re.compile(
    r'''["']?stance["']?\s*:\s*["']?(endorse|reject|uncertain)["']?''',
    re.IGNORECASE,
)


def load_grid_files() -> list[str]:
    spec = importlib.util.spec_from_file_location("neutral_audit", ANALYZER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {ANALYZER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.GRID_FILES


def main() -> None:
    fallback_entries = 0
    explicit_entries = 0
    fallback_cells = 0
    heuristic_cells: list[dict] = []
    entries_by_grid: Counter[str] = Counter()

    for grid_name in load_grid_files():
        grid_path = REPO / grid_name
        cells = json.loads(grid_path.read_text())["cells"]
        for cell in cells:
            db_path = Path(cell["summary"]["dbPath"])
            db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                rows = db.execute(
                    "SELECT 'memory' AS source, entry_text AS text "
                    "FROM memory_entries WHERE entry_text LIKE '%[parse fallback]%' "
                    "UNION ALL "
                    "SELECT 'chat' AS source, message_text AS text "
                    "FROM chat_messages WHERE message_text LIKE '%[parse fallback]%'"
                ).fetchall()
            finally:
                db.close()

            if not rows:
                continue
            fallback_cells += 1
            entries_by_grid[grid_name] += len(rows)
            missing = []
            for source, text in rows:
                fallback_entries += 1
                if EXPLICIT_STANCE.search(text):
                    explicit_entries += 1
                else:
                    missing.append({"source": source, "text": text})
            if missing:
                heuristic_cells.append({
                    "run_id": cell["summary"]["runId"],
                    "db_path": str(db_path),
                    "entries": missing,
                })

    result = {
        "fallback_cells": fallback_cells,
        "fallback_entries": fallback_entries,
        "explicit_stance_recoveries": explicit_entries,
        "heuristic_or_unknown_entries": fallback_entries - explicit_entries,
        "entries_by_grid": dict(entries_by_grid),
        "heuristic_cells": heuristic_cells,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
