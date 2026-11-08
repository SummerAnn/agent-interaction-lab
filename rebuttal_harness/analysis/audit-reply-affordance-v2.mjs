import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

const gridResultPath = process.argv[2];
if (!gridResultPath) {
  throw new Error(
    "Usage: node analysis/audit-reply-affordance-v2.mjs "
      + "output/content_mechanism_reply_affordance_v2-grid-results.json",
  );
}

const EXPECTED_GRID_ID = "content_mechanism_reply_affordance_v2";
const EXPECTED_MESSAGE = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const EXPECTED_CONDITIONS = {
  reply_v2_id_control: { replies: false, render: false },
  reply_v2_replies_hidden: { replies: true, render: false },
  reply_v2_replies_visible: { replies: true, render: true },
};
const MAX_OUTPUT_TOKENS = 768;

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(probability * sorted.length))];
}

function summarizeUsage(rows) {
  const summarize = (field) => {
    const values = rows.map((row) => Number(row[field] ?? 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      total,
      mean: values.length > 0 ? Number((total / values.length).toFixed(2)) : null,
      min: values.length > 0 ? Math.min(...values) : null,
      p50: percentile(values, 0.50),
      p95: percentile(values, 0.95),
      max: values.length > 0 ? Math.max(...values) : null,
    };
  };
  return {
    calls: rows.length,
    promptTokens: summarize("promptTokens"),
    completionTokens: summarize("completionTokens"),
    totalTokens: summarize("totalTokens"),
  };
}

function incrementStance(counts, stance) {
  if (stance === "endorse") counts.E += 1;
  else if (stance === "uncertain") counts.U += 1;
  else if (stance === "reject") counts.R += 1;
}

const resultPath = path.resolve(gridResultPath);
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const failures = [];
const warnings = [];
if (result.grid?.id !== EXPECTED_GRID_ID) failures.push(`Expected grid ${EXPECTED_GRID_ID}, found ${result.grid?.id}.`);
if (result.cells?.length !== 72) failures.push(`Expected 72 cells, found ${result.cells?.length ?? 0}.`);
if (result.grid?.budget?.maxOutputTokensPerCall !== MAX_OUTPUT_TOKENS) {
  failures.push(`Expected maxOutputTokensPerCall=${MAX_OUTPUT_TOKENS}.`);
}

const conditionById = new Map((result.inputCatalog?.conditions ?? []).map((conditionRef) => {
  const condition = yaml.load(fs.readFileSync(conditionRef.path, "utf8"));
  return [condition.id, condition];
}));
for (const [conditionId, expected] of Object.entries(EXPECTED_CONDITIONS)) {
  const condition = conditionById.get(conditionId);
  if (!condition) {
    failures.push(`Missing condition ${conditionId}.`);
    continue;
  }
  if (condition.memory?.allowEntryReplies !== expected.replies) failures.push(`${conditionId}: allowEntryReplies mismatch.`);
  if (condition.memory?.renderReplyLinks !== expected.render) failures.push(`${conditionId}: renderReplyLinks mismatch.`);
  if (condition.memory?.showOpaqueEntryIds !== true) failures.push(`${conditionId}: opaque entry IDs are not enabled.`);
  if (condition.memory?.writeUncertainAnswers !== true) failures.push(`${conditionId}: uncertain judgments are not saved.`);
  if (condition.memory?.maxRetrievedEntries !== 6) failures.push(`${conditionId}: retrieval window differs from six.`);
  if (condition.interaction?.fixedSourceMessage !== EXPECTED_MESSAGE) failures.push(`${conditionId}: fixed source message mismatch.`);
  if (condition.interaction?.adversaryCommitment !== "enforced") failures.push(`${conditionId}: fixed source behavior is not enforced.`);
}

const seenCells = new Set();
const referencedOutputDirs = new Set();
const cellsPerCondition = new Map();
const aggregates = new Map(Object.keys(EXPECTED_CONDITIONS).map((conditionId) => [conditionId, {
  conditionId,
  finalNeutral: { E: 0, U: 0, R: 0 },
  replyTurns: new Set(),
  replyEdges: 0,
  replyTargets: new Set(),
  requestedReplyIds: 0,
  rejectedReplyIds: 0,
  sourceRetrievalsByNeutral: 0,
  exposedNeutralAgents: new Set(),
  parseInvalid: 0,
  nearConfiguredCap: 0,
  atOrAboveLegacyCap: 0,
  promptsWithRenderedLinks: 0,
  allCalls: [],
  neutralCalls: [],
}]));

for (const cell of result.cells ?? []) {
  const key = `${cell.conditionId}|${cell.rosterId}|${cell.seed}`;
  if (seenCells.has(key)) failures.push(`Duplicate cell ${key}.`);
  seenCells.add(key);
  cellsPerCondition.set(cell.conditionId, (cellsPerCondition.get(cell.conditionId) ?? 0) + 1);
  const expected = EXPECTED_CONDITIONS[cell.conditionId];
  const aggregate = aggregates.get(cell.conditionId);
  if (!expected || !aggregate) {
    failures.push(`${key}: unexpected condition.`);
    continue;
  }
  const dbPath = cell.summary?.dbPath;
  if (!dbPath || !fs.existsSync(dbPath)) {
    failures.push(`${key}: trace database is missing.`);
    continue;
  }
  referencedOutputDirs.add(path.resolve(path.dirname(dbPath)));

  const roster = result.grid.rosters.find((candidate) => candidate.id === cell.rosterId);
  if (!roster) {
    failures.push(`${key}: roster metadata is missing.`);
    continue;
  }
  const sourceIds = new Set(roster.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const neutralIds = new Set(roster.agents.filter((agent) => agent.role !== "contamination_agent").map((agent) => agent.id));
  if (sourceIds.size !== 2 || neutralIds.size !== 10) failures.push(`${key}: expected 2 sources and 10 neutral agents.`);

  const allRunRows = query(dbPath, "SELECT run_id AS runId, config_id AS configId, condition_id AS conditionId, seed, status, max_steps AS maxSteps FROM runs ORDER BY created_at;");
  const completedRunRows = allRunRows.filter((row) => row.status === "completed");
  if (completedRunRows.length !== 1 || allRunRows.length !== 2) failures.push(`${key}: expected one running provenance row and one completed row, found ${allRunRows.length} total and ${completedRunRows.length} completed.`);
  const runRow = completedRunRows[0];
  if (!runRow || runRow.status !== "completed") failures.push(`${key}: run is not complete.`);
  if (runRow?.conditionId !== cell.conditionId || Number(runRow?.seed) !== Number(cell.seed)) failures.push(`${key}: run metadata mismatch.`);

  const calls = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, total_tokens AS totalTokens FROM model_calls ORDER BY step_index;");
  aggregate.allCalls.push(...calls);
  aggregate.neutralCalls.push(...calls.filter((call) => neutralIds.has(call.agentId)));
  if (calls.length !== 36) failures.push(`${key}: expected 36 model calls, found ${calls.length}.`);
  const callsByAgent = new Map();
  for (const call of calls) callsByAgent.set(call.agentId, (callsByAgent.get(call.agentId) ?? 0) + 1);
  for (const agent of roster.agents) {
    if (callsByAgent.get(agent.id) !== 3) failures.push(`${key}: ${agent.id} has ${callsByAgent.get(agent.id) ?? 0} calls instead of 3.`);
  }
  const nearCap = calls.filter((call) => Number(call.completionTokens) >= MAX_OUTPUT_TOKENS - 8).length;
  const legacyCap = calls.filter((call) => Number(call.completionTokens) >= 380).length;
  aggregate.nearConfiguredCap += nearCap;
  aggregate.atOrAboveLegacyCap += legacyCap;
  if (nearCap > 0) failures.push(`${key}: ${nearCap} calls are within 8 tokens of the configured output cap.`);

  const memories = query(
    dbPath,
    "SELECT memory_entry_id AS id, opaque_entry_id AS opaqueId, step_index AS stepIndex, agent_id AS agentId, stance, entry_text AS text, replied_to_entry_ids_json AS repliedIdsJson, replied_to_opaque_entry_ids_json AS repliedOpaqueIdsJson FROM memory_entries ORDER BY step_index;",
  );
  if (memories.length !== 36) failures.push(`${key}: expected 36 saved entries with uncertainty enabled, found ${memories.length}.`);
  const memoryById = new Map(memories.map((entry) => [entry.id, entry]));
  const opaqueIds = memories.map((entry) => entry.opaqueId);
  if (new Set(opaqueIds).size !== memories.length) failures.push(`${key}: opaque entry IDs are not unique.`);
  for (const entry of memories) {
    if (entry.opaqueId !== `e${entry.stepIndex}`) failures.push(`${key}: step ${entry.stepIndex} has opaque ID ${entry.opaqueId}, expected e${entry.stepIndex}.`);
  }

  const stateRows = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, stance FROM agent_claim_states WHERE step_index > 0 ORDER BY step_index;");
  const stateByTurn = new Map(stateRows.map((state) => [`${state.stepIndex}|${state.agentId}`, state]));
  for (const state of stateRows) {
    const saved = memories.find((entry) => entry.stepIndex === state.stepIndex && entry.agentId === state.agentId);
    if (!saved || saved.stance !== state.stance) failures.push(`${key}: state at step ${state.stepIndex} was not saved exactly.`);
  }
  const latestByAgent = new Map();
  for (const state of stateRows) {
    const previous = latestByAgent.get(state.agentId);
    if (!previous || state.stepIndex > previous.stepIndex) latestByAgent.set(state.agentId, state);
  }
  let neutralFinals = 0;
  for (const neutralId of neutralIds) {
    const state = latestByAgent.get(neutralId);
    if (!state) failures.push(`${key}: missing final state for ${neutralId}.`);
    else {
      incrementStance(aggregate.finalNeutral, state.stance);
      neutralFinals += 1;
    }
  }
  if (neutralFinals !== 10) failures.push(`${key}: expected 10 neutral final judgments, found ${neutralFinals}.`);
  for (const sourceId of sourceIds) {
    if (latestByAgent.get(sourceId)?.stance !== "endorse") failures.push(`${key}: source ${sourceId} did not finish endorsing.`);
  }

  const fixedEvents = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type = 'fixed_source_statement' ORDER BY step_index;");
  if (fixedEvents.length !== 6) failures.push(`${key}: expected 6 fixed-source events, found ${fixedEvents.length}.`);
  for (const event of fixedEvents) {
    const payload = parseJson(event.outputJson, {});
    if (!sourceIds.has(event.agentId) || payload.stance !== "endorse" || payload.text !== EXPECTED_MESSAGE) {
      failures.push(`${key}: fixed-source event at step ${event.stepIndex} has the wrong source, stance, or message.`);
    }
    const saved = memories.find((entry) => entry.stepIndex === event.stepIndex && entry.agentId === event.agentId);
    if (!saved || saved.stance !== "endorse" || !saved.text.includes(EXPECTED_MESSAGE)) {
      failures.push(`${key}: fixed-source memory at step ${event.stepIndex} is missing or changed.`);
    }
  }

  const traces = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, retrieved_entry_ids_json AS retrievedIdsJson, context_json AS contextJson FROM retrieval_traces ORDER BY step_index;");
  if (traces.length !== 36) failures.push(`${key}: expected 36 retrieval traces, found ${traces.length}.`);
  const traceByTurn = new Map(traces.map((trace) => [`${trace.stepIndex}|${trace.agentId}`, trace]));
  const sourceMemoryIds = new Set(memories.filter((entry) => sourceIds.has(entry.agentId)).map((entry) => entry.id));
  const exposedNeutrals = new Set();
  for (const trace of traces) {
    const context = parseJson(trace.contextJson, {});
    const retrievedIds = parseJson(trace.retrievedIdsJson, []);
    const retrievedEntries = retrievedIds.map((id) => memoryById.get(id)).filter(Boolean);
    if (context.responseParseValid !== true) {
      aggregate.parseInvalid += 1;
      failures.push(`${key}: parser fallback or invalid JSON at step ${trace.stepIndex}.`);
    }
    const promptText = `${context.promptAudit?.systemPrompt ?? ""}\n${context.promptAudit?.userPrompt ?? ""}`;
    if (!context.promptAudit?.systemPrompt || !context.promptAudit?.userPrompt) failures.push(`${key}: prompt audit text missing at step ${trace.stepIndex}.`);
    const forbiddenTokens = [cell.summary?.runId, runRow?.runId, runRow?.configId, cell.conditionId, cell.rosterId, `seed${cell.seed}`].filter(Boolean);
    for (const token of forbiddenTokens) {
      if (promptText.includes(token) || String(context.rawResponse ?? "").includes(token)) failures.push(`${key}: leaked metadata token "${token}" at step ${trace.stepIndex}.`);
    }
    for (const entry of memories) {
      if (promptText.includes(entry.id) || String(context.rawResponse ?? "").includes(entry.id)) failures.push(`${key}: leaked internal memory ID at step ${trace.stepIndex}.`);
    }
    for (const entry of retrievedEntries) {
      if (!promptText.includes(`[entry_id: ${entry.opaqueId}]`)) failures.push(`${key}: retrieved ${entry.opaqueId} was not displayed at step ${trace.stepIndex}.`);
    }
    const displayedIds = [...promptText.matchAll(/\[entry_id:\s*([^\]]+)\]/g)].map((match) => match[1]);
    if (displayedIds.some((id) => !/^e\d+$/.test(id))) failures.push(`${key}: non-opaque displayed entry ID at step ${trace.stepIndex}.`);

    const expectedRenderedRelations = retrievedEntries.filter((entry) => parseJson(entry.repliedOpaqueIdsJson, []).length > 0);
    const hasRenderedLink = promptText.includes("[replies to:");
    if (hasRenderedLink) aggregate.promptsWithRenderedLinks += 1;
    if (!expected.render && hasRenderedLink) failures.push(`${key}: reply dependency rendered in a non-rendering arm at step ${trace.stepIndex}.`);
    if (expected.render) {
      for (const entry of expectedRenderedRelations) {
        const relation = `[replies to: ${parseJson(entry.repliedOpaqueIdsJson, []).join(", ")}]`;
        if (!promptText.includes(relation)) failures.push(`${key}: stored relation ${relation} was not rendered at step ${trace.stepIndex}.`);
      }
    }
    if (expected.replies && !promptText.includes("replied_entry_ids")) failures.push(`${key}: reply affordance missing at step ${trace.stepIndex}.`);
    if (!expected.replies && promptText.includes("replied_entry_ids")) failures.push(`${key}: reply affordance appeared in the ID control at step ${trace.stepIndex}.`);

    const requested = Array.isArray(context.requestedReplyEntryIds) ? context.requestedReplyEntryIds : [];
    const repliedOpaque = Array.isArray(context.repliedOpaqueEntryIds) ? context.repliedOpaqueEntryIds : [];
    const rejected = Array.isArray(context.rejectedReplyEntryIds) ? context.rejectedReplyEntryIds : [];
    aggregate.requestedReplyIds += requested.length;
    aggregate.rejectedReplyIds += rejected.length;
    if (!expected.replies && (requested.length > 0 || repliedOpaque.length > 0 || rejected.length > 0)) failures.push(`${key}: reply metadata appeared in the ID control at step ${trace.stepIndex}.`);
    if (requested.some((id) => !/^e\d+$/.test(id))) warnings.push(`${key}: model requested a non-opaque reply ID at step ${trace.stepIndex}; it should be rejected.`);
    if (neutralIds.has(trace.agentId)) {
      const sourceHits = retrievedIds.filter((id) => sourceMemoryIds.has(id)).length;
      aggregate.sourceRetrievalsByNeutral += sourceHits;
      if (sourceHits > 0) exposedNeutrals.add(trace.agentId);
    }
  }
  if (exposedNeutrals.size === 0) failures.push(`${key}: no neutral agent retrieved a fixed-source entry.`);
  for (const agentId of exposedNeutrals) aggregate.exposedNeutralAgents.add(`${cell.rosterId}|${agentId}`);

  const replyEvents = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type = 'memory_entry_reply' ORDER BY step_index;");
  if (!expected.replies && replyEvents.length > 0) failures.push(`${key}: reply events appeared in the ID control.`);
  for (const event of replyEvents) {
    const payload = parseJson(event.outputJson, {});
    const trace = traceByTurn.get(`${event.stepIndex}|${event.agentId}`);
    const retrievedIds = new Set(trace ? parseJson(trace.retrievedIdsJson, []) : []);
    const target = memoryById.get(payload.repliedMemoryEntryId);
    if (!target || !retrievedIds.has(payload.repliedMemoryEntryId)) failures.push(`${key}: reply target at step ${event.stepIndex} was not retrieved.`);
    if (!target || payload.repliedOpaqueEntryId !== target.opaqueId) failures.push(`${key}: opaque reply target mismatch at step ${event.stepIndex}.`);
    const response = memoryById.get(payload.responseMemoryEntryId);
    const storedInternal = response ? parseJson(response.repliedIdsJson, []) : [];
    const storedOpaque = response ? parseJson(response.repliedOpaqueIdsJson, []) : [];
    if (!response || !storedInternal.includes(payload.repliedMemoryEntryId) || !storedOpaque.includes(payload.repliedOpaqueEntryId)) {
      failures.push(`${key}: reply link was not stored on the response entry at step ${event.stepIndex}.`);
    }
    aggregate.replyTurns.add(`${cell.rosterId}|${event.stepIndex}|${event.agentId}`);
    aggregate.replyEdges += 1;
    aggregate.replyTargets.add(`${cell.rosterId}|${payload.repliedOpaqueEntryId}`);
  }
  const replyLineage = query(dbPath, "SELECT COUNT(*) AS count FROM claim_lineage WHERE relation_type LIKE '%reply%';")[0]?.count ?? 0;
  if (replyLineage > 0) failures.push(`${key}: ${replyLineage} reply edges were incorrectly written as causal lineage.`);

  // Every trace should correspond to an observed stance on that same turn.
  for (const trace of traces) {
    if (!stateByTurn.has(`${trace.stepIndex}|${trace.agentId}`)) failures.push(`${key}: trace at step ${trace.stepIndex} lacks a state.`);
  }
}

// A prior aborted launch cannot be aggregated silently. Any directory carrying
// this grid ID must be one of the 72 databases referenced by the result file.
const outputRoot = path.resolve(result.grid?.outputDir ?? path.dirname(resultPath));
if (fs.existsSync(outputRoot)) {
  const prefix = `${EXPECTED_GRID_ID}_`;
  const candidateDirs = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(outputRoot, entry.name));
  for (const candidateDir of candidateDirs) {
    if (!referencedOutputDirs.has(path.resolve(candidateDir))) {
      const dbPath = path.join(candidateDir, "trace.db");
      const callCount = fs.existsSync(dbPath)
        ? query(dbPath, "SELECT COUNT(*) AS count FROM model_calls;")[0]?.count ?? 0
        : 0;
      failures.push(`Unreferenced v2 output directory ${candidateDir} (${callCount} model calls) may be an aborted or duplicate cell.`);
    }
  }
}

for (const conditionId of Object.keys(EXPECTED_CONDITIONS)) {
  if (cellsPerCondition.get(conditionId) !== 24) failures.push(`${conditionId}: expected 24 cells, found ${cellsPerCondition.get(conditionId) ?? 0}.`);
  const aggregate = aggregates.get(conditionId);
  const finalCount = aggregate.finalNeutral.E + aggregate.finalNeutral.U + aggregate.finalNeutral.R;
  if (finalCount !== 240) failures.push(`${conditionId}: expected 240 neutral final judgments, found ${finalCount}.`);
  if (EXPECTED_CONDITIONS[conditionId].replies && aggregate.replyEdges === 0) {
    failures.push(`${conditionId}: reply affordance produced no accepted reply edges; manipulation did not engage.`);
  }
  if (!EXPECTED_CONDITIONS[conditionId].replies && aggregate.replyEdges !== 0) failures.push(`${conditionId}: ID control contains reply edges.`);
}

const report = {
  gridId: result.grid?.id,
  design: {
    cells: result.cells?.length ?? 0,
    expectedRuns: 72,
    expectedCalls: 2592,
    balancedOrdersPerArm: 24,
    maxOutputTokensPerCall: MAX_OUTPUT_TOKENS,
  },
  conditions: Object.fromEntries([...aggregates.entries()].map(([conditionId, aggregate]) => [conditionId, {
    finalNeutral: aggregate.finalNeutral,
    replyTurns: aggregate.replyTurns.size,
    replyEdges: aggregate.replyEdges,
    distinctReplyTargets: aggregate.replyTargets.size,
    requestedReplyIds: aggregate.requestedReplyIds,
    rejectedReplyIds: aggregate.rejectedReplyIds,
    sourceRetrievalsByNeutral: aggregate.sourceRetrievalsByNeutral,
    exposedNeutralAgentOrderPairs: aggregate.exposedNeutralAgents.size,
    promptsWithRenderedLinks: aggregate.promptsWithRenderedLinks,
    outputTruncationMarkers: {
      invalidJsonOrParserFallbacks: aggregate.parseInvalid,
      callsWithinEightTokensOfConfiguredCap: aggregate.nearConfiguredCap,
      callsAtOrAboveLegacy384TokenCap: aggregate.atOrAboveLegacyCap,
    },
    usage: {
      allCalls: summarizeUsage(aggregate.allCalls),
      neutralCalls: summarizeUsage(aggregate.neutralCalls),
    },
  }])),
  warnings,
  failures,
  eligibleForAnalysis: failures.length === 0,
};

console.log(JSON.stringify(report, null, 2));
if (!report.eligibleForAnalysis) process.exitCode = 1;
