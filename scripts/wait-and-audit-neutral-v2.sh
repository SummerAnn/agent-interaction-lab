#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

prefixes=(
  part2_neutral_crossmodel_weak_memory_v2
  part2_neutral_crossmodel_weak_chat_v2
  part2_neutral_fairness_crossmodel_multitask_memory_v2
  part2_neutral_fairness_crossmodel_multitask_chat_v2
)

expected=(96 48 432 216)

while true; do
  complete=0
  printf '%s neutral-v2 status' "$(date '+%Y-%m-%d %H:%M:%S')"

  for index in "${!prefixes[@]}"; do
    prefix="${prefixes[$index]}"
    summaries="$(find output -maxdepth 2 -type f -path "output/${prefix}_*/summary.json" | wc -l | tr -d ' ')"
    final_file="output/${prefix}-grid-results.json"
    printf ' | %s=%s/%s' "$prefix" "$summaries" "${expected[$index]}"

    if [[ -f "$final_file" ]] && [[ "$summaries" -eq "${expected[$index]}" ]]; then
      complete=$((complete + 1))
    fi
  done

  printf '\n'

  if [[ "$complete" -eq "${#prefixes[@]}" ]]; then
    break
  fi

  sleep 45
done

python3 scripts/analyze_neutral_confound_suite_v1.py \
  --repo "$repo_dir"

printf '%s neutral-v2 grids and audit complete\n' "$(date '+%Y-%m-%d %H:%M:%S')"
