import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const smokeId = process.env.PROMPT_FRAME_SMOKE_STUDY_ID?.trim() || "prompt_frame_crossover_smoke_v1";
const fullId = process.env.PROMPT_FRAME_FULL_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const manifestPath = path.join(root, "experiments", smokeId, "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fullManifest = JSON.parse(fs.readFileSync(manifest.sourceManifestPath, "utf8"));
const reportPath = path.join(root, "analysis", `${smokeId.replaceAll("_", "-")}-audit.json`);
const expectedOutputTokenCap = Number(manifest.maxOutputTokensPerCall ?? 384);
const requiredOutputTokenCap = Number(process.env.PROMPT_FRAME_EXPECTED_OUTPUT_TOKEN_CAP ?? expectedOutputTokenCap);
const failures = [];

function fail(message) {
  failures.push(message);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseLastJsonObject(raw) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const value = JSON.parse(raw.slice(start, index + 1));
          if (value && typeof value === "object" && !Array.isArray(value)) objects.push(value);
        } catch {
          // Ignore incomplete objects, matching the production parser.
        }
        start = -1;
      }
    }
  }
  return objects.at(-1) ?? null;
}

function normalizeStance(value) {
  if (["endorse", "reject", "uncertain"].includes(value)) return value;
  const normalized = String(value).toLowerCase().trim();
  if (["true", "agree", "support"].includes(normalized)) return "endorse";
  if (["false", "disagree", "oppose"].includes(normalized)) return "reject";
  return "uncertain";
}

function parseDiscussionOutcome(raw) {
  let stance = "uncertain";
  let confidence = 0.5;
  const jsonBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const inlineJsonMatch = !jsonBlockMatch ? raw.match(/(\{"stance"[\s\S]*?\})/) : null;
  const jsonText = jsonBlockMatch?.[1] ?? inlineJsonMatch?.[1];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      stance = normalizeStance(parsed.stance);
      confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
    } catch {
      // Match production text fallback.
    }
  }
  if (stance === "uncertain" && !jsonText) {
    const lower = raw.toLowerCase();
    if (lower.includes("i endorse") || lower.includes("i agree") || lower.includes("i support")) stance = "endorse";
    else if (lower.includes("i reject") || lower.includes("i disagree") || lower.includes("this is false")) stance = "reject";
  }
  return { stance, confidence };
}

function validFinalResponseObject(raw) {
  const value = parseLastJsonObject(raw);
  const validStance = ["endorse", "reject", "uncertain"].includes(value?.stance);
  const validConfidence = typeof value?.confidence === "number"
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
  return validStance && validConfidence ? { stance: value.stance, confidence: value.confidence } : null;
}

function sameConfidence(left, right) {
  return Math.abs(Number(left) - Number(right)) < 1e-9;
}

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  return raw ? JSON.parse(raw) : [];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function requestHash(audit) {
  const descriptor = canonicalize({
    model: audit.model ?? null,
    temperature: audit.temperature ?? null,
    maxTokens: audit.maxTokens ?? null,
    responseMode: audit.responseMode ?? null,
    structuredOutputName: audit.structuredOutputName ?? null,
    structuredOutputSchema: audit.structuredOutputSchema ?? null,
    systemPrompt: audit.systemPrompt ?? "",
    userPrompt: audit.userPrompt ?? "",
  });
  return crypto.createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
}

if (manifest.id !== smokeId || manifest.sourceStudyId !== fullId) fail("Smoke study ids are wrong.");
if (manifest.plannedRuns !== manifest.cells.length || manifest.plannedModelCalls !== manifest.cells.length * 36) fail("Smoke run or call count is inconsistent.");
const completeOrderOne = manifest.cells.filter((cell) => cell.order === 1);
if (completeOrderOne.length !== 8 || new Set(completeOrderOne.map((cell) => cell.arm)).size !== 8) fail("Smoke plan does not contain the complete order-01 factorial.");
if (smokeId === "prompt_frame_crossover_smoke_v2") {
  if (manifest.cells.length !== 16 || manifest.plannedModelCalls !== 576) fail("V2 stress smoke is not 16 runs and 576 calls.");
  for (const order of [13, 18]) {
    const stress = manifest.cells.filter((cell) => cell.order === order);
    if (stress.length !== 4 || stress.some((cell) => cell.promptFrame !== "live_discussion")) fail(`V2 stress order ${order} is incomplete.`);
  }
  if (manifest.cells.some((cell) => ![1, 13, 18].includes(cell.order))) fail("V2 smoke contains an unexpected order.");
}
if (!Number.isInteger(expectedOutputTokenCap) || expectedOutputTokenCap !== requiredOutputTokenCap) fail(`Expected output-token cap ${requiredOutputTokenCap}, found ${expectedOutputTokenCap}.`);
if (!manifest.isolation?.separateStudyId || !manifest.isolation?.separateRunConfigIds || !manifest.isolation?.separateOutputDir) fail("Smoke isolation flags are false.");
if (manifest.outputDir === fullManifest.outputDir || manifest.outputDir.includes(`/output/${fullId}`)) fail("Smoke output overlaps the frozen output directory.");

const loaded = manifest.cells.map((cell) => {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  const summaryPath = path.join(runConfig.outputDir, runId, "summary.json");
  if (!runConfig.id.startsWith(`${smokeId}_`) || runConfig.id.startsWith(`${fullId}_`)) fail(`${cell.id}: run-config id is not isolated.`);
  if (runConfig.outputDir !== manifest.outputDir) fail(`${cell.id}: run-config output directory is not isolated.`);
  if (runConfig.turnOrder?.join(">") !== runConfig.agents.map((agent) => agent.id).join(">")) fail(`${cell.id}: explicit turn order changed.`);
  if (runConfig.maxSteps !== 36 || runConfig.budget.maxModelCalls !== 36 || runConfig.budget.temperature !== 0 || runConfig.budget.maxOutputTokensPerCall !== expectedOutputTokenCap) fail(`${cell.id}: smoke budget changed.`);
  if (condition.interaction.promptFrame !== cell.promptFrame) fail(`${cell.id}: prompt frame changed.`);
  return { cell, runConfig, condition, runId, summaryPath };
});

const completed = loaded.filter((item) => fs.existsSync(item.summaryPath));
const runs = [];
for (const item of completed) {
  const { cell, runConfig, condition, runId, summaryPath } = item;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const calls = query(dbPath, "SELECT COUNT(*) AS n FROM model_calls;")[0]?.n ?? 0;
  const completionStats = query(dbPath, `
    SELECT MIN(completion_tokens) AS minTokens,
           MAX(completion_tokens) AS maxTokens,
           SUM(CASE WHEN completion_tokens >= ${expectedOutputTokenCap} THEN 1 ELSE 0 END) AS atCap
    FROM model_calls;
  `)[0] ?? { minTokens: null, maxTokens: null, atCap: 0 };
  const models = query(dbPath, "SELECT DISTINCT model_name AS model FROM model_calls;").map((row) => row.model);
  const sourceIds = new Set(runConfig.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const traceRows = query(dbPath, `SELECT retrieval_trace_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, retrieved_entry_ids_json AS visibleIdsJson, context_json AS payloadJson FROM retrieval_traces ORDER BY retrieval_trace_id;`)
    .map((row) => ({ ...row, source: "retrieval" }));
  const eventRows = query(dbPath, `SELECT event_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, output_json AS payloadJson FROM events WHERE event_type='chat_prompt_audit' ORDER BY event_id;`)
    .map((row) => ({ ...row, source: "event" }));
  const promptRows = condition.interaction.mode === "memory" ? traceRows : eventRows;
  const prompts = promptRows.map((row) => {
    const payload = parseJson(row.payloadJson, {});
    const audit = payload.promptAudit ?? payload;
    return {
      agentId: row.agentId,
      promptFrame: payload.promptFrame ?? audit.promptFrame ?? null,
      responseMode: audit.responseMode ?? null,
      structuredOutputName: audit.structuredOutputName ?? null,
      structuredOutputSchema: audit.structuredOutputSchema ?? null,
      parseValid: payload.responseParseValid ?? payload.parseValid ?? null,
      rawResponse: typeof audit.rawResponse === "string"
        ? audit.rawResponse
        : typeof payload.rawResponse === "string" ? payload.rawResponse : "",
      systemPrompt: audit.systemPrompt ?? "",
      userPrompt: audit.userPrompt ?? "",
      hash: requestHash(audit),
      visibleHistoryCount: payload.visibleHistoryCount ?? audit.visibleHistoryCount ?? null,
      visibleHistoryAgentIds: payload.visibleHistoryAgentIds ?? audit.visibleHistoryAgentIds ?? [],
      uncertainVisibleCount: payload.uncertainVisibleCount ?? audit.uncertainVisibleCount ?? null,
      selfVisibleCount: payload.selfVisibleCount ?? audit.selfVisibleCount ?? null,
      visibleIds: parseJson(row.visibleIdsJson ?? "[]", []),
    };
  });
  const finals = query(dbPath, `WITH last AS (SELECT agent_id, MAX(step_index) AS final_step FROM agent_claim_states WHERE claim_id='claim_ego_depletion' GROUP BY agent_id) SELECT s.agent_id AS agentId, s.stance, s.confidence FROM agent_claim_states s JOIN last l ON s.agent_id=l.agent_id AND s.step_index=l.final_step WHERE s.claim_id='claim_ego_depletion';`);
  const neutral = finals.filter((row) => !sourceIds.has(row.agentId));
  const responseStates = query(dbPath, `SELECT step_index AS stepIndex, agent_id AS agentId, stance, confidence FROM agent_claim_states WHERE claim_id='claim_ego_depletion' AND step_index > 0 ORDER BY state_id;`);
  const chatMessages = query(dbPath, `SELECT message_id AS messageId, agent_id AS agentId, message_text AS text, stance, confidence FROM chat_messages WHERE claim_id='claim_ego_depletion' ORDER BY message_id;`);
  const sourceChat = sourceIds.size === 0 ? [] : chatMessages.filter((message) => sourceIds.has(message.agentId));
  const fixedEvents = query(dbPath, "SELECT agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type='fixed_source_statement' ORDER BY event_id;");
  const fixedExact = !cell.hasSources
    ? sourceChat.length === 0 && fixedEvents.length === 0
    : condition.interaction.mode === "memory"
      ? fixedEvents.length === 6 && fixedEvents.every((event) => parseJson(event.outputJson, {}).text === manifest.fixedCausalMessage)
      : sourceChat.length === 6 && sourceChat.every((message) => message.text === manifest.fixedCausalMessage && message.stance === "endorse");

  if (calls !== 36) fail(`${cell.id}: expected 36 calls, found ${calls}.`);
  if (Number(completionStats.atCap) > 0) fail(`${cell.id}: ${completionStats.atCap} completion(s) reached the ${expectedOutputTokenCap}-token cap.`);
  if (models.length !== 1 || models[0] !== manifest.model) fail(`${cell.id}: model pin failed.`);
  if (prompts.length !== 36) fail(`${cell.id}: expected 36 prompt audits, found ${prompts.length}.`);
  if (prompts.some((prompt) => prompt.promptFrame !== cell.promptFrame || prompt.parseValid !== true || !prompt.systemPrompt || !prompt.userPrompt)) fail(`${cell.id}: prompt or parse audit failed.`);
  if (prompts.some((prompt) => prompt.responseMode === "structured_assessment" && (!prompt.structuredOutputName || !prompt.structuredOutputSchema))) fail(`${cell.id}: structured request contract is incomplete.`);
  if (prompts.some((prompt) => prompt.responseMode === "discussion_raw" && (prompt.structuredOutputName !== null || prompt.structuredOutputSchema !== null))) fail(`${cell.id}: discussion request unexpectedly uses structured output.`);
  prompts.forEach((prompt, index) => {
    const finalObject = validFinalResponseObject(prompt.rawResponse);
    if (!finalObject) {
      fail(`${cell.id}: call ${index + 1} lacks a complete final stance/confidence object.`);
      return;
    }
    const parsed = prompt.promptFrame === "live_discussion"
      ? parseDiscussionOutcome(prompt.rawResponse)
      : finalObject;
    if (parsed.stance !== finalObject.stance || !sameConfidence(parsed.confidence, finalObject.confidence)) {
      fail(`${cell.id}: production parser did not recover call ${index + 1}'s final object exactly.`);
    }
    if (sourceIds.has(prompt.agentId)) return;
    const stored = condition.interaction.mode === "chat"
      ? chatMessages[index] ?? null
      : responseStates.find((row) => row.agentId === prompt.agentId && row.stepIndex === promptRows[index].stepIndex) ?? null;
    if (!stored) {
      fail(`${cell.id}: call ${index + 1} has no matching stored neutral response.`);
    } else if (stored.stance !== parsed.stance || !sameConfidence(stored.confidence, parsed.confidence)) {
      fail(`${cell.id}: stored neutral response differs from the parsed final object at call ${index + 1}.`);
    }
  });
  if (neutral.length !== (cell.hasSources ? 10 : 12)) fail(`${cell.id}: neutral final count is wrong.`);
  if (!fixedExact) fail(`${cell.id}: fixed source text or count changed.`);
  if (condition.interaction.mode === "memory") {
    if (prompts.some((prompt) => prompt.visibleIds.length > 6)) fail(`${cell.id}: memory retrieval exceeds six entries.`);
    const uncertainStored = query(dbPath, "SELECT COUNT(*) AS n FROM memory_entries WHERE stance='uncertain';")[0]?.n ?? 0;
    if (uncertainStored !== 0) fail(`${cell.id}: memory stored uncertain judgments.`);
  } else {
    const messages = chatMessages;
    if (messages.length !== 36) fail(`${cell.id}: expected 36 debate messages.`);
    prompts.forEach((prompt, index) => {
      const expected = messages.slice(0, index).filter((message) => message.agentId !== prompt.agentId);
      if (prompt.visibleHistoryCount !== expected.length || prompt.visibleHistoryAgentIds.join(">") !== expected.map((message) => message.agentId).join(">")) fail(`${cell.id}: debate visibility failed at call ${index + 1}.`);
      if (prompt.selfVisibleCount !== 0 || prompt.uncertainVisibleCount !== expected.filter((message) => message.stance === "uncertain").length) fail(`${cell.id}: debate self/uncertainty visibility failed at call ${index + 1}.`);
    });
  }
  runs.push({
    arm: cell.arm,
    order: cell.order,
    protocolFlow: cell.protocolFlow,
    promptFrame: cell.promptFrame,
    sourceCondition: cell.sourceCondition,
    runId,
    calls,
    completionTokens: completionStats,
    neutralFinal: Object.fromEntries(["endorse", "reject", "uncertain"].map((stance) => [stance, neutral.filter((row) => row.stance === stance).length])),
    finalByAgent: Object.fromEntries(finals.map((row) => [row.agentId, { stance: row.stance, confidence: row.confidence }])),
    sourceAgentIds: [...sourceIds].sort(),
    firstRequestHash: prompts[0]?.hash ?? null,
    maxVisibleHistoryCount: Math.max(0, ...prompts.map((prompt) => Number(prompt.visibleHistoryCount) || 0)),
    fixedExact,
  });
}

const requestPairs = [];
for (const promptFrame of ["memory_assessment", "live_discussion"]) {
  for (const sourceCondition of ["no_repeating_agents", "causal_explanation"]) {
    const memory = runs.find((run) => run.order === 1 && run.promptFrame === promptFrame && run.sourceCondition === sourceCondition && run.protocolFlow === "shared_memory");
    const debate = runs.find((run) => run.order === 1 && run.promptFrame === promptFrame && run.sourceCondition === sourceCondition && run.protocolFlow === "live_debate");
    if (!memory || !debate) continue;
    const exact = Boolean(memory.firstRequestHash && memory.firstRequestHash === debate.firstRequestHash);
    if (!exact) fail(`${promptFrame}/${sourceCondition}: first request contract differs across protocols.`);
    requestPairs.push({ promptFrame, sourceCondition, exact, hash: memory.firstRequestHash });
  }
}
if (completed.length === manifest.plannedRuns && requestPairs.length !== 4) fail(`Expected four order-01 first-request pairs, found ${requestPairs.length}.`);

if (completed.length > 0 && smokeId === "prompt_frame_crossover_smoke_v2") {
  const stressDebates = runs.filter((run) => [13, 18].includes(run.order) && run.protocolFlow === "live_debate" && run.promptFrame === "live_discussion");
  if (completed.length === manifest.plannedRuns && stressDebates.length !== 4) fail(`Expected four completed long-history debate stress runs, found ${stressDebates.length}.`);
  for (const run of stressDebates) {
    if (run.maxVisibleHistoryCount < 33) fail(`${run.runId}: late-round debate history reached only ${run.maxVisibleHistoryCount} visible messages.`);
  }
}

const stanceLabels = ["endorse", "reject", "uncertain"];
function countsFor(run, agentIds) {
  const rows = agentIds.map((agentId) => run.finalByAgent[agentId]).filter(Boolean);
  return Object.fromEntries(stanceLabels.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}
function subtract(left, right) {
  return Object.fromEntries(stanceLabels.map((stance) => [stance, left[stance] - right[stance]]));
}

const sourceContrasts = [];
const sourceAdjustedProtocol = [];
let threeWay = null;
const sourceEffects = new Map();
for (const protocolFlow of ["shared_memory", "live_debate"]) {
  for (const promptFrame of ["memory_assessment", "live_discussion"]) {
    const causal = runs.find((run) => run.order === 1 && run.protocolFlow === protocolFlow && run.promptFrame === promptFrame && run.sourceCondition === "causal_explanation");
    const noSource = runs.find((run) => run.order === 1 && run.protocolFlow === protocolFlow && run.promptFrame === promptFrame && run.sourceCondition === "no_repeating_agents");
    if (!causal || !noSource) continue;
    const matchedNeutralIds = Object.keys(causal.finalByAgent).filter((agentId) => !causal.sourceAgentIds.includes(agentId)).sort();
    if (matchedNeutralIds.length !== 10) fail(`${protocolFlow}/${promptFrame}: source contrast does not contain ten identity-matched neutral agents.`);
    const causalCounts = countsFor(causal, matchedNeutralIds);
    const noSourceCounts = countsFor(noSource, matchedNeutralIds);
    const effect = subtract(causalCounts, noSourceCounts);
    sourceEffects.set(`${protocolFlow}|${promptFrame}`, effect);
    sourceContrasts.push({ protocolFlow, promptFrame, matchedNeutralIds, causal: causalCounts, noRepeatingAgents: noSourceCounts, differenceCausalMinusNoRepeating: effect });
  }
}
for (const promptFrame of ["memory_assessment", "live_discussion"]) {
  const shared = sourceEffects.get(`shared_memory|${promptFrame}`);
  const debate = sourceEffects.get(`live_debate|${promptFrame}`);
  if (!shared || !debate) continue;
  sourceAdjustedProtocol.push({ promptFrame, sharedMemorySourceEffect: shared, liveDebateSourceEffect: debate, differenceSharedMinusDebate: subtract(shared, debate) });
}
if (sourceAdjustedProtocol.length === 2) {
  const assessment = sourceAdjustedProtocol.find((row) => row.promptFrame === "memory_assessment");
  const discussion = sourceAdjustedProtocol.find((row) => row.promptFrame === "live_discussion");
  threeWay = {
    memoryAssessmentSourceAdjustedProtocolGap: assessment.differenceSharedMinusDebate,
    liveDiscussionSourceAdjustedProtocolGap: discussion.differenceSharedMinusDebate,
    protocolByPromptBySource: subtract(assessment.differenceSharedMinusDebate, discussion.differenceSharedMinusDebate),
  };
}
if (completed.length === manifest.plannedRuns && (sourceContrasts.length !== 4 || sourceAdjustedProtocol.length !== 2 || !threeWay)) {
  fail("Order-01 identity-matched source effects or the protocol x prompt x source interaction are incomplete.");
}

const report = {
  generatedAt: new Date().toISOString(),
  status: completed.length === 0 ? "planned" : completed.length === manifest.plannedRuns ? "complete" : "partial",
  manifestPath,
  isolation: manifest.isolation,
  plannedRuns: manifest.plannedRuns,
  completedRuns: completed.length,
  pendingRuns: manifest.plannedRuns - completed.length,
  checks: {
    valid: failures.length === 0,
    isolatedFromFrozenBatch: manifest.outputDir !== fullManifest.outputDir && manifest.cells.every((cell) => cell.id.startsWith(`${smokeId}_`)),
    complete: completed.length === manifest.plannedRuns,
    allCallsAndPromptsAudited: runs.every((run) => run.calls === 36),
    everyCompletionBelowOutputCap: runs.every((run) => Number(run.completionTokens.atCap) === 0),
    allFirstRequestContractsMatch: requestPairs.every((pair) => pair.exact),
    longHistoryStressReachedLateRound: smokeId !== "prompt_frame_crossover_smoke_v2" || runs
      .filter((run) => [13, 18].includes(run.order) && run.protocolFlow === "live_debate" && run.promptFrame === "live_discussion")
      .every((run) => run.maxVisibleHistoryCount >= 33),
    identityMatchedSourceEffectsComplete: completed.length === 0 ? null : sourceContrasts.length === 4,
    threeWayInteractionComplete: completed.length === 0 ? null : Boolean(threeWay),
  },
  failures,
  requestPairs,
  sourceContrasts,
  sourceAdjustedProtocol,
  threeWay,
  runs,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status: report.status, checks: report.checks, failures, runs }, null, 2));
if (failures.length > 0) process.exitCode = 1;
