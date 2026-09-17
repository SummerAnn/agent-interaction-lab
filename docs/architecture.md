# Agent Interaction Lab architecture

Agent Interaction Lab is a traced multi-agent experiment harness. A run combines
four independently versioned inputs:

- a scenario, which defines claims, evidence, and ground truth;
- a condition, which defines shared memory, personal memory, live debate, or an
  intervention;
- a roster, which defines agent roles, models, and speaking order; and
- a run configuration, which fixes the call budget, seed, and provider settings.

The execution path begins in `src/experiments/grid.ts` for factorial grids or
`src/cli.ts` for an individual run. Configuration validation lives in
`src/config/`. The run engine in `src/engine/` dispatches either the memory-mode
or chat-mode backend. Prompts are constructed in `src/llm/`, and provider calls
go through the common provider abstraction there.

In memory mode, `src/memory/retrieve.ts` selects the statements visible to the
current agent. In chat mode, agents read and reply to the conversation directly.
Both modes write a SQLite trace through `src/db/`. The trace contains model
calls, prompts and responses, retrieved statements, memory writes, chat messages,
agent states, events, and computed metrics. `src/engine/finalize.ts` derives the
run summary from that trace.

The paper-facing audit path is deliberately separate from execution:

1. experiment configurations identify the intended cohort;
2. run manifests list the exact completed run directories used in each result;
3. analysis scripts recompute metrics from the SQLite traces; and
4. `paper/` contains the canonical manuscript, figures, and manifests.

Saved internal identifiers are not renamed when the public product name changes.
This keeps existing run directories, manifests, and citations resolvable.
