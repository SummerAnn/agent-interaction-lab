# Agent Society

Testbed and experimental data for "Information Cascades: When Shared Memory Creates False Consensus in Multi-Agent Systems" (ICLR 2027 submission).

**[Read the paper (PDF)](agent_society_overleaf_peer_review/paper.pdf)**

![Agent Society terminal interface](testbed_image/main.png)

## What this is

Agent Society is a testbed for studying how information moves through groups of LLM agents that share a persistent written memory. The paper compares shared memory, live debate, and personal memory in six-agent groups. The main design covers six models and four question families, with a seventh model in a supporting experiment.

The paper finds that shared memory can circulate corrections or turn repeated false claims into apparent consensus. In the central matched comparison, four liar agents repeat a false claim while two neutral agents judge it for themselves. Across the same 12 speaking orders, neutral-agent false endorsement is 91.7% with shared memory and 0% with both personal memory and live debate. Broader results show that the effect depends on the model and question, so the paper does not claim that one communication method is always best.

![Neutral-agent false endorsement across tasks](agent_society_overleaf_peer_review/fig/fig_task_protocols.png)

## Quick start

```bash
npm install
cp .env.example .env
# Add your API keys to .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
```

### Interactive terminal

```bash
npm run multiagent:society
```

This launches the interactive terminal with a menu for running experiments, inspecting results, comparing runs, and browsing configurations. The menu options are:

1. **Run setup** -- launch one run with custom seed, rounds, budget, or agent count
2. **Build experiment** -- create or edit experiment configurations
3. **Inspect memory** -- browse what agents wrote and retrieved
4. **Batch seeds** -- run the same setup across multiple seeds
5. **Compare runs** -- side-by-side results for two configurations
6. **Run history** -- see recent runs and their outcomes
7. **Experiment archive** -- browse completed experiment grids
8. **Browse setups** -- explore available scenarios, conditions, and rosters
9. **Provider setup** -- configure API keys for each model provider
10. **Run command** -- execute a CLI command directly
11. **Explain** -- read documentation about how the testbed works

### Live debate view

![Live debate between agents](testbed_image/chat.png)

### Run results view

![Completed run showing agent states and memory entries](testbed_image/fe_result.png)

### Scenario browser

![Browsing scenarios with claims and evidence cards](testbed_image/memory.png)

### Try the central comparison yourself

Want to reproduce the paper's central matched comparison? The model, question, six agents, instructions, speaking order, and call budget remain fixed across the three communication methods. Across 12 balanced speaking orders, neutral-agent false endorsement is 91.7% with shared memory and 0% with both personal memory and live debate.

**Option 1. Interactive terminal (recommended)**

```bash
npm run multiagent:society
```

1. Select **Run setup** from the menu
2. Browse to `part2-neutral-fairness-memory-v2` for shared and personal memory, or `part2-neutral-fairness-chat-v3` for live debate
3. The testbed shows you the scenario, agents, and condition
4. Press enter to run. You will see agents writing to shared memory in real time
5. When it finishes, the results view shows final stances, FE, and the full memory trace

**Option 2. One command**

```bash
npx tsx src/experiments/grid.ts experiments/part2-neutral-fairness-memory-v2.json
npx tsx src/experiments/grid.ts experiments/part2-neutral-fairness-chat-v3.json
```

Together these configs run the matched shared-memory, personal-memory, and live-debate conditions. Each uses the same 12 balanced orders, one focal claim, 18 model calls, temperature 0, and Claude Haiku 4.5.

**Option 3. Look at existing data without running anything**

Every result is already in `output/`. Pick any trace database and query it.

```bash
# Find a primary shared-memory run on ego depletion
ls output/ | grep "part2_neutral_fairness_memory_v2" | head -3

# Open it and check the final stances
sqlite3 output/<pick-one>/trace.db \
  "SELECT agent_id, stance, confidence FROM agent_claim_states
   WHERE claim_id='claim_ego_depletion'
   AND step_index=(SELECT MAX(step_index) FROM agent_claim_states);"
```

The four liar agents are assigned to endorse the false claim. The primary outcome asks whether either of the two neutral agents also endorses it. The exact table-to-run manifest in `agent_society_overleaf_peer_review/RUN_MANIFEST.md` lists every included trace.

### CLI commands

```bash
# Validate a run config
npm run testbed:validate -- run-configs/example.yaml

# Run a single config
npm run testbed:run -- run-configs/example.yaml

# Compare two runs
npm run testbed:compare -- output/run1 output/run2

# Batch across seeds
npm run testbed:batch -- run-configs/example.yaml --seeds 1,2,3,4,5

# Inspect a completed run
npm run testbed:inspect -- output/run1
```

### Run a grid experiment

```bash
npx tsx src/experiments/grid.ts experiments/part2-ambiguity-gradient-v1.json
```

This runs all combinations of scenarios x conditions x seeds defined in the experiment config. Completed cells are cached, so you can restart safely.

## Replicating paper results

Every result in the paper comes from a specific experiment config in `experiments/`. Config filenames use internal naming that differs from the paper terminology. Older internal IDs remain unchanged so that saved runs and manifest entries keep resolving. The paper consistently uses the reader-facing role names liar agent, neutral agent, specialist agent, and social agent.

**Naming conventions in the config files.**
The experiment files use prefixes like `part2-` that refer to internal development phases, not paper sections. Configs starting with `blind-` or `cross-model-` run comparisons across multiple models. Configs starting with `amplifier-` or `mitigation-` test record formats or defenses.

The generated table-to-run manifest is the exact source for every reported cohort. The shorter list below gives entry points for the main and confound-critical experiments.

| Paper result | Experiment config | What it runs |
|---|---|---|
| Central liar--neutral comparison | `part2-neutral-fairness-memory-v2.json` + `part2-neutral-fairness-chat-v3.json` | Ego depletion, 3 formats, 12 balanced orders |
| Familiar-science boundaries | `part2-neutral-crosstopic-memory-v1.json` + `part2-neutral-crosstopic-chat-v1.json` | 6 topics with neutral agents |
| Liar-agent ratio | `part2-neutral-ratio{1,2,3,4}-standardized-{memory,chat}-v{2,3}.json` | 1/6 through 4/6 liar agents, three 12-order repeats |
| Matched defenses | `part2-neutral-defense-suite-v2.json` | 7 conditions with neutral agents |
| Model and task boundaries | `part2-neutral-crossmodel-*.json` + `part2-neutral-fairness-crossmodel-multitask-*.json` | Matched memory and debate comparisons |
| Screened SciTaT replication | `part2-neutral-scitat-expanded-memory-*.json` + `part2-neutral-scitat-expanded-chat-*.json` | 18 screened items with neutral agents |
| Origin tracking | `provenance-defense-v1.json` + `provenance-ablation-v1.json` + `provenance-cross-model-v1.json` | Topic, ablation, and model checks |
| Honest mistakes | `rerun-distributed-evidence-v3.json` + `amplifier-majority-wrong-haiku-v1.json` | Revisable errors and record formats |

To replicate a specific result, run the corresponding experiment config through the grid runner:

```bash
npx tsx src/experiments/grid.ts experiments/part2-ambiguity-gradient-v1.json
```

The output appears in `output/` as SQLite trace databases. Each database contains every agent's belief state at every step, every memory entry written, every retrieval, and every LLM call.

## Repository structure

```
src/                    # Testbed source code (TypeScript)
  engine/               # Run engine (memory mode + chat mode backends)
    backends/           # memoryMode.ts (shared/personal) + chatMode.ts (debate)
    run.ts              # Main run entry point
    finalize.ts         # Run-level metrics and summary
  ui/                   # Interactive terminal interface
    interactive.ts      # Menu system and user interaction
    render.ts           # Terminal rendering (retro ASCII style)
  llm/                  # LLM API calls and prompt construction
    prompts.ts          # All agent prompts (both modes)
    provider.ts         # Multi-provider API abstraction
  memory/               # Memory retrieval logic (5 formats)
    retrieve.ts         # Format-dependent retrieval
  metrics/              # Per-step metric computation
    compute.ts          # FE, contagion, diversity, consensus
  scenario/             # Scenario and evidence handling
    access.ts           # Evidence visibility filtering
  db/                   # SQLite trace storage
    sqlite.ts           # Database operations
  config/               # Schema definitions (Zod)
  experiments/          # Grid runner for factorial experiments
    grid.ts             # Runs all scenario x condition x seed combos

experiments/            # Experiment configurations (JSON)
conditions/             # Communication formats and interventions
scenarios/              # Claims and evidence settings
rosters/                # Agent assignments and speaking orders
run-configs/            # Run configuration templates

output/                 # Traced runs (SQLite databases)

scripts/                # Analysis and conversion scripts
tests/                  # Test suite (vitest)
db/schema.sql           # Database schema

agent_society_overleaf_peer_review/  # Complete paper source bundle
  paper.tex             # Main text
  appendix_results.tex  # Supplementary material
  fig/                  # Figures
```

## How the code maps to the paper

| Paper concept | Code location |
|---|---|
| Shared memory (agents read/write a common log) | `src/engine/backends/memoryMode.ts` |
| Live debate (agents argue in real-time rounds) | `src/engine/backends/chatMode.ts` + `src/engine/chat.ts` |
| Personal memory (agent reasons alone) | Same as memory mode with `personal_memory` condition |
| 5 memory formats (agent_judgment, evidence_board, mixed_record, source_aware, independence_aware) | `src/memory/retrieve.ts` |
| Evidence visibility filtering (visibleToAgentIds, availableFromStep) | `src/scenario/access.ts` |
| Agent prompts (liar, neutral, specialist, and social roles) | `src/llm/prompts.ts` |
| Metrics (FE, contagion, soft contagion, diversity, consensus) | `src/metrics/compute.ts` |
| Run finalization and summary | `src/engine/finalize.ts` |
| Factorial experiment grids | `src/experiments/grid.ts` |
| SQLite trace storage | `src/db/sqlite.ts` |
| Interactive terminal UI | `src/ui/interactive.ts` + `src/ui/render.ts` |

## How experiment configs work

Each experiment config (e.g., `experiments/part2-ambiguity-gradient-v1.json`) defines:

```json
{
  "id": "part2_ambiguity_gradient_v1",
  "scenarios": ["scenarios/familiar-blind/blind_ego_depletion_v1.yaml", ...],
  "conditions": ["conditions/shared-memory-no-correction.yaml"],
  "seeds": [1, 2, 3, 4, 5],
  "rosterPaths": ["rosters/blind-majority-wrong-4of6-haiku.json"],
  "maxSteps": 18,
  "budget": { "maxModelCalls": 54, "temperature": 0 }
}
```

The grid runner creates all combinations (scenarios x conditions x seeds) and runs them sequentially, caching completed cells. If a run is interrupted, restarting picks up where it left off.

## Trace databases

Each run produces one SQLite database in `output/`. You can inspect any database with:

```bash
sqlite3 output/<run-name>/trace.db
```

The database contains:
- `agent_claim_states` -- agent stance (endorse/reject/uncertain) and confidence at each step
- `memory_entries` -- everything written to shared memory
- `chat_messages` -- debate messages with cited sources (chat mode only)
- `retrieval_traces` -- what each agent saw before deciding (the memory contents it read)
- `model_calls` -- raw LLM API calls with full prompts and responses
- `events` -- experiment events (corrections, agent exits, etc.)
- `metric_records` -- computed metrics at each step
- `runs` -- run metadata and final summary

## Analyzing trace data

Here are example queries you can run on any trace database to extract the same results reported in the paper.

**Did a neutral agent adopt the false belief?**
```sql
SELECT agent_id, stance, confidence
FROM agent_claim_states
WHERE claim_id = 'claim_ego_depletion'
  AND step_index = (SELECT MAX(step_index) FROM agent_claim_states)
ORDER BY agent_id;
```

**What did the shared memory look like when the agent flipped?**
```sql
SELECT step_index, agent_id, stance, confidence, reasoning_text
FROM memory_entries
WHERE claim_id = 'claim_ego_depletion'
ORDER BY step_index;
```

**What sources did the agent cite?**
```sql
SELECT step_index, agent_id, cited_source_ids_json
FROM memory_entries
WHERE agent_id = 'analyst_6'
ORDER BY step_index;
```

**Get the false endorsement rate at each step**
```sql
SELECT step_index, metric_value AS false_endorsement_rate
FROM metric_records
WHERE metric_name = 'falseClaimEndorsementRate'
ORDER BY step_index;
```

## Configuration file formats

### Conditions (how agents communicate)

Conditions define the communication format. Example (`conditions/shared-memory-no-correction.yaml`):

```json
{
  "id": "shared_memory_no_correction",
  "memory": {
    "mode": "shared",           // "shared", "personal", or "chat"
    "record": "agent_judgment", // memory format type
    "maxRetrievedEntries": 6
  },
  "interventions": {
    "correctionTiming": "none"  // "none", "early", "late"
  }
}
```

Key `memory.mode` values:
- `"shared"` -- shared memory (all agents read/write the same pool)
- `"personal"` -- personal memory (each agent sees only its own entries)
- `"chat"` -- live debate (synchronous multi-round discussion)

### Scenarios (what agents evaluate)

Scenarios define the claims, evidence, and ground truth. Each scenario has:
- **Claims** with truth labels (`true`, `false`, `mixed`)
- **Evidence cards** with effect directions and visibility rules
- **A focus claim** (the false claim that liar agents endorse)

### Rosters (who the agents are)

Rosters define agent roles, models, and behavioral parameters:
- `role` -- legacy code IDs that map to the paper's reader-facing roles
- `model` -- which LLM to use
- `socialWeight` -- how much the agent weighs peer entries (1.0 = fully influenced, 0.35 = resistant)
- `falseClaimBias` -- initial lean toward the false claim
- `writesMemoryThreshold` -- minimum confidence required to write a memory entry

## Creating your own experiment

1. Pick or create a **scenario** (the scientific claim and evidence)
2. Pick or create **conditions** (shared memory, debate, etc.)
3. Pick or create a **roster** (agent roles and which model to use)
4. Create an **experiment config** that combines them with seeds

Example minimal experiment:
```json
{
  "id": "my_experiment",
  "scenarios": ["scenarios/familiar-blind/blind_ego_depletion_v1.yaml"],
  "conditions": [
    "conditions/shared-memory-no-correction.yaml",
    "conditions/chat-fully-connected.yaml"
  ],
  "seeds": [1, 2, 3],
  "rosterPaths": ["rosters/blind-majority-wrong-4of6-haiku.json"],
  "maxSteps": 18,
  "budget": { "maxModelCalls": 54, "temperature": 0 }
}
```

This runs ego depletion with 4/6 liar agents in both shared memory and debate across 3 seeds (6 total runs).

```bash
npx tsx src/experiments/grid.ts experiments/my_experiment.json
```

## Running tests

```bash
npx vitest
```

## License

MIT
