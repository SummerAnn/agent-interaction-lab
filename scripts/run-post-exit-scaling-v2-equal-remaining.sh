#!/bin/zsh
set -euo pipefail

set -a
source "${AGENT_LAB_ENV:-.env}"
set +a

configs=(
  experiments/post_exit_scaling_v2_equal_n12.json
  experiments/post_exit_scaling_v2_equal_n24.json
)

for config in "${configs[@]}"; do
  node --import tsx src/cli.ts experiment "$config"
done
