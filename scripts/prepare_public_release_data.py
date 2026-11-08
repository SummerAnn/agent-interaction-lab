#!/usr/bin/env python3
"""Build the exact, portable raw-data tree used by the public paper release.

The source checkout may contain exploratory runs and machine-specific dbPath
metadata.  This script copies only the 6,686 original runs and 2,228 follow-up
runs named by the frozen manifests, rewrites dbPath values to repository-
relative paths, and refreshes the affected manifest hashes and byte counts.

For safety, the destination must not already contain output/ or
rebuttal_harness/output/.  Run this only in a fresh release worktree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
from pathlib import Path


BASE_INDEX_FILES = (
    "run_manifest.json",
    "new_appendix_run_manifest.json",
    "open_model_visibility_manifest.json",
    "single_peer_influence_manifest.json",
    "large_group_run_manifest.json",
    "scale12_ratio_sweep_audit.json",
    "scale100_transition_audit.json",
    "scale6_ratio0_audit.json",
)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def collect_run_ids(value) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"run_id", "runId"} and isinstance(child, str):
                found.add(child)
            else:
                found.update(collect_run_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(collect_run_ids(child))
    return found


def replace_in_all_text_columns(
    database: Path,
    old_value: str,
    new_value: str,
) -> None:
    absolute_trace = re.compile(r'/Users/[^"\']*?/trace\.db')
    changed = False
    with sqlite3.connect(database) as connection:
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        for table in tables:
            columns = connection.execute(
                f'PRAGMA table_info("{table}")'
            ).fetchall()
            for column in columns:
                name = column[1]
                declared_type = (column[2] or "").upper()
                if "TEXT" not in declared_type and declared_type:
                    continue
                rows = connection.execute(
                    f'SELECT rowid, "{name}" FROM "{table}" '
                    f'WHERE typeof("{name}") = \'text\''
                ).fetchall()
                for rowid, value in rows:
                    updated = value.replace(old_value, new_value)
                    updated = absolute_trace.sub(new_value, updated)
                    if updated == value:
                        continue
                    connection.execute(
                        f'UPDATE "{table}" SET "{name}" = ? WHERE rowid = ?',
                        (updated, rowid),
                    )
                    changed = True
        connection.commit()
        if changed:
            connection.execute("VACUUM")


def copy_portable_run(
    source_root: Path,
    destination_root: Path,
    run_id: str,
    relative_output: Path,
) -> None:
    source_dir = source_root / relative_output / run_id
    destination_dir = destination_root / relative_output / run_id
    summary_source = source_dir / "summary.json"
    trace_source = source_dir / "trace.db"
    if not summary_source.is_file() or not trace_source.is_file():
        raise FileNotFoundError(f"missing released artifacts for {run_id}")

    summary = read_json(summary_source)
    if summary.get("runId") != run_id:
        raise RuntimeError(f"summary run ID mismatch for {run_id}")

    destination_dir.mkdir(parents=True, exist_ok=True)
    portable_path = f"{relative_output.as_posix()}/{run_id}/trace.db"
    original_path = summary.get("dbPath")
    if isinstance(original_path, str):
        summary["dbPath"] = portable_path
    write_json(destination_dir / "summary.json", summary)

    trace_target = destination_dir / "trace.db"
    shutil.copy2(trace_source, trace_target)
    replace_in_all_text_columns(
        trace_target,
        original_path if isinstance(original_path, str) else portable_path,
        portable_path,
    )


def update_manifest_artifacts(
    value,
    destination: Path,
    output_root: Path,
) -> None:
    if isinstance(value, dict):
        run_id = value.get("run_id") or value.get("runId")
        if isinstance(run_id, str):
            summary = destination / output_root / run_id / "summary.json"
            trace = destination / output_root / run_id / "trace.db"
            if summary.is_file() and trace.is_file():
                summary_hash = sha256(summary)
                trace_hash = sha256(trace)
                for key in ("summary_sha256", "summarySha256"):
                    if key in value:
                        value[key] = summary_hash
                for key in ("trace_sha256", "traceSha256"):
                    if key in value:
                        value[key] = trace_hash
                for key in ("summary_bytes", "summary_size_bytes", "summarySizeBytes"):
                    if key in value:
                        value[key] = summary.stat().st_size
                for key in ("trace_bytes", "trace_size_bytes", "traceSizeBytes"):
                    if key in value:
                        value[key] = trace.stat().st_size
        for child in value.values():
            update_manifest_artifacts(child, destination, output_root)
    elif isinstance(value, list):
        for child in value:
            update_manifest_artifacts(child, destination, output_root)


def ensure_anonymous(root: Path) -> None:
    patterns = (
        re.compile(rb"/Users/[^/\x00]+"),
        re.compile(rb"sk-ant-[A-Za-z0-9_-]{12,}"),
        re.compile(rb"sk-[A-Za-z0-9_-]{20,}"),
    )
    hits: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        data = path.read_bytes()
        if any(pattern.search(data) for pattern in patterns):
            hits.append(str(path.relative_to(root)))
    if hits:
        raise RuntimeError(
            "identity or credential-like strings remain in: "
            + ", ".join(hits[:20])
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    destination = args.destination.resolve()

    base_destination = destination / "output"
    followup_destination = destination / "rebuttal_harness" / "output"
    if base_destination.exists() or followup_destination.exists():
        raise RuntimeError(
            "destination raw-data directories already exist; use a fresh worktree"
        )

    base_ids: set[str] = set()
    for name in BASE_INDEX_FILES:
        base_ids.update(collect_run_ids(read_json(source / "paper" / name)))
    followup_manifest = read_json(source / "paper" / "rebuttal_run_manifest.json")
    followup_ids = collect_run_ids(followup_manifest)
    if len(base_ids) != 6686:
        raise RuntimeError(f"selected {len(base_ids)} base runs, expected 6686")
    if len(followup_ids) != 2228:
        raise RuntimeError(
            f"selected {len(followup_ids)} follow-up runs, expected 2228"
        )

    for run_id in sorted(base_ids):
        copy_portable_run(source, destination, run_id, Path("output"))
    for run_id in sorted(followup_ids):
        copy_portable_run(
            source,
            destination,
            run_id,
            Path("rebuttal_harness/output"),
        )

    for name in BASE_INDEX_FILES:
        path = destination / "paper" / name
        manifest = read_json(path)
        update_manifest_artifacts(manifest, destination, Path("output"))
        write_json(path, manifest)

    followup_path = destination / "paper" / "rebuttal_run_manifest.json"
    followup_manifest = read_json(followup_path)
    update_manifest_artifacts(
        followup_manifest,
        destination,
        Path("rebuttal_harness/output"),
    )
    write_json(followup_path, followup_manifest)

    ensure_anonymous(base_destination)
    ensure_anonymous(followup_destination)
    print(json.dumps({
        "status": "PASS",
        "base_runs": len(base_ids),
        "followup_runs": len(followup_ids),
        "paper_runs": len(base_ids) + len(followup_ids),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
