import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const studyId = process.env.PROMPT_FRAME_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const manifestPath = path.join(root, "experiments", studyId, "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const reportPath = path.join(root, "analysis", `${studyId.replaceAll("_", "-")}-audit.json`);
const expectedModel = "claude-haiku-4-5-20251001";
const expectedOutputTokenCap = Number(manifest.maxOutputTokensPerCall ?? 384);
const requiredOutputTokenCap = Number(process.env.PROMPT_FRAME_EXPECTED_OUTPUT_TOKEN_CAP ?? expectedOutputTokenCap);
const expectedPromptFrames = ["live_discussion", "memory_assessment"];
const expectedProtocols = ["live_debate", "shared_memory"];
const expectedSources = ["causal_explanation", "no_repeating_agents"];
const stanceLabels = ["endorse", "reject", "uncertain"];

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
      continue;
    }
    if (character !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const value = JSON.parse(raw.slice(start, index + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) objects.push(value);
    } catch {
      // Match the production parser: ignore incomplete objects and keep looking.
    }
    start = -1;
  }
  return objects.at(-1) ?? null;
}

function normalizeStance(value) {
  if (value === "endorse" || value === "reject" || value === "uncertain") return value;
  const normalized = String(value).toLowerCase().trim();
  if (["endorse", "true", "agree", "support"].includes(normalized)) return "endorse";
  if (["reject", "false", "disagree", "oppose"].includes(normalized)) return "reject";
  return "uncertain";
}

// Keep this deliberately identical to parseChatResponse's stance/confidence
// extraction. The separate final-object check below catches cases where the
// response satisfies the contract but the production regex silently misses it.
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
      // Match the production parser's text fallback below.
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
  const validStance = value?.stance === "endorse" || value?.stance === "reject" || value?.stance === "uncertain";
  const validConfidence = typeof value?.confidence === "number"
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1;
  return validStance && validConfidence
    ? { stance: value.stance, confidence: value.confidence }
    : null;
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

function requestDescriptor(audit) {
  return canonicalize({
    model: audit.model ?? null,
    temperature: audit.temperature ?? null,
    maxTokens: audit.maxTokens ?? null,
    responseMode: audit.responseMode ?? null,
    structuredOutputName: audit.structuredOutputName ?? null,
    structuredOutputSchema: audit.structuredOutputSchema ?? null,
    systemPrompt: audit.systemPrompt ?? "",
    userPrompt: audit.userPrompt ?? "",
  });
}

function hashRequest(audit) {
  return crypto.createHash("sha256").update(JSON.stringify(requestDescriptor(audit))).digest("hex");
}

function stanceCounts(rows) {
  return Object.fromEntries(stanceLabels.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}

function loadCell(cell) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const roster = JSON.parse(fs.readFileSync(cell.rosterPath, "utf8"));
  const scenario = JSON.parse(fs.readFileSync(cell.scenarioPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  const summaryPath = path.join(runConfig.outputDir, runId, "summary.json");
  return { cell, runConfig, condition, roster, scenario, runId, summaryPath };
}

const failures = [];
const warnings = [];
const loaded = manifest.cells.map(loadCell);

function fail(message) {
  failures.push(message);
}

function sameMembers(actual, expected) {
  return [...actual].sort().join("|") === [...expected].sort().join("|");
}

// Frozen-plan checks run before any paid model call.
if (manifest.id !== studyId) fail(`Unexpected study id ${manifest.id}.`);
if (manifest.model !== expectedModel) fail(`Manifest model is ${manifest.model}, expected ${expectedModel}.`);
if (manifest.plannedRuns !== 192) fail(`Expected 192 planned runs, found ${manifest.plannedRuns}.`);
if (manifest.modelCallsPerRun !== 36) fail(`Expected 36 calls per run, found ${manifest.modelCallsPerRun}.`);
if (manifest.plannedModelCalls !== 6912) fail(`Expected 6,912 planned calls, found ${manifest.plannedModelCalls}.`);
if (!Number.isInteger(expectedOutputTokenCap) || expectedOutputTokenCap <= 0) fail("Manifest output-token cap is invalid.");
if (expectedOutputTokenCap !== requiredOutputTokenCap) fail(`Expected output-token cap ${requiredOutputTokenCap}, found ${expectedOutputTokenCap}.`);
if (manifest.arms.length !== 8 || new Set(manifest.arms).size !== 8) fail("Expected eight unique arms.");
if (!sameMembers(manifest.design?.protocolFlows ?? [], expectedProtocols)) fail("Protocol-flow levels are incomplete.");
if (!sameMembers(manifest.design?.promptFrames ?? [], expectedPromptFrames)) fail("Prompt-frame levels are incomplete.");
if (!sameMembers(manifest.design?.sourceConditions ?? [], expectedSources)) fail("Source-condition levels are incomplete.");

const uniqueIds = new Set(loaded.map(({ cell }) => cell.id));
const uniqueConfigs = new Set(loaded.map(({ cell }) => cell.runConfigPath));
const uniqueSchedulePositions = new Set(loaded.map(({ cell }) => cell.schedulePosition));
if (uniqueIds.size !== 192) fail(`Expected 192 unique cell ids, found ${uniqueIds.size}.`);
if (uniqueConfigs.size !== 192) fail(`Expected 192 unique run configs, found ${uniqueConfigs.size}.`);
if (uniqueSchedulePositions.size !== 192 || ![...uniqueSchedulePositions].every((value) => value >= 1 && value <= 192)) {
  fail("Schedule positions are not the integers 1 through 192.");
}

for (let order = 1; order <= 24; order += 1) {
  const subset = loaded.filter(({ cell }) => cell.order === order);
  if (subset.length !== 8) fail(`Order ${order} has ${subset.length} cells, expected eight.`);
  const factorKeys = new Set(subset.map(({ cell }) => `${cell.protocolFlow}|${cell.promptFrame}|${cell.sourceCondition}`));
  if (factorKeys.size !== 8) fail(`Order ${order} does not contain the full 2 x 2 x 2 factorial.`);
}

const plannedOrdersByArm = new Map(manifest.arms.map((arm) => [
  arm,
  loaded.filter(({ cell }) => cell.arm === arm).map(({ runConfig }) => runConfig.turnOrder.join(">")),
]));
const referenceOrderSet = new Set(plannedOrdersByArm.get(manifest.arms[0]) ?? []);
for (const arm of manifest.arms) {
  const orders = plannedOrdersByArm.get(arm) ?? [];
  if (new Set(orders).size !== 24 || !sameMembers(new Set(orders), referenceOrderSet)) {
    fail(`${arm}: does not use the same 24 unique speaker orders as every other arm.`);
  }
  const agentIds = loaded.find(({ cell }) => cell.arm === arm)?.runConfig.agents.map((agent) => agent.id) ?? [];
  for (const agentId of agentIds) {
    const positions = Array.from({ length: 12 }, () => 0);
    for (const orderKey of orders) {
      const position = orderKey.split(">").indexOf(agentId);
      if (position >= 0) positions[position] += 1;
    }
    if (positions.some((count) => count !== 2)) fail(`${arm}: ${agentId} does not appear exactly twice in every speaking position.`);
  }
  if (arm.startsWith("causal_explanation__")) {
    const sourcePositionCounts = Array.from({ length: 12 }, () => 0);
    for (const { runConfig } of loaded.filter(({ cell }) => cell.arm === arm)) {
      runConfig.agents.forEach((agent, position) => {
        if (agent.role === "contamination_agent") sourcePositionCounts[position] += 1;
      });
    }
    if (sourcePositionCounts.some((count) => count !== 4)) fail(`${arm}: source agents do not occupy every speaking position exactly four times.`);
  }
}

for (const item of loaded) {
  const { cell, runConfig, condition, roster, scenario } = item;
  const key = cell.id;
  const expectedMode = cell.protocolFlow === "shared_memory" ? "memory" : "chat";
  const expectedSourceCount = cell.hasSources ? 2 : 0;
  const actualSourceCount = runConfig.agents.filter((agent) => agent.role === "contamination_agent").length;
  const expectedArm = `${cell.sourceCondition}__${cell.protocolFlow}__${cell.promptFrame}`;
  if (cell.arm !== expectedArm || !manifest.arms.includes(expectedArm)) fail(`${key}: arm metadata is inconsistent.`);
  if (condition.interaction.mode !== expectedMode) fail(`${key}: protocol flow does not match interaction mode.`);
  if (condition.interaction.promptFrame !== cell.promptFrame) fail(`${key}: condition prompt frame does not match the cell.`);
  if (condition.memory.mode !== "shared" || condition.memory.maxRetrievedEntries !== 6 || condition.memory.writeUncertainAnswers !== false) {
    fail(`${key}: shared-record settings changed.`);
  }
  if (condition.interaction.chatRounds !== 3 || condition.interaction.adaptiveStopping !== false) fail(`${key}: expected exactly three non-adaptive rounds.`);
  if (condition.interaction.topology !== "fully-connected") fail(`${key}: topology is not fully connected.`);
  if (runConfig.maxSteps !== 36 || runConfig.budget.maxModelCalls !== 36 || runConfig.budget.temperature !== 0) fail(`${key}: run budget is not 36 calls at temperature zero.`);
  if (runConfig.budget.maxOutputTokensPerCall !== expectedOutputTokenCap) fail(`${key}: output-token cap changed.`);
  if (runConfig.outputDir !== manifest.outputDir) fail(`${key}: output directory is not the frozen study directory.`);
  if (runConfig.agents.length !== 12 || roster.agents.length !== 12) fail(`${key}: expected twelve agents.`);
  if (actualSourceCount !== expectedSourceCount) fail(`${key}: expected ${expectedSourceCount} source agents, found ${actualSourceCount}.`);
  if (runConfig.agents.some((agent) => agent.model !== expectedModel)) fail(`${key}: a roster model is not ${expectedModel}.`);
  const agentIds = runConfig.agents.map((agent) => agent.id);
  if (!sameMembers(agentIds, roster.agents.map((agent) => agent.id))) fail(`${key}: embedded agents differ from roster agents.`);
  if (runConfig.turnOrder?.join(">") !== agentIds.join(">")) fail(`${key}: explicit turn order differs from embedded roster order.`);
  if (cell.turnOrder?.join(">") !== agentIds.join(">")) fail(`${key}: manifest turn order differs from run config.`);
  if (scenario.claims?.length !== 1 || scenario.focusClaimId !== "claim_ego_depletion") fail(`${key}: unexpected scenario task.`);
  if (cell.hasSources) {
    if (condition.interaction.adversaryCommitment !== "enforced") fail(`${key}: source commitment is not enforced.`);
    if (condition.interaction.fixedSourceMessage !== manifest.fixedCausalMessage) fail(`${key}: fixed source message changed.`);
  } else {
    if (condition.interaction.fixedSourceMessage !== undefined) fail(`${key}: no-source arm contains a fixed message.`);
    if ((scenario.initialBeliefStates ?? []).length !== 0) fail(`${key}: no-source scenario contains initial beliefs.`);
  }
}

const completed = loaded.filter(({ summaryPath }) => fs.existsSync(summaryPath));
const preflight = {
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  completedRuns: completed.length,
  pendingRuns: manifest.plannedRuns - completed.length,
  arms: manifest.arms.length,
  ordersPerArm: 24,
  eachArmHas24PlannedCells: manifest.arms.every((arm) => loaded.filter(({ cell }) => cell.arm === arm).length === 24),
  failures: failures.length,
  warnings: warnings.length,
};

const runAudits = [];
if (completed.length > 0 && completed.length !== manifest.plannedRuns) {
  warnings.push(`Only ${completed.length} of ${manifest.plannedRuns} runs are complete; outcome checks are provisional.`);
}

for (const item of completed) {
  const { cell, runConfig, condition, runId, summaryPath } = item;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const sourceIds = new Set(runConfig.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const calls = query(dbPath, "SELECT COUNT(*) AS n FROM model_calls;")[0]?.n ?? 0;
  const completionStats = query(dbPath, `
    SELECT MIN(completion_tokens) AS minTokens,
           MAX(completion_tokens) AS maxTokens,
           SUM(CASE WHEN completion_tokens >= ${Number(runConfig.budget.maxOutputTokensPerCall)} THEN 1 ELSE 0 END) AS atCap
    FROM model_calls;
  `)[0] ?? { minTokens: null, maxTokens: null, atCap: 0 };
  const models = query(dbPath, "SELECT DISTINCT model_name AS model FROM model_calls ORDER BY model_name;").map((row) => row.model);
  const finalStates = query(dbPath, `
    WITH last AS (
      SELECT agent_id, MAX(step_index) AS final_step
      FROM agent_claim_states
      WHERE claim_id='claim_ego_depletion'
      GROUP BY agent_id
    )
    SELECT s.agent_id AS agentId, s.stance, s.confidence, l.final_step AS finalStep
    FROM agent_claim_states s
    JOIN last l ON s.agent_id=l.agent_id AND s.step_index=l.final_step
    WHERE s.claim_id='claim_ego_depletion'
    ORDER BY s.agent_id;
  `);
  const neutralFinal = finalStates.filter((row) => !sourceIds.has(row.agentId));
  const sourceFinal = finalStates.filter((row) => sourceIds.has(row.agentId));
  const responseStates = query(dbPath, `
    SELECT step_index AS stepIndex, agent_id AS agentId, stance, confidence
    FROM agent_claim_states
    WHERE claim_id='claim_ego_depletion' AND step_index > 0
    ORDER BY state_id;
  `);
  const firstAgent = runConfig.turnOrder[0];
  const firstResponse = condition.interaction.mode === "memory"
    ? query(dbPath, `SELECT stance, confidence FROM agent_claim_states WHERE step_index=1 AND agent_id='${firstAgent.replaceAll("'", "''")}' AND claim_id='claim_ego_depletion' ORDER BY state_id LIMIT 1;`)[0] ?? null
    : query(dbPath, `SELECT stance, confidence FROM chat_messages WHERE round=1 AND agent_id='${firstAgent.replaceAll("'", "''")}' AND claim_id='claim_ego_depletion' ORDER BY message_id LIMIT 1;`)[0] ?? null;

  const tracePromptRows = query(dbPath, `
    SELECT retrieval_trace_id AS ordinal, step_index AS stepIndex, agent_id AS agentId,
           retrieved_entry_ids_json AS visibleIdsJson, context_json AS payloadJson
    FROM retrieval_traces
    ORDER BY retrieval_trace_id;
  `).map((row) => ({ ...row, source: "retrieval_trace" }));
  const eventPromptRows = query(dbPath, `
    SELECT event_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, event_type AS eventType, output_json AS payloadJson
    FROM events
    WHERE json_extract(output_json,'$.promptAudit.systemPrompt') IS NOT NULL
       OR json_extract(output_json,'$.systemPrompt') IS NOT NULL
    ORDER BY event_id;
  `).map((row) => ({ ...row, source: "event" }));
  const candidatePromptRows = condition.interaction.mode === "memory" ? tracePromptRows : eventPromptRows;
  const promptRecords = candidatePromptRows.map((row) => {
    const payload = parseJson(row.payloadJson, {});
    const audit = payload.promptAudit ?? payload;
    const systemPrompt = typeof audit.systemPrompt === "string" ? audit.systemPrompt : "";
    const userPrompt = typeof audit.userPrompt === "string" ? audit.userPrompt : "";
    const descriptor = requestDescriptor(audit);
    return {
      source: row.source,
      ordinal: row.ordinal,
      stepIndex: row.stepIndex,
      agentId: row.agentId,
      eventType: row.eventType ?? null,
      systemPrompt,
      userPrompt,
      rawResponse: typeof audit.rawResponse === "string"
        ? audit.rawResponse
        : typeof payload.rawResponse === "string" ? payload.rawResponse : "",
      requestHash: systemPrompt && userPrompt ? hashRequest(audit) : null,
      responseMode: audit.responseMode ?? null,
      structuredOutputName: audit.structuredOutputName ?? null,
      structuredOutputSchema: audit.structuredOutputSchema ?? null,
      model: audit.model ?? null,
      temperature: audit.temperature ?? null,
      maxTokens: audit.maxTokens ?? null,
      parseValid: payload.responseParseValid ?? payload.parseValid ?? audit.responseParseValid ?? null,
      promptFrame: payload.promptFrame ?? audit.promptFrame ?? payload.resolvedPromptFrame ?? audit.resolvedPromptFrame ?? null,
      visibleHistoryCount: payload.visibleHistoryCount ?? audit.visibleHistoryCount ?? null,
      visibleHistoryIds: payload.visibleHistoryIds ?? audit.visibleHistoryIds ?? parseJson(row.visibleIdsJson ?? "[]", []),
      visibleHistoryAgentIds: payload.visibleHistoryAgentIds ?? audit.visibleHistoryAgentIds ?? null,
      uncertainVisibleCount: payload.uncertainVisibleCount ?? audit.uncertainVisibleCount ?? null,
      selfVisibleCount: payload.selfVisibleCount ?? audit.selfVisibleCount ?? null,
      descriptor,
    };
  });

  const memoryEntries = query(dbPath, `
    SELECT memory_entry_id AS id, step_index AS stepIndex, agent_id AS agentId, stance
    FROM memory_entries
    WHERE claim_id='claim_ego_depletion'
    ORDER BY step_index, memory_entry_id;
  `);
  const memoryById = new Map(memoryEntries.map((entry) => [entry.id, entry]));
  const chatMessages = query(dbPath, `
    SELECT message_id AS messageId, round, agent_id AS agentId, stance, confidence
    FROM chat_messages
    WHERE claim_id='claim_ego_depletion'
    ORDER BY message_id;
  `);

  const fixedEvents = query(dbPath, "SELECT agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type='fixed_source_statement' ORDER BY event_id;");
  const sourceChat = sourceIds.size === 0 ? [] : query(dbPath, `
    SELECT agent_id AS agentId, message_text AS text, stance, confidence
    FROM chat_messages
    WHERE agent_id IN (${[...sourceIds].map((id) => `'${id.replaceAll("'", "''")}'`).join(",")})
    ORDER BY message_id;
  `);
  const fixedMessagesExact = !cell.hasSources
    ? fixedEvents.length === 0 && sourceChat.length === 0
    : condition.interaction.mode === "memory"
      ? fixedEvents.length === 6 && fixedEvents.every((event) => {
        const payload = parseJson(event.outputJson, {});
        return sourceIds.has(event.agentId) && payload.stance === "endorse" && payload.text === manifest.fixedCausalMessage;
      })
      : sourceChat.length === 6 && sourceChat.every((message) => sourceIds.has(message.agentId) && message.stance === "endorse" && message.text === manifest.fixedCausalMessage);

  if (calls !== 36) fail(`${cell.id}: observed ${calls} model calls, expected 36.`);
  if (Number(completionStats.atCap) > 0) fail(`${cell.id}: ${completionStats.atCap} completion(s) reached the output-token cap.`);
  if (models.length !== 1 || models[0] !== expectedModel) fail(`${cell.id}: observed model set ${models.join(", ")}.`);
  if (neutralFinal.length !== (cell.hasSources ? 10 : 12)) fail(`${cell.id}: missing neutral final judgments.`);
  if (cell.hasSources && (sourceFinal.length !== 2 || sourceFinal.some((row) => row.stance !== "endorse"))) fail(`${cell.id}: source final states are wrong.`);
  if (!firstResponse || !stanceLabels.includes(firstResponse.stance)) fail(`${cell.id}: missing first-speaker response.`);
  if (!fixedMessagesExact) fail(`${cell.id}: fixed source message count, text, or stance changed.`);
  if (promptRecords.length !== 36) fail(`${cell.id}: found ${promptRecords.length} prompt audit records, expected 36.`);
  if (promptRecords.some((record) => !record.systemPrompt || !record.userPrompt || !record.requestHash)) fail(`${cell.id}: prompt audit text is incomplete.`);
  if (promptRecords.some((record) => !record.responseMode || !record.model || record.maxTokens === null)) fail(`${cell.id}: request-contract audit is incomplete.`);
  if (promptRecords.some((record) => record.responseMode === "structured_assessment" && (!record.structuredOutputName || !record.structuredOutputSchema))) {
    fail(`${cell.id}: structured-assessment request is missing its output name or schema.`);
  }
  if (promptRecords.some((record) => record.responseMode === "discussion_raw" && (record.structuredOutputName !== null || record.structuredOutputSchema !== null))) {
    fail(`${cell.id}: discussion request unexpectedly uses structured output.`);
  }
  if (promptRecords.some((record) => record.parseValid !== true)) fail(`${cell.id}: at least one response used a parse fallback or lacks a valid-parse audit.`);
  if (promptRecords.some((record) => record.promptFrame !== cell.promptFrame)) fail(`${cell.id}: resolved prompt frame differs from manifest.`);

  // A valid final JSON object is not enough for discussion responses: the
  // production parser uses a narrower regex. Verify both the parser outcome
  // and the actually stored stance so a silent default cannot pass the audit.
  if (cell.promptFrame === "live_discussion") {
    for (let index = 0; index < promptRecords.length; index += 1) {
      const record = promptRecords[index];
      const finalObject = validFinalResponseObject(record.rawResponse);
      const parserOutcome = parseDiscussionOutcome(record.rawResponse);
      if (!finalObject) {
        fail(`${cell.id}: discussion call ${index + 1} lacks a valid final stance/confidence object.`);
        continue;
      }
      if (parserOutcome.stance !== finalObject.stance || !sameConfidence(parserOutcome.confidence, finalObject.confidence)) {
        fail(`${cell.id}: discussion call ${index + 1} has a valid final JSON object that the production parser did not recover exactly.`);
      }
      const agentId = record.agentId;
      if (sourceIds.has(agentId)) continue; // Public source output is deliberately enforced after parsing.
      const stored = condition.interaction.mode === "chat"
        ? chatMessages[index] ?? null
        : responseStates.find((row) => row.agentId === agentId && row.stepIndex === record.stepIndex) ?? null;
      if (!stored) {
        fail(`${cell.id}: discussion call ${index + 1} has no matching stored neutral response.`);
      } else if (stored.stance !== parserOutcome.stance || !sameConfidence(stored.confidence, parserOutcome.confidence)) {
        fail(`${cell.id}: stored neutral response at discussion call ${index + 1} differs from the production parser outcome.`);
      }
    }
  }

  const forbiddenExact = [cell.id, condition.id, runId, item.roster.id].filter(Boolean);
  for (const record of promptRecords) {
    const promptText = `${record.systemPrompt}\n${record.userPrompt}`;
    if (forbiddenExact.some((token) => promptText.includes(token))) fail(`${cell.id}: prompt leaks a run, condition, or roster id at call ${record.ordinal}.`);
    if (/\border[ _-]*0?\d+\b/i.test(promptText)) fail(`${cell.id}: prompt leaks an order label at call ${record.ordinal}.`);
    if (/\bseed[ _:=\-]*\d+\b/i.test(promptText)) fail(`${cell.id}: prompt leaks a seed at call ${record.ordinal}.`);
    if (/truth\s*label|truthLabel/i.test(promptText)) fail(`${cell.id}: prompt leaks a truth-label field at call ${record.ordinal}.`);
    if (/prompt[ _-]*(?:frame[ _-]*)?(?:cross(?:over)?|swap)|\bcrossover\b/i.test(promptText)) fail(`${cell.id}: prompt leaks the experiment label at call ${record.ordinal}.`);
  }

  if (condition.interaction.mode === "memory") {
    if (memoryEntries.some((entry) => entry.stance === "uncertain")) fail(`${cell.id}: memory flow stored an uncertain judgment.`);
    for (const record of promptRecords) {
      if (!Array.isArray(record.visibleHistoryIds) || record.visibleHistoryIds.length > 6) fail(`${cell.id}: memory retrieval exceeds six entries at call ${record.ordinal}.`);
      const visibleEntries = record.visibleHistoryIds.map((id) => memoryById.get(id)).filter(Boolean);
      if (visibleEntries.some((entry) => entry.stance === "uncertain")) fail(`${cell.id}: memory flow exposed an uncertain stored judgment at call ${record.ordinal}.`);
    }
  } else {
    if (chatMessages.length !== 36) fail(`${cell.id}: debate flow has ${chatMessages.length} messages, expected 36.`);
    for (let index = 0; index < promptRecords.length; index += 1) {
      const record = promptRecords[index];
      const previousOtherMessages = chatMessages.slice(0, index).filter((message) => message.agentId !== record.agentId);
      if (record.visibleHistoryCount !== previousOtherMessages.length) fail(`${cell.id}: debate visibility count is wrong at call ${index + 1}.`);
      if (!Array.isArray(record.visibleHistoryIds) || record.visibleHistoryIds.length !== previousOtherMessages.length) fail(`${cell.id}: debate visible-history ids are incomplete at call ${index + 1}.`);
      const expectedAgentIds = previousOtherMessages.map((message) => message.agentId);
      if (!Array.isArray(record.visibleHistoryAgentIds) || record.visibleHistoryAgentIds.join(">") !== expectedAgentIds.join(">")) fail(`${cell.id}: debate visible speakers differ from all prior other speakers at call ${index + 1}.`);
      if (record.selfVisibleCount !== 0 || record.visibleHistoryAgentIds.some((id) => id === record.agentId)) fail(`${cell.id}: debate exposes the speaker's own earlier message at call ${index + 1}.`);
      const uncertainOtherCount = previousOtherMessages.filter((message) => message.stance === "uncertain").length;
      if (record.uncertainVisibleCount !== uncertainOtherCount) fail(`${cell.id}: debate uncertainty visibility is wrong at call ${index + 1}.`);
    }
  }

  runAudits.push({
    id: cell.id,
    arm: cell.arm,
    order: cell.order,
    protocolFlow: cell.protocolFlow,
    promptFrame: cell.promptFrame,
    sourceCondition: cell.sourceCondition,
    sourceAgentIds: [...sourceIds].sort(),
    runId,
    dbPath,
    calls,
    completionTokens: completionStats,
    models,
    neutralFinal: stanceCounts(neutralFinal),
    sourceFinal: stanceCounts(sourceFinal),
    finalByAgent: Object.fromEntries(finalStates.map((row) => [row.agentId, {
      stance: row.stance,
      confidence: row.confidence,
      finalStep: row.finalStep,
    }])),
    firstSpeaker: { agentId: firstAgent, ...(firstResponse ?? {}) },
    promptRecords: promptRecords.length,
    firstRequestHash: promptRecords[0]?.requestHash ?? null,
    visibilitySignature: condition.interaction.mode === "memory"
      ? promptRecords.map((record) => record.visibleHistoryIds.length).join(",")
      : promptRecords.map((record) => record.visibleHistoryCount).join(","),
    fixedMessagesExact,
  });
}

const promptPairs = [];
if (runAudits.length > 0) {
  for (const promptFrame of expectedPromptFrames) {
    for (const sourceCondition of expectedSources) {
      for (let order = 1; order <= 24; order += 1) {
        const memory = runAudits.find((run) => run.promptFrame === promptFrame && run.sourceCondition === sourceCondition && run.order === order && run.protocolFlow === "shared_memory");
        const debate = runAudits.find((run) => run.promptFrame === promptFrame && run.sourceCondition === sourceCondition && run.order === order && run.protocolFlow === "live_debate");
        if (!memory || !debate) continue;
        const exactFirstTurnMatch = Boolean(memory.firstRequestHash && memory.firstRequestHash === debate.firstRequestHash);
        if (!exactFirstTurnMatch) fail(`${promptFrame}/${sourceCondition}/order${order}: first-turn prompt differs across protocol flows.`);
        promptPairs.push({ promptFrame, sourceCondition, order, exactFirstTurnMatch, memoryHash: memory.firstRequestHash, debateHash: debate.firstRequestHash });
      }
    }
  }
}

const debateVisibilityPairs = [];
if (runAudits.length > 0) {
  for (const sourceCondition of expectedSources) {
    for (let order = 1; order <= 24; order += 1) {
      const memoryFrame = runAudits.find((run) => run.protocolFlow === "live_debate" && run.promptFrame === "memory_assessment" && run.sourceCondition === sourceCondition && run.order === order);
      const discussionFrame = runAudits.find((run) => run.protocolFlow === "live_debate" && run.promptFrame === "live_discussion" && run.sourceCondition === sourceCondition && run.order === order);
      if (!memoryFrame || !discussionFrame) continue;
      const sameVisibility = memoryFrame.visibilitySignature === discussionFrame.visibilitySignature;
      if (!sameVisibility) fail(`live_debate/${sourceCondition}/order${order}: prompt frame changed protocol visibility counts.`);
      debateVisibilityPairs.push({ sourceCondition, order, sameVisibility, signature: memoryFrame.visibilitySignature });
    }
  }
}

const byArm = {};
for (const arm of manifest.arms) {
  const subset = runAudits.filter((run) => run.arm === arm);
  byArm[arm] = {
    runs: subset.length,
    finalNeutralJudgments: Object.fromEntries(stanceLabels.map((stance) => [stance, subset.reduce((sum, run) => sum + run.neutralFinal[stance], 0)])),
    firstSpeakerResponsesByRole: {
      neutral: Object.fromEntries(stanceLabels.map((stance) => [stance, subset.filter((run) =>
        !run.sourceAgentIds.includes(run.firstSpeaker.agentId) && run.firstSpeaker.stance === stance,
      ).length])),
      source: Object.fromEntries(stanceLabels.map((stance) => [stance, subset.filter((run) =>
        run.sourceAgentIds.includes(run.firstSpeaker.agentId) && run.firstSpeaker.stance === stance,
      ).length])),
    },
    neutralFirstSpeakerOrders: subset.filter((run) => !run.sourceAgentIds.includes(run.firstSpeaker.agentId)).length,
    sourceFirstSpeakerOrders: subset.filter((run) => run.sourceAgentIds.includes(run.firstSpeaker.agentId)).length,
    ordersWithAnyNeutralEndorsement: subset.filter((run) => run.neutralFinal.endorse > 0).length,
    ordersWithAnyNeutralRejection: subset.filter((run) => run.neutralFinal.reject > 0).length,
  };
  if (subset.length === 24) {
    const expectedJudgments = arm.startsWith("causal_explanation__") ? 240 : 288;
    const observedJudgments = stanceLabels.reduce((sum, stance) => sum + byArm[arm].finalNeutralJudgments[stance], 0);
    if (observedJudgments !== expectedJudgments) fail(`${arm}: ${observedJudgments} final neutral judgments, expected ${expectedJudgments}.`);
  }
}

function subtractCounts(left, right) {
  return Object.fromEntries(stanceLabels.map((stance) => [stance, left[stance] - right[stance]]));
}

function addCounts(total, next) {
  for (const stance of stanceLabels) total[stance] += next[stance];
  return total;
}

const pairedProtocolContrasts = [];
const pairedPromptContrasts = [];
const pairedInteractions = [];
const pairedSourceContrasts = [];
const pairedSourceAdjustedProtocolContrasts = [];
const pairedThreeWayInteractions = [];
for (const sourceCondition of expectedSources) {
  for (let order = 1; order <= 24; order += 1) {
    const runsFor = (protocolFlow, promptFrame) => runAudits.find((run) =>
      run.sourceCondition === sourceCondition && run.order === order &&
      run.protocolFlow === protocolFlow && run.promptFrame === promptFrame);
    for (const promptFrame of expectedPromptFrames) {
      const memory = runsFor("shared_memory", promptFrame);
      const debate = runsFor("live_debate", promptFrame);
      if (memory && debate) pairedProtocolContrasts.push({
        sourceCondition,
        order,
        promptFrame,
        sharedMemory: memory.neutralFinal,
        liveDebate: debate.neutralFinal,
        differenceSharedMinusDebate: subtractCounts(memory.neutralFinal, debate.neutralFinal),
      });
    }
    for (const protocolFlow of expectedProtocols) {
      const memoryFrame = runsFor(protocolFlow, "memory_assessment");
      const discussionFrame = runsFor(protocolFlow, "live_discussion");
      if (memoryFrame && discussionFrame) pairedPromptContrasts.push({
        sourceCondition,
        order,
        protocolFlow,
        memoryAssessment: memoryFrame.neutralFinal,
        liveDiscussion: discussionFrame.neutralFinal,
        differenceAssessmentMinusDiscussion: subtractCounts(memoryFrame.neutralFinal, discussionFrame.neutralFinal),
      });
    }
    const sharedAssessment = runsFor("shared_memory", "memory_assessment");
    const debateAssessment = runsFor("live_debate", "memory_assessment");
    const sharedDiscussion = runsFor("shared_memory", "live_discussion");
    const debateDiscussion = runsFor("live_debate", "live_discussion");
    if (sharedAssessment && debateAssessment && sharedDiscussion && debateDiscussion) {
      const assessmentProtocolGap = subtractCounts(sharedAssessment.neutralFinal, debateAssessment.neutralFinal);
      const discussionProtocolGap = subtractCounts(sharedDiscussion.neutralFinal, debateDiscussion.neutralFinal);
      pairedInteractions.push({
        sourceCondition,
        order,
        assessmentProtocolGap,
        discussionProtocolGap,
        differenceInDifferences: subtractCounts(assessmentProtocolGap, discussionProtocolGap),
      });
    }
  }
}

function countsForAgentIds(run, agentIds) {
  const rows = agentIds
    .map((agentId) => run.finalByAgent[agentId])
    .filter(Boolean);
  return Object.fromEntries(stanceLabels.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}

// Source effects use the same ten identities in both source conditions. The
// two identities assigned as sources in the causal arm are removed from its
// matched no-source arm before any subtraction.
for (let order = 1; order <= 24; order += 1) {
  const runsFor = (sourceCondition, protocolFlow, promptFrame) => runAudits.find((run) =>
    run.sourceCondition === sourceCondition && run.order === order &&
    run.protocolFlow === protocolFlow && run.promptFrame === promptFrame);
  const sourceEffects = new Map();
  for (const protocolFlow of expectedProtocols) {
    for (const promptFrame of expectedPromptFrames) {
      const causal = runsFor("causal_explanation", protocolFlow, promptFrame);
      const noSource = runsFor("no_repeating_agents", protocolFlow, promptFrame);
      if (!causal || !noSource) continue;
      const matchedNeutralIds = Object.keys(causal.finalByAgent)
        .filter((agentId) => !causal.sourceAgentIds.includes(agentId))
        .sort();
      if (matchedNeutralIds.length !== 10) fail(`${protocolFlow}/${promptFrame}/order${order}: expected ten matched neutral identities.`);
      const causalMatched = countsForAgentIds(causal, matchedNeutralIds);
      const noSourceMatched = countsForAgentIds(noSource, matchedNeutralIds);
      const causalCount = stanceLabels.reduce((sum, stance) => sum + causalMatched[stance], 0);
      const noSourceCount = stanceLabels.reduce((sum, stance) => sum + noSourceMatched[stance], 0);
      if (causalCount !== 10 || noSourceCount !== 10) {
        fail(`${protocolFlow}/${promptFrame}/order${order}: identity-matched source contrast has ${causalCount} causal and ${noSourceCount} no-source judgments, expected ten each.`);
      }
      const sourceEffect = subtractCounts(causalMatched, noSourceMatched);
      sourceEffects.set(`${protocolFlow}|${promptFrame}`, sourceEffect);
      pairedSourceContrasts.push({
        order,
        protocolFlow,
        promptFrame,
        matchedNeutralIds,
        causal: causalMatched,
        noRepeatingAgents: noSourceMatched,
        differenceCausalMinusNoRepeating: sourceEffect,
      });
    }
  }
  for (const promptFrame of expectedPromptFrames) {
    const shared = sourceEffects.get(`shared_memory|${promptFrame}`);
    const debate = sourceEffects.get(`live_debate|${promptFrame}`);
    if (!shared || !debate) continue;
    pairedSourceAdjustedProtocolContrasts.push({
      order,
      promptFrame,
      sharedMemorySourceEffect: shared,
      liveDebateSourceEffect: debate,
      differenceSharedMinusDebate: subtractCounts(shared, debate),
    });
  }
  const assessment = pairedSourceAdjustedProtocolContrasts.find((row) =>
    row.order === order && row.promptFrame === "memory_assessment");
  const discussion = pairedSourceAdjustedProtocolContrasts.find((row) =>
    row.order === order && row.promptFrame === "live_discussion");
  if (assessment && discussion) {
    pairedThreeWayInteractions.push({
      order,
      memoryAssessmentSourceAdjustedProtocolGap: assessment.differenceSharedMinusDebate,
      liveDiscussionSourceAdjustedProtocolGap: discussion.differenceSharedMinusDebate,
      protocolByPromptBySource: subtractCounts(
        assessment.differenceSharedMinusDebate,
        discussion.differenceSharedMinusDebate,
      ),
    });
  }
}

function aggregateContrasts(rows, key) {
  return rows.reduce((total, row) => addCounts(total, row[key]), { endorse: 0, reject: 0, uncertain: 0 });
}

const contrastSummary = {
  protocol: Object.fromEntries(expectedSources.flatMap((sourceCondition) => expectedPromptFrames.map((promptFrame) => {
    const rows = pairedProtocolContrasts.filter((row) => row.sourceCondition === sourceCondition && row.promptFrame === promptFrame);
    return [`${sourceCondition}__${promptFrame}`, { pairedOrders: rows.length, aggregateSharedMinusDebate: aggregateContrasts(rows, "differenceSharedMinusDebate") }];
  }))),
  prompt: Object.fromEntries(expectedSources.flatMap((sourceCondition) => expectedProtocols.map((protocolFlow) => {
    const rows = pairedPromptContrasts.filter((row) => row.sourceCondition === sourceCondition && row.protocolFlow === protocolFlow);
    return [`${sourceCondition}__${protocolFlow}`, { pairedOrders: rows.length, aggregateAssessmentMinusDiscussion: aggregateContrasts(rows, "differenceAssessmentMinusDiscussion") }];
  }))),
  interaction: Object.fromEntries(expectedSources.map((sourceCondition) => {
    const rows = pairedInteractions.filter((row) => row.sourceCondition === sourceCondition);
    return [sourceCondition, { pairedOrders: rows.length, aggregateDifferenceInDifferences: aggregateContrasts(rows, "differenceInDifferences") }];
  })),
  source: Object.fromEntries(expectedProtocols.flatMap((protocolFlow) => expectedPromptFrames.map((promptFrame) => {
    const rows = pairedSourceContrasts.filter((row) => row.protocolFlow === protocolFlow && row.promptFrame === promptFrame);
    return [`${protocolFlow}__${promptFrame}`, {
      pairedOrders: rows.length,
      matchedNeutralJudgmentsPerCondition: rows.length * 10,
      aggregateCausalMinusNoRepeating: aggregateContrasts(rows, "differenceCausalMinusNoRepeating"),
    }];
  }))),
  sourceAdjustedProtocol: Object.fromEntries(expectedPromptFrames.map((promptFrame) => {
    const rows = pairedSourceAdjustedProtocolContrasts.filter((row) => row.promptFrame === promptFrame);
    return [promptFrame, {
      pairedOrders: rows.length,
      aggregateDifferenceSharedMinusDebate: aggregateContrasts(rows, "differenceSharedMinusDebate"),
    }];
  })),
  threeWay: {
    pairedOrders: pairedThreeWayInteractions.length,
    aggregateProtocolByPromptBySource: aggregateContrasts(pairedThreeWayInteractions, "protocolByPromptBySource"),
  },
};

const executionTimes = completed.flatMap(({ summaryPath }) => {
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  return query(summary.dbPath, "SELECT created_at AS createdAt FROM runs LIMIT 1;").map((row) => row.createdAt).filter(Boolean);
}).sort();

if (completed.length === manifest.plannedRuns) {
  if (promptPairs.length !== 96) fail(`Expected 96 first-turn request-contract pairs, found ${promptPairs.length}.`);
  if (debateVisibilityPairs.length !== 48) fail(`Expected 48 debate visibility pairs, found ${debateVisibilityPairs.length}.`);
  if (pairedProtocolContrasts.length !== 96) fail(`Expected 96 paired protocol contrasts, found ${pairedProtocolContrasts.length}.`);
  if (pairedPromptContrasts.length !== 96) fail(`Expected 96 paired prompt contrasts, found ${pairedPromptContrasts.length}.`);
  if (pairedInteractions.length !== 48) fail(`Expected 48 paired 2 x 2 interactions, found ${pairedInteractions.length}.`);
  if (pairedSourceContrasts.length !== 96) fail(`Expected 96 identity-matched source contrasts, found ${pairedSourceContrasts.length}.`);
  if (pairedSourceAdjustedProtocolContrasts.length !== 48) fail(`Expected 48 source-adjusted protocol contrasts, found ${pairedSourceAdjustedProtocolContrasts.length}.`);
  if (pairedThreeWayInteractions.length !== 24) fail(`Expected 24 paired protocol x prompt x source interactions, found ${pairedThreeWayInteractions.length}.`);
}

const report = {
  generatedAt: new Date().toISOString(),
  status: completed.length === 0 ? "planned" : completed.length === manifest.plannedRuns ? "complete" : "partial",
  manifestPath,
  preflight,
  executionWindow: executionTimes.length > 0 ? { firstRunCreatedAt: executionTimes[0], lastRunCreatedAt: executionTimes.at(-1) } : null,
  checks: {
    valid: failures.length === 0,
    planComplete: preflight.plannedRuns === 192 && preflight.plannedModelCalls === 6912,
    eachArmHas24PlannedCells: preflight.eachArmHas24PlannedCells,
    outputComplete: completed.length === manifest.plannedRuns,
    eachArmHas24CompletedRuns: completed.length === 0
      ? null
      : manifest.arms.every((arm) => runAudits.filter((run) => run.arm === arm).length === 24),
    everyCompletedRunHas36Calls: runAudits.every((run) => run.calls === 36),
    everyCompletedRunBelowOutputCap: runAudits.every((run) => Number(run.completionTokens.atCap) === 0),
    everyCompletedRunUsesPinnedModel: runAudits.every((run) => run.models.length === 1 && run.models[0] === expectedModel),
    uniqueCompletedRunIds: new Set(runAudits.map((run) => run.runId)).size === runAudits.length,
    everyFixedMessageExact: runAudits.every((run) => run.fixedMessagesExact),
    everyCompletedRunHas36PromptAudits: runAudits.every((run) => run.promptRecords === 36),
    allAvailableFirstTurnRequestContractsMatch: promptPairs.every((pair) => pair.exactFirstTurnMatch),
    debateVisibilityUnaffectedByPromptFrame: debateVisibilityPairs.every((pair) => pair.sameVisibility),
  },
  byArm,
  promptPairs,
  debateVisibilityPairs,
  contrastSummary,
  pairedProtocolContrasts,
  pairedPromptContrasts,
  pairedInteractions,
  pairedSourceContrasts,
  pairedSourceAdjustedProtocolContrasts,
  pairedThreeWayInteractions,
  failures,
  warnings,
  runs: runAudits,
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  status: report.status,
  checks: report.checks,
  failures: report.failures,
  warnings: report.warnings,
  byArm: report.byArm,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
