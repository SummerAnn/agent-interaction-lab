import fs from "node:fs";
import path from "node:path";
import {
  assert,
  auditPath,
  batchAnalysisPath,
  countStances,
  fileSha256,
  jsonSha256,
  manifestPath,
  model,
  protocolPath,
  relative,
  requestContract,
  resultPath,
  resultsMarkdownPath,
  root,
  scheduleSeed,
  sha256,
  shuffled,
  sourceArm,
  sourceAuditPath,
  sqliteJson,
  sqlQuote,
  staticAuditPath,
  strictParse,
} from "./first-neutral-temporal-replay-v1-common.mjs";

const staticOnly = process.argv.includes("--static");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--static");
assert(unknown.length === 0, `Unknown argument(s): ${unknown.join(", ")}`);
for (const source of [manifestPath, protocolPath, sourceAuditPath, batchAnalysisPath]) {
  assert(fs.existsSync(source), `Missing required source: ${relative(source)}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceAudit = JSON.parse(fs.readFileSync(sourceAuditPath, "utf8"));
const batchAnalysis = JSON.parse(fs.readFileSync(batchAnalysisPath, "utf8"));
const checks = {};
function check(name, value) {
  checks[name] = Boolean(value);
  assert(value, `Audit failed: ${name}`);
}

check("manifestIdentity", manifest.id === "first_neutral_temporal_replay_v1"
  && manifest.protocolVersion === "1.0.0");
check("lockedStatus", manifest.status === "locked_not_executed");
check("protocolHash", manifest.protocol.sha256 === fileSha256(protocolPath));
check("sourceAuditHash", manifest.sourceAudit.sha256 === fileSha256(sourceAuditPath));
check("batchAnalysisHash", manifest.batchAnalysis.sha256 === fileSha256(batchAnalysisPath));
check("sourceAuditComplete", sourceAudit.status === "complete" && sourceAudit.checks?.valid === true);
check("sourceArm", manifest.sourceArm === sourceArm);
check("pinnedContract", manifest.model === model && manifest.temperature === 0
  && manifest.maxTokens === 1024 && manifest.concurrency === 1);
check("fortyEightContexts", manifest.contexts.length === 48 && manifest.plannedCalls === 48);
check("uniqueContextIds", new Set(manifest.contexts.map((context) => context.contextId)).size === 48);
check("completeSchedule", manifest.schedule.length === 48
  && new Set(manifest.schedule).size === 48
  && manifest.schedule.every((contextId) => manifest.contexts.some((context) => context.contextId === contextId)));
check("deterministicSchedule", manifest.scheduleSeed === scheduleSeed
  && JSON.stringify(manifest.schedule)
    === JSON.stringify(shuffled(manifest.contexts.map((context) => context.contextId), scheduleSeed)));

const cohorts = {
  first_neutral_repeatability: manifest.contexts.filter((context) =>
    context.cohort === "first_neutral_repeatability"),
  rank16_exploratory: manifest.contexts.filter((context) =>
    context.cohort === "rank16_exploratory"),
};
for (const [cohort, contexts] of Object.entries(cohorts)) {
  check(`${cohort}.twentyFourContexts`, contexts.length === 24);
  check(`${cohort}.uniqueSourceRuns`, new Set(contexts.map((context) => context.sourceRunId)).size === 24);
  check(`${cohort}.uniqueDeclaredOrders`, new Set(contexts.map((context) => context.declaredOrder)).size === 24);
  check(`${cohort}.uniqueExecutedOrders`, new Set(contexts.map((context) => context.executedOrderKey)).size === 24);
}
check("cohortLabelsHonest", manifest.cohorts.rank16_exploratory.selectionStatus.startsWith("Exploratory")
  && manifest.interpretationLimit.includes("exploratory"));

const sourceRunMap = new Map(
  sourceAudit.runs.filter((run) => run.arm === sourceArm).map((run) => [run.runId, run]),
);
check("sourceAuditHasTwentyFourRuns", sourceRunMap.size === 24);
const exploratoryByRun = new Map(
  (batchAnalysis.exploratoryDivergenceTargetedReplayCandidates ?? [])
    .map((candidate) => [candidate.runId, candidate]),
);
check("batchAnalysisHasTwentyFourExploratoryCandidates", exploratoryByRun.size === 24);

for (const context of manifest.contexts) {
  const sourceRun = sourceRunMap.get(context.sourceRunId);
  assert(sourceRun, `${context.contextId}: source run is absent from controlling audit`);
  check(`${context.contextId}.sourceArm`, context.sourceArm === sourceArm && sourceRun.arm === sourceArm);
  check(`${context.contextId}.sourceFileHashes`, context.sourceFiles.every((file) => {
    const absolute = path.join(root, file.path);
    return fs.existsSync(absolute)
      && fs.statSync(absolute).size === file.bytes
      && fileSha256(absolute) === file.sha256;
  }));

  const dbFile = context.sourceFiles.find((file) => file.path.endsWith("trace.db"));
  assert(dbFile, `${context.contextId}: source database is missing from file inventory`);
  const dbPath = path.join(root, dbFile.path);
  const states = sqliteJson(dbPath, `
    SELECT state_id, step_index, agent_id, stance, confidence
    FROM agent_claim_states WHERE step_index > 0 ORDER BY state_id
  `);
  const sourceIds = new Set(context.sourceAgentIds);
  const neutralStates = states.filter((state) => !sourceIds.has(state.agent_id));
  assert(neutralStates.length === 30, `${context.contextId}: expected 30 neutral judgments`);
  const expected = context.cohort === "first_neutral_repeatability"
    ? neutralStates[0]
    : neutralStates[15];
  check(`${context.contextId}.selection`, expected.step_index === context.selectedStep
    && expected.agent_id === context.selectedAgent
    && context.neutralResponseRank === (context.cohort === "first_neutral_repeatability" ? 1 : 16));
  const executedOrder = states.filter((state) => state.step_index <= 12).map((state) => state.agent_id);
  check(`${context.contextId}.executedOrder`, JSON.stringify(executedOrder) === JSON.stringify(context.executedOrder)
    && executedOrder.join(">") === context.executedOrderKey);

  const traceRows = sqliteJson(dbPath, `
    SELECT retrieved_entry_ids_json, context_json FROM retrieval_traces
    WHERE step_index=${Number(context.selectedStep)}
      AND agent_id=${sqlQuote(context.selectedAgent)}
  `);
  assert(traceRows.length === 1, `${context.contextId}: selected retrieval trace is missing`);
  const traceContext = JSON.parse(traceRows[0].context_json);
  const promptAudit = traceContext.promptAudit;
  assert(promptAudit, `${context.contextId}: selected trace lacks promptAudit`);
  check(`${context.contextId}.visibleEntries`, JSON.stringify(JSON.parse(traceRows[0].retrieved_entry_ids_json || "[]"))
    === JSON.stringify(context.visibleEntryIds));
  check(`${context.contextId}.promptTextHash`, context.promptTextHash === jsonSha256({
    systemPrompt: promptAudit.systemPrompt,
    userPrompt: promptAudit.userPrompt,
  }));
  check(`${context.contextId}.requestContractHash`, context.requestContractHash
    === jsonSha256(requestContract(promptAudit)));
  check(`${context.contextId}.savedRequest`, context.request.model === promptAudit.model
    && context.request.temperature === promptAudit.temperature
    && context.request.maxTokens === promptAudit.maxTokens
    && context.request.systemPrompt === promptAudit.systemPrompt
    && context.request.userPrompt === promptAudit.userPrompt
    && context.request.structuredOutput.name === promptAudit.structuredOutputName
    && JSON.stringify(context.request.structuredOutput.inputSchema)
      === JSON.stringify(promptAudit.structuredOutputSchema));
  const original = strictParse(traceContext.rawResponse);
  check(`${context.contextId}.originalRawResponse`, traceContext.rawResponse === context.original.rawResponse);
  check(`${context.contextId}.originalParse`, original.stance === expected.stance
    && Math.abs(original.confidence - expected.confidence) < 1e-12
    && context.original.parsed.stance === original.stance
    && Math.abs(context.original.parsed.confidence - original.confidence) < 1e-12);

  if (context.cohort === "rank16_exploratory") {
    const candidate = exploratoryByRun.get(context.sourceRunId);
    check(`${context.contextId}.exploratorySource`, candidate
      && candidate.neutralResponseRank === 16
      && candidate.step === context.selectedStep
      && candidate.agentId === context.selectedAgent
      && candidate.promptTextHash === context.promptTextHash
      && candidate.requestContractHash === context.requestContractHash);
  }
}

check("firstNeutralOriginalsDescriptive", cohorts.first_neutral_repeatability.every((context) =>
  context.original.parsed.stance === "uncertain"));
check("separateSelections", cohorts.first_neutral_repeatability.every((context) =>
  context.selectionRole === "first neutral response")
  && cohorts.rank16_exploratory.every((context) =>
    context.selectionRole === "neutral-response rank 16"
    && context.selectionStatus.startsWith("exploratory")));

const staticReport = {
  generatedAt: new Date().toISOString(),
  mode: staticOnly ? "static" : "post-run",
  manifest: relative(manifestPath),
  interpretationLimit: manifest.interpretationLimit,
  checks,
  passed: true,
};

if (staticOnly) {
  fs.writeFileSync(staticAuditPath, `${JSON.stringify(staticReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ audit: relative(staticAuditPath), passed: true, contexts: 48, apiCalls: 0 }, null, 2));
  process.exit(0);
}

const completed = manifest.schedule.map((contextId) => {
  const context = manifest.contexts.find((candidate) => candidate.contextId === contextId);
  assert(context, `Unknown context in schedule: ${contextId}`);
  const outputPath = resultPath(contextId);
  assert(fs.existsSync(outputPath), `Missing replay result: ${relative(outputPath)}`);
  const result = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  check(`${contextId}.completeResult`, result.status === "complete" && result.parseValid === true);
  check(`${contextId}.identity`, result.contextId === contextId
    && result.cohort === context.cohort
    && result.selectionStatus === context.selectionStatus
    && result.sourceRunId === context.sourceRunId
    && result.selectedAgent === context.selectedAgent
    && result.selectedStep === context.selectedStep);
  check(`${contextId}.provider`, result.request.provider === "anthropic"
    && result.request.baseUrl === "https://api.anthropic.com"
    && result.request.model === model);
  check(`${contextId}.requestSettings`, result.request.temperature === context.request.temperature
    && result.request.maxTokens === context.request.maxTokens);
  check(`${contextId}.requestHashes`, result.request.systemPromptSha256 === sha256(context.request.systemPrompt)
    && result.request.userPromptSha256 === sha256(context.request.userPrompt)
    && result.request.requestContractHash === context.requestContractHash);
  check(`${contextId}.requestText`, result.request.systemPrompt === context.request.systemPrompt
    && result.request.userPrompt === context.request.userPrompt
    && JSON.stringify(result.request.structuredOutput) === JSON.stringify(context.request.structuredOutput));
  const reparsed = strictParse(result.rawResponse);
  check(`${contextId}.freshParse`, reparsed.stance === result.parsed.stance
    && Math.abs(reparsed.confidence - result.parsed.confidence) < 1e-12);
  const providerEnvelope = JSON.parse(result.providerResponseBody);
  const providerToolUse = providerEnvelope.content?.find((block) =>
    block.type === "tool_use" && block.name === context.request.structuredOutput.name);
  check(`${contextId}.providerEnvelope`, providerToolUse?.input
    && JSON.stringify(providerToolUse.input) === result.rawResponse
    && providerEnvelope.usage?.input_tokens === result.completionData?.usage?.promptTokens
    && providerEnvelope.usage?.output_tokens === result.completionData?.usage?.completionTokens);
  check(`${contextId}.completionTimestamps`, typeof result.completionData?.startedAt === "string"
    && typeof result.completionData?.finishedAt === "string"
    && Number.isFinite(Date.parse(result.completionData.startedAt))
    && Number.isFinite(Date.parse(result.completionData.finishedAt))
    && Date.parse(result.completionData.finishedAt) >= Date.parse(result.completionData.startedAt));
  check(`${contextId}.usage`, Number.isFinite(result.completionData?.usage?.promptTokens)
    && Number.isFinite(result.completionData?.usage?.completionTokens)
    && Number.isFinite(result.completionData?.usage?.totalTokens)
    && result.completionData.usage.promptTokens >= 0
    && result.completionData.usage.completionTokens >= 0
    && result.completionData.usage.totalTokens
      === result.completionData.usage.promptTokens + result.completionData.usage.completionTokens);
  check(`${contextId}.attempts`, Array.isArray(result.attempts)
    && result.attempts.length >= 1
    && result.attempts.every((attempt) => Number.isFinite(Date.parse(attempt.startedAt))
      && Number.isFinite(Date.parse(attempt.finishedAt))
      && Array.isArray(attempt.internalRetryLog))
    && result.attempts.filter((attempt) => attempt.status === "complete").length === 1
    && result.attempts.length === 1
    && result.attempts.at(-1).status === "complete"
    && result.attempts.at(-1).rawResponse === result.rawResponse);
  check(`${contextId}.noAutomaticRetries`, result.retryPolicy
    === "No automatic retries. A provider or parse failure stops execution and requires a separately authorized invocation.");
  return { context, result, reparsed };
});
check("fortyEightResults", completed.length === 48);
check("uniqueCompletedContexts", new Set(completed.map(({ result }) => result.contextId)).size === 48);

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
function summarize(items) {
  const stances = ["endorse", "reject", "uncertain"];
  const transitions = Object.fromEntries(stances.map((original) => [
    original,
    Object.fromEntries(stances.map((replay) => [replay, 0])),
  ]));
  for (const { context, reparsed } of items) {
    transitions[context.original.parsed.stance][reparsed.stance] += 1;
  }
  const stanceAgreement = items.filter(({ context, reparsed }) =>
    context.original.parsed.stance === reparsed.stance).length;
  return {
    originalStances: countStances(items.map(({ context }) => context.original.parsed.stance)),
    replayStances: countStances(items.map(({ reparsed }) => reparsed.stance)),
    transitions,
    stanceAgreement,
    stanceAgreementRate: stanceAgreement / items.length,
    changedStances: items.length - stanceAgreement,
    originalMeanConfidence: mean(items.map(({ context }) => context.original.parsed.confidence)),
    replayMeanConfidence: mean(items.map(({ reparsed }) => reparsed.confidence)),
    meanPairedConfidenceChange: mean(items.map(({ context, reparsed }) =>
      reparsed.confidence - context.original.parsed.confidence)),
  };
}

const summaries = Object.fromEntries(Object.keys(cohorts).map((cohort) => [
  cohort,
  summarize(completed.filter(({ context }) => context.cohort === cohort)),
]));
const rows = completed.map(({ context, result, reparsed }) => ({
  cohort: context.cohort,
  contextId: context.contextId,
  declaredOrder: context.declaredOrder,
  sourceCreatedAt: context.sourceCreatedAt,
  replayStartedAt: result.completionData.startedAt,
  selectedAgent: context.selectedAgent,
  selectedStep: context.selectedStep,
  neutralResponseRank: context.neutralResponseRank,
  visibleEntries: context.visibleEntryIds.length,
  originalStance: context.original.parsed.stance,
  originalConfidence: context.original.parsed.confidence,
  replayStance: reparsed.stance,
  replayConfidence: reparsed.confidence,
  stanceChanged: context.original.parsed.stance !== reparsed.stance,
  confidenceChange: reparsed.confidence - context.original.parsed.confidence,
})).sort((left, right) => left.cohort.localeCompare(right.cohort)
  || left.declaredOrder - right.declaredOrder);

function interpretation(cohort, summary) {
  const prefix = cohort === "first_neutral_repeatability"
    ? "First-neutral repeatability"
    : "Exploratory rank-16 replay";
  if (summary.changedStances === 0) {
    return `${prefix}: all 24 saved requests returned the same stance. This supports request-level stability for this slice but does not identify the cause of later batch divergence.`;
  }
  return `${prefix}: ${summary.changedStances} of 24 exact saved requests changed stance. This shows temporal request-level instability, but does not identify provider-side model changes as the cause.`;
}
const interpretations = Object.fromEntries(Object.entries(summaries).map(([cohort, summary]) => [
  cohort,
  interpretation(cohort, summary),
]));

const report = {
  ...staticReport,
  summaries,
  interpretations,
  rows,
  auditLimitation: "A single replay cannot separate provider model changes, serving nondeterminism, or other unobserved provider factors. The rank-16 cohort was selected after inspecting the source divergence.",
};
fs.writeFileSync(auditPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = [
  "# Exact-request temporal replays v1",
  "",
  "## First-neutral repeatability cohort",
  "",
  interpretations.first_neutral_repeatability,
  "",
  `Original: ${summaries.first_neutral_repeatability.originalStances.endorse} E / ${summaries.first_neutral_repeatability.originalStances.reject} R / ${summaries.first_neutral_repeatability.originalStances.uncertain} U.`,
  `Replay: ${summaries.first_neutral_repeatability.replayStances.endorse} E / ${summaries.first_neutral_repeatability.replayStances.reject} R / ${summaries.first_neutral_repeatability.replayStances.uncertain} U.`,
  `Exact stance agreement: ${summaries.first_neutral_repeatability.stanceAgreement}/24.`,
  "",
  "The completed batches did not differ in first-response endorsement, so this cohort is a repeatability check rather than a direct test of the 139-to-185 divergence.",
  "",
  "## Exploratory rank-16 cohort",
  "",
  interpretations.rank16_exploratory,
  "",
  `Original: ${summaries.rank16_exploratory.originalStances.endorse} E / ${summaries.rank16_exploratory.originalStances.reject} R / ${summaries.rank16_exploratory.originalStances.uncertain} U.`,
  `Replay: ${summaries.rank16_exploratory.replayStances.endorse} E / ${summaries.rank16_exploratory.replayStances.reject} R / ${summaries.rank16_exploratory.replayStances.uncertain} U.`,
  `Exact stance agreement: ${summaries.rank16_exploratory.stanceAgreement}/24.`,
  "",
  "Rank 16 was selected after the batch audit found it was the earliest aligned divergence among five batches. These results are exploratory and are not pooled with the first-neutral cohort.",
  "",
  "## Per-request results",
  "",
  "| Cohort | Order | Agent | Step | Neutral rank | Entries | Original | Replay | Confidence change |",
  "|---|---:|---|---:|---:|---:|---|---|---:|",
  ...rows.map((row) => `| ${row.cohort} | ${String(row.declaredOrder).padStart(2, "0")} | ${row.selectedAgent} | ${row.selectedStep} | ${row.neutralResponseRank} | ${row.visibleEntries} | ${row.originalStance} (${row.originalConfidence.toFixed(2)}) | ${row.replayStance} (${row.replayConfidence.toFixed(2)}) | ${row.confidenceChange.toFixed(2)} |`),
  "",
  "## Limit",
  "",
  "A changed response is consistent with temporal provider variation or nondeterminism. It does not prove that the provider changed the model. An unchanged response does not rule out variation at another time or elsewhere in a multi-agent run.",
  "",
];
fs.writeFileSync(resultsMarkdownPath, `${markdown.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  audit: relative(auditPath),
  report: relative(resultsMarkdownPath),
  passed: true,
  summaries,
}, null, 2));
