import fs from "node:fs";
import path from "node:path";
import {
  assert,
  batchAnalysisPath,
  fileSha256,
  jsonSha256,
  manifestPath,
  model,
  protocolPath,
  relative,
  requestContract,
  root,
  scheduleSeed,
  shuffled,
  sourceArm,
  sourceAuditPath,
  sqliteJson,
  sqlQuote,
  strictParse,
  structuredOutput,
} from "./first-neutral-temporal-replay-v1-common.mjs";

const force = process.argv.includes("--force");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--force");
assert(unknown.length === 0, `Unknown argument(s): ${unknown.join(", ")}`);
assert(fs.existsSync(protocolPath), `Missing protocol: ${protocolPath}`);
assert(fs.existsSync(sourceAuditPath), `Missing source audit: ${sourceAuditPath}`);
assert(fs.existsSync(batchAnalysisPath), `Missing batch analysis: ${batchAnalysisPath}`);
if (fs.existsSync(manifestPath) && !force) {
  throw new Error(`Manifest already exists: ${relative(manifestPath)}. Use --force only to deliberately relock it.`);
}

const sourceAudit = JSON.parse(fs.readFileSync(sourceAuditPath, "utf8"));
const batchAnalysis = JSON.parse(fs.readFileSync(batchAnalysisPath, "utf8"));
assert(sourceAudit.status === "complete", "Source audit is not complete");
assert(sourceAudit.checks?.valid === true, "Source audit is not valid");
assert(sourceAudit.checks?.everyCompletedRunHas36PromptAudits === true,
  "Source audit does not verify complete prompt audits");

const sourceRuns = sourceAudit.runs
  .filter((run) => run.arm === sourceArm)
  .sort((left, right) => left.order - right.order);
assert(sourceRuns.length === 24, `Expected 24 source runs, found ${sourceRuns.length}`);
assert(new Set(sourceRuns.map((run) => run.runId)).size === 24, "Source run IDs are not unique");
assert(new Set(sourceRuns.map((run) => run.order)).size === 24, "Source order IDs are not unique");

function sourceFiles(dbPath) {
  // The SQLite shared-memory file is an ephemeral lock/index structure and can
  // change during a read. Hash the durable database and WAL only.
  return [dbPath, `${dbPath}-wal`]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({
      path: relative(candidate),
      sha256: fileSha256(candidate),
      bytes: fs.statSync(candidate).size,
    }));
}

const exploratoryCandidates = batchAnalysis.exploratoryDivergenceTargetedReplayCandidates ?? [];
assert(exploratoryCandidates.length === 24,
  `Expected 24 exploratory rank-16 candidates, found ${exploratoryCandidates.length}`);
const exploratoryByRun = new Map(exploratoryCandidates.map((candidate) => [candidate.runId, candidate]));
assert(exploratoryByRun.size === 24, "Exploratory candidate run IDs are not unique");

function buildContext(run, cohort, selected, states, executedOrder, sourceAgentIds, dbPath) {
  const neutralStates = states.filter((state) => !sourceAgentIds.has(state.agent_id));
  const neutralRank = neutralStates.findIndex((state) => state.state_id === selected.state_id) + 1;
  assert(neutralRank > 0, `${run.runId}: selected judgment is not neutral`);
  const agentResponseNumber = states
    .filter((state) => state.agent_id === selected.agent_id && state.state_id <= selected.state_id).length;

  const traceRows = sqliteJson(dbPath, `
    SELECT retrieved_entry_ids_json, context_json
    FROM retrieval_traces
    WHERE step_index=${Number(selected.step_index)}
      AND agent_id=${sqlQuote(selected.agent_id)}
  `);
  assert(traceRows.length === 1, `${run.runId}/${cohort}: expected one selected retrieval trace`);
  const trace = traceRows[0];
  const context = JSON.parse(trace.context_json);
  const promptAudit = context.promptAudit;
  assert(promptAudit, `${run.runId}/${cohort}: selected trace lacks promptAudit`);
  assert(context.responseParseValid === true, `${run.runId}/${cohort}: original response was not parse-valid`);
  const original = strictParse(context.rawResponse);
  assert(original.stance === selected.stance, `${run.runId}/${cohort}: original stance mismatch`);
  assert(Math.abs(original.confidence - selected.confidence) < 1e-12,
    `${run.runId}/${cohort}: original confidence mismatch`);
  assert(promptAudit.promptFrame === "memory_assessment", `${run.runId}/${cohort}: wrong prompt frame`);
  assert(promptAudit.responseMode === "structured_assessment", `${run.runId}/${cohort}: wrong response mode`);
  assert(promptAudit.model === model, `${run.runId}/${cohort}: wrong model`);
  assert(promptAudit.temperature === 0, `${run.runId}/${cohort}: wrong temperature`);
  assert(promptAudit.maxTokens === 1024, `${run.runId}/${cohort}: wrong token limit`);
  assert(promptAudit.structuredOutputName === "submit_claim_assessment",
    `${run.runId}/${cohort}: wrong structured-output name`);

  const createdRows = sqliteJson(dbPath, `
    SELECT created_at FROM events
    WHERE step_index=${Number(selected.step_index)}
      AND agent_id=${sqlQuote(selected.agent_id)}
      AND event_type='agent_step'
    ORDER BY event_id
  `);
  assert(createdRows.length === 1, `${run.runId}/${cohort}: expected one selected event timestamp`);
  const visibleEntryIds = JSON.parse(trace.retrieved_entry_ids_json || "[]");
  const contract = requestContract(promptAudit);
  const prefix = cohort === "first_neutral_repeatability" ? "first-neutral" : "rank16";
  const contextId = `${prefix}-order-${String(run.order).padStart(2, "0")}`;

  const result = {
    contextId,
    cohort,
    selectionStatus: cohort === "first_neutral_repeatability"
      ? "role-and-position rule fixed before replay outcomes"
      : "exploratory rank selected after inspecting source batch divergence",
    sourceRunId: run.runId,
    sourceArm: run.arm,
    declaredOrder: run.order,
    executedOrder,
    executedOrderKey: executedOrder.join(">"),
    sourceFiles: sourceFiles(dbPath),
    sourceCreatedAt: createdRows[0].created_at,
    selectedStep: selected.step_index,
    selectedAgent: selected.agent_id,
    neutralResponseRank: neutralRank,
    agentResponseNumber,
    selectionRole: cohort === "first_neutral_repeatability"
      ? "first neutral response"
      : "neutral-response rank 16",
    sourceAgentIds: [...sourceAgentIds].sort(),
    visibleEntryIds,
    original: {
      rawResponse: context.rawResponse,
      parsed: original,
      storedStance: selected.stance,
      storedConfidence: selected.confidence,
    },
    promptAudit,
    request: {
      model: promptAudit.model,
      temperature: promptAudit.temperature,
      maxTokens: promptAudit.maxTokens,
      systemPrompt: promptAudit.systemPrompt,
      userPrompt: promptAudit.userPrompt,
      structuredOutput: structuredOutput(promptAudit),
    },
    promptTextHash: jsonSha256({
      systemPrompt: promptAudit.systemPrompt,
      userPrompt: promptAudit.userPrompt,
    }),
    requestContractHash: jsonSha256(contract),
  };

  if (cohort === "rank16_exploratory") {
    const candidate = exploratoryByRun.get(run.runId);
    assert(candidate, `${run.runId}: missing batch-analysis rank-16 candidate`);
    assert(candidate.neutralResponseRank === 16, `${run.runId}: batch candidate has wrong rank`);
    assert(candidate.step === selected.step_index && candidate.agentId === selected.agent_id,
      `${run.runId}: rank-16 selection disagrees with batch analysis`);
    assert(candidate.promptTextHash === result.promptTextHash
      && candidate.requestContractHash === result.requestContractHash,
    `${run.runId}: rank-16 request hashes disagree with batch analysis`);
  }
  return result;
}

const contexts = sourceRuns.flatMap((run) => {
  const dbPath = path.resolve(run.dbPath);
  assert(fs.existsSync(dbPath), `Missing source trace: ${dbPath}`);
  const sourceAgentIds = new Set(run.sourceAgentIds ?? []);
  assert(sourceAgentIds.size === 2, `${run.runId}: expected two source-agent IDs`);

  const states = sqliteJson(dbPath, `
    SELECT state_id, step_index, agent_id, stance, confidence
    FROM agent_claim_states WHERE step_index > 0 ORDER BY state_id
  `);
  assert(states.length === 36, `${run.runId}: expected 36 public judgments`);
  const firstRound = states.filter((state) => state.step_index <= 12);
  assert(firstRound.length === 12, `${run.runId}: expected 12 first-round judgments`);
  assert(new Set(firstRound.map((state) => state.agent_id)).size === 12,
    `${run.runId}: first round does not contain 12 unique agents`);
  const executedOrder = firstRound.map((state) => state.agent_id);
  const neutralStates = states.filter((state) => !sourceAgentIds.has(state.agent_id));
  assert(neutralStates.length === 30, `${run.runId}: expected 30 neutral judgments`);
  const firstNeutral = neutralStates[0];
  assert(firstNeutral, `${run.runId}: missing first neutral judgment`);
  const rank16 = neutralStates[15];
  assert(rank16, `${run.runId}: missing neutral-response rank 16`);
  return [
    buildContext(run, "first_neutral_repeatability", firstNeutral, states, executedOrder, sourceAgentIds, dbPath),
    buildContext(run, "rank16_exploratory", rank16, states, executedOrder, sourceAgentIds, dbPath),
  ];
});

const firstNeutralContexts = contexts.filter((context) => context.cohort === "first_neutral_repeatability");
const rank16Contexts = contexts.filter((context) => context.cohort === "rank16_exploratory");
assert(firstNeutralContexts.length === 24 && rank16Contexts.length === 24,
  "Expected 24 contexts in each cohort");
assert(new Set(firstNeutralContexts.map((context) => context.executedOrderKey)).size === 24,
  "First-neutral executed speaking orders are not unique");
assert(new Set(rank16Contexts.map((context) => context.executedOrderKey)).size === 24,
  "Rank-16 executed speaking orders are not unique");
assert(firstNeutralContexts.every((context) => context.original.parsed.stance === "uncertain"),
  "Descriptive source check failed: not every selected original stance is uncertain");

const schedule = shuffled(contexts.map((context) => context.contextId), scheduleSeed);
const manifest = {
  id: "first_neutral_temporal_replay_v1",
  protocolVersion: "1.0.0",
  preparedAt: new Date().toISOString(),
  status: "locked_not_executed",
  purpose: "Replay exact saved requests at the first neutral judgment and, separately, at exploratory neutral-response rank 16.",
  interpretationLimit: "The first-neutral cohort checks starting-judgment repeatability. The rank-16 cohort was selected after the source divergence audit and is exploratory.",
  cohorts: {
    first_neutral_repeatability: {
      contextCount: 24,
      selectionRule: "First neutral response in each of the 24 executed speaking orders.",
      selectionStatus: "Fixed by role and response position before replay outcomes; not selected to target the batch divergence.",
    },
    rank16_exploratory: {
      contextCount: 24,
      selectionRule: "Neutral-response rank 16 in each executed speaking order.",
      selectionStatus: "Exploratory: rank 16 was selected after the source batch audit identified it as the earliest aligned divergence among five batches.",
    },
  },
  protocol: { path: relative(protocolPath), sha256: fileSha256(protocolPath) },
  sourceAudit: { path: relative(sourceAuditPath), sha256: fileSha256(sourceAuditPath) },
  batchAnalysis: { path: relative(batchAnalysisPath), sha256: fileSha256(batchAnalysisPath) },
  sourceArm,
  model,
  provider: { type: "anthropic", baseUrl: "https://api.anthropic.com" },
  temperature: 0,
  maxTokens: 1024,
  concurrency: 1,
  contextCount: contexts.length,
  plannedCalls: contexts.length,
  scheduleSeed,
  schedule,
  contexts,
  sourceDescription: {
    executedAt: sourceAudit.executionWindow,
    firstNeutralOriginalStances: { endorse: 0, reject: 0, uncertain: 24 },
    rank16OriginalStances: Object.fromEntries(["endorse", "reject", "uncertain"].map((stance) => [
      stance,
      rank16Contexts.filter((context) => context.original.parsed.stance === stance).length,
    ])),
    note: "The first-neutral rule did not use the original stance. The rank-16 cohort is explicitly exploratory because the rank came from the source divergence audit.",
  },
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  manifest: relative(manifestPath),
  contexts: contexts.length,
  plannedCalls: contexts.length,
  cohorts: { firstNeutral: 24, exploratoryRank16: 24 },
  scheduleSeed,
}, null, 2));
