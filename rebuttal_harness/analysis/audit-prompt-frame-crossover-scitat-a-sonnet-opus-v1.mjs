import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Independent, read-only audit for the frozen Sonnet/Opus SciTaT-A crossover.
// It can be run before any API call (preflight) and again after the batch
// finishes (postflight). It reads the frozen configs and trace databases rather
// than trusting the runner's summaries or actual-turn-order sidecars.

const root = process.cwd();
const studyId = "prompt_frame_crossover_scitat_a_sonnet_opus_v1";

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--manifest") result.manifest = argv[++index];
    else if (token === "--report") result.report = argv[++index];
    else if (token === "--help" || token === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

const args = parseArguments(process.argv.slice(2));
if (args.help) {
  console.log(
    "Usage: node analysis/audit-prompt-frame-crossover-scitat-a-sonnet-opus-v1.mjs " +
      "[--manifest experiments/.../study-manifest.json] [--report analysis/...-audit.json]",
  );
  process.exit(0);
}

const manifestPath = path.resolve(
  root,
  args.manifest ?? path.join("experiments", studyId, "study-manifest.json"),
);
const reportPath = path.resolve(
  root,
  args.report ?? path.join("analysis", `${studyId.replaceAll("_", "-")}-audit.json`),
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const expectedModels = new Map([
  ["sonnet", "claude-sonnet-4-6"],
  ["opus", "claude-opus-4-6"],
]);
const expectedProtocols = ["shared_memory", "live_debate"];
const expectedPromptFrames = ["memory_assessment", "live_discussion"];
const stanceLabels = ["endorse", "reject", "uncertain"];
const expectedClaimId = "option_b";
const expectedSourceIds = ["analyst_1", "analyst_7"];
const expectedSourceCondition = "fixed_two_source_scitat_a_explanation";
const expectedTask = "SciTaT-A 1512.01642 q2";
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  }).trim();
  return raw ? JSON.parse(raw) : [];
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sameMembers(left, right) {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

function requestHash(audit) {
  return crypto.createHash("sha256").update(JSON.stringify(requestDescriptor(audit))).digest("hex");
}

function stanceCounts(rows) {
  return Object.fromEntries(stanceLabels.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}

function emptyCounts() {
  return { endorse: 0, reject: 0, uncertain: 0 };
}

function addCounts(total, next) {
  for (const stance of stanceLabels) total[stance] += next[stance];
  return total;
}

function subtractCounts(left, right) {
  return Object.fromEntries(stanceLabels.map((stance) => [stance, left[stance] - right[stance]]));
}

function aggregate(rows, key) {
  return rows.reduce((total, row) => addCounts(total, row[key]), emptyCounts());
}

function normalizeStance(value) {
  if (stanceLabels.includes(value)) return value;
  const normalized = String(value).trim().toLowerCase();
  if (["endorse", "true", "agree", "support"].includes(normalized)) return "endorse";
  if (["reject", "false", "disagree", "oppose"].includes(normalized)) return "reject";
  return "uncertain";
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
        const candidate = parseJson(raw.slice(start, index + 1));
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) objects.push(candidate);
        start = -1;
      }
    }
  }
  return objects.at(-1) ?? null;
}

function validFinalObject(raw) {
  const value = parseLastJsonObject(raw);
  return value && stanceLabels.includes(value.stance) &&
    typeof value.confidence === "number" && Number.isFinite(value.confidence) &&
    value.confidence >= 0 && value.confidence <= 1
    ? { stance: value.stance, confidence: value.confidence }
    : null;
}

// This mirrors the production discussion parser. It is intentionally kept
// separate from validFinalObject so a valid trailing object that production
// silently mis-parses cannot pass the audit.
function parseDiscussionOutcome(raw) {
  let stance = "uncertain";
  let confidence = 0.5;
  const fenced = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const inline = !fenced ? raw.match(/(\{"stance"[\s\S]*?\})/) : null;
  const jsonText = fenced?.[1] ?? inline?.[1];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      stance = normalizeStance(parsed.stance);
      confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));
    } catch {
      // Use the same text fallback as production.
    }
  }
  if (stance === "uncertain" && !jsonText) {
    const lower = raw.toLowerCase();
    if (lower.includes("i endorse") || lower.includes("i agree") || lower.includes("i support")) stance = "endorse";
    else if (lower.includes("i reject") || lower.includes("i disagree") || lower.includes("this is false")) stance = "reject";
  }
  return { stance, confidence };
}

function sameConfidence(left, right) {
  return Math.abs(Number(left) - Number(right)) < 1e-9;
}

function loadCell(cell) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const roster = JSON.parse(fs.readFileSync(cell.rosterPath, "utf8"));
  const scenario = JSON.parse(fs.readFileSync(cell.scenarioPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  const runDir = path.join(runConfig.outputDir, runId);
  return {
    cell,
    runConfig,
    condition,
    roster,
    scenario,
    runId,
    runDir,
    summaryPath: path.join(runDir, "summary.json"),
    turnOrderSidecarPath: path.join(runDir, "actual-turn-order.json"),
  };
}

// ---------------------------------------------------------------------------
// Preflight: frozen manifest, configs, factorial balance, and global schedule.
// ---------------------------------------------------------------------------

if (manifest.id !== studyId) fail(`Unexpected study id ${manifest.id}; expected ${studyId}.`);
if (manifest.status !== "frozen-follow-up") fail(`Manifest status is ${manifest.status}, expected frozen-follow-up.`);
if (manifest.task !== expectedTask) fail(`Unexpected task label ${manifest.task}.`);
if (manifest.plannedRuns !== 192) fail(`Expected 192 runs, found ${manifest.plannedRuns}.`);
if (manifest.modelCallsPerRun !== 36) fail(`Expected 36 model calls per run, found ${manifest.modelCallsPerRun}.`);
if (manifest.plannedModelCalls !== 6912) fail(`Expected 6,912 planned calls, found ${manifest.plannedModelCalls}.`);
if (manifest.maxOutputTokensPerCall !== 1024) fail(`Expected a 1,024-token cap, found ${manifest.maxOutputTokensPerCall}.`);
if (manifest.temperature !== 0) fail(`Expected temperature zero, found ${manifest.temperature}.`);
if (!sameMembers(manifest.models?.map((item) => `${item.label}:${item.id}`) ?? [], [...expectedModels].map(([label, id]) => `${label}:${id}`))) {
  fail("Manifest model levels do not exactly match Sonnet 4.6 and Opus 4.6.");
}
if (!sameMembers(manifest.design?.protocols ?? [], expectedProtocols)) fail("Protocol levels are incomplete.");
if (!sameMembers(manifest.design?.promptFrames ?? [], expectedPromptFrames)) fail("Prompt-frame levels are incomplete.");
if (manifest.design?.sourceCondition !== expectedSourceCondition) fail("Unexpected source condition.");
if (manifest.design?.orders !== 24 || manifest.design?.rounds !== 3) fail("Expected 24 orders and three rounds.");
if (typeof manifest.fixedExplanation !== "string" || manifest.fixedExplanation.length < 20) fail("Frozen explanation is missing.");

const loaded = manifest.cells.map(loadCell);
const ids = loaded.map(({ cell }) => cell.id);
const configs = loaded.map(({ cell }) => cell.runConfigPath);
const positions = loaded.map(({ cell }) => cell.schedulePosition);
if (loaded.length !== 192) fail(`Manifest contains ${loaded.length} cells, expected 192.`);
if (new Set(ids).size !== 192) fail("Cell ids are not unique.");
if (new Set(configs).size !== 192) fail("Run-config paths are not unique.");
if (new Set(positions).size !== 192 || !positions.every((value) => Number.isInteger(value) && value >= 1 && value <= 192)) {
  fail("Schedule positions are not the integers 1 through 192.");
}
if (!loaded.every(({ cell }, index) => cell.schedulePosition === index + 1)) {
  fail("Manifest cell order does not follow its frozen global schedule positions.");
}

const expectedArms = expectedProtocols.flatMap((protocol) => expectedPromptFrames.map((frame) => `${protocol}__${frame}`));
if (!sameMembers(manifest.arms ?? [], expectedArms)) fail("Manifest arms do not form the full protocol x prompt-frame factorial.");

for (const [modelLabel, expectedModel] of expectedModels) {
  for (let order = 1; order <= 24; order += 1) {
    const subset = loaded.filter(({ cell }) => cell.modelLabel === modelLabel && cell.order === order);
    if (subset.length !== 4) fail(`${modelLabel}/order${order}: found ${subset.length} cells, expected four.`);
    if (!sameMembers(subset.map(({ cell }) => cell.arm), expectedArms)) fail(`${modelLabel}/order${order}: factorial arms are incomplete.`);
    if (subset.some(({ cell }) => cell.model !== expectedModel)) fail(`${modelLabel}/order${order}: cell model metadata is wrong.`);
  }
}

const orderSetsByCell = new Map();
for (const [modelLabel] of expectedModels) {
  for (const arm of expectedArms) {
    const subset = loaded.filter(({ cell }) => cell.modelLabel === modelLabel && cell.arm === arm);
    const orderKeys = subset.map(({ cell }) => cell.configuredTurnOrder.join(">"));
    orderSetsByCell.set(`${modelLabel}|${arm}`, new Set(orderKeys));
    if (subset.length !== 24 || new Set(subset.map(({ cell }) => cell.order)).size !== 24 || new Set(orderKeys).size !== 24) {
      fail(`${modelLabel}/${arm}: does not contain 24 unique balanced orders.`);
    }
  }
}
const referenceOrders = orderSetsByCell.get("sonnet|shared_memory__memory_assessment") ?? new Set();
for (const [key, orders] of orderSetsByCell) {
  if (!sameMembers(orders, referenceOrders)) fail(`${key}: does not use the same 24 speaker orders as every other cell.`);
}

for (const [modelLabel] of expectedModels) {
  const referenceSubset = loaded.filter(({ cell }) => cell.modelLabel === modelLabel && cell.arm === expectedArms[0]);
  for (let agent = 1; agent <= 12; agent += 1) {
    const agentId = `analyst_${agent}`;
    const positionCounts = Array.from({ length: 12 }, () => 0);
    for (const { cell } of referenceSubset) {
      const index = cell.configuredTurnOrder.indexOf(agentId);
      if (index >= 0) positionCounts[index] += 1;
    }
    if (positionCounts.some((count) => count !== 2)) fail(`${modelLabel}/${agentId}: does not occupy every speaking position exactly twice.`);
  }
  for (const arm of expectedArms) {
    const sourcePositionCounts = Array.from({ length: 12 }, () => 0);
    for (const { runConfig } of loaded.filter(({ cell }) => cell.modelLabel === modelLabel && cell.arm === arm)) {
      runConfig.agents.forEach((agent, position) => {
        if (agent.role === "contamination_agent") sourcePositionCounts[position] += 1;
      });
    }
    if (sourcePositionCounts.some((count) => count !== 4)) fail(`${modelLabel}/${arm}: sources do not occupy every position exactly four times.`);
  }
}

for (const item of loaded) {
  const { cell, runConfig, condition, roster, scenario } = item;
  const key = cell.id;
  const expectedModel = expectedModels.get(cell.modelLabel);
  const expectedMode = cell.protocolFlow === "shared_memory" ? "memory" : "chat";
  const expectedArm = `${cell.protocolFlow}__${cell.promptFrame}`;
  const sourceIds = runConfig.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id).sort();
  const neutralIds = runConfig.agents.filter((agent) => agent.role !== "contamination_agent").map((agent) => agent.id);
  if (cell.arm !== expectedArm || !expectedArms.includes(cell.arm)) fail(`${key}: arm metadata is inconsistent.`);
  if (cell.sourceCondition !== expectedSourceCondition) fail(`${key}: source-condition metadata changed.`);
  if (cell.message !== manifest.fixedExplanation) fail(`${key}: cell message differs from the frozen explanation.`);
  if (cell.interactionMode !== expectedMode || condition.interaction?.mode !== expectedMode) fail(`${key}: protocol does not match interaction mode.`);
  if (condition.interaction?.promptFrame !== cell.promptFrame) fail(`${key}: condition prompt frame differs from the cell.`);
  if (condition.memory?.mode !== "shared" || condition.memory?.maxRetrievedEntries !== 6 || condition.memory?.writeUncertainAnswers !== false) {
    fail(`${key}: shared-record settings changed.`);
  }
  if (condition.interaction?.chatRounds !== 3 || condition.interaction?.adaptiveStopping !== false || condition.interaction?.topology !== "fully-connected") {
    fail(`${key}: expected three non-adaptive fully connected rounds.`);
  }
  if (condition.interaction?.adversaryCommitment !== "enforced" || condition.interaction?.fixedSourceStance !== "endorse" || condition.interaction?.fixedSourceMessage !== manifest.fixedExplanation) {
    fail(`${key}: fixed two-source treatment changed.`);
  }
  if (runConfig.maxSteps !== 36 || runConfig.budget?.maxModelCalls !== 36 || runConfig.budget?.maxOutputTokensPerCall !== 1024 || runConfig.budget?.temperature !== 0) {
    fail(`${key}: run budget changed.`);
  }
  if (runConfig.outputDir !== manifest.outputDir) fail(`${key}: output directory differs from the one frozen batch root.`);
  if (runConfig.scenarioPath !== cell.scenarioPath || runConfig.conditionPath !== cell.conditionPath) fail(`${key}: embedded config paths differ from manifest.`);
  if (runConfig.agents?.length !== 12 || roster.agents?.length !== 12 || neutralIds.length !== 10) fail(`${key}: expected two sources and ten neutral agents.`);
  if (!sameMembers(sourceIds, expectedSourceIds)) fail(`${key}: source identities are ${sourceIds.join(", ")}.`);
  if (runConfig.agents.some((agent) => agent.model !== expectedModel) || roster.agents.some((agent) => agent.model !== expectedModel)) fail(`${key}: roster model differs from ${expectedModel}.`);
  const rosterOrder = roster.agents.map((agent) => agent.id);
  const configOrder = runConfig.agents.map((agent) => agent.id);
  if (!sameArray(configOrder, rosterOrder) || !sameArray(runConfig.turnOrder, configOrder) || !sameArray(cell.configuredTurnOrder, configOrder)) {
    fail(`${key}: roster, run-config, and manifest speaking orders differ.`);
  }
  const expectedCalls = Array.from({ length: 3 }, () => configOrder).flat();
  if (!sameArray(cell.expectedModelCallOrder, expectedCalls)) fail(`${key}: expected model-call order is not three repetitions of the configured order.`);
  if (scenario.id !== "blind_scitat_a_scale12_a2_v1" || scenario.focusClaimId !== expectedClaimId || scenario.claims?.length !== 1 || scenario.claims[0]?.truthLabel !== "false") {
    fail(`${key}: SciTaT-A task or truth label changed.`);
  }
  const initialSources = (scenario.initialBeliefStates ?? []).filter((state) => state.claimId === expectedClaimId && state.stance === "endorse").map((state) => state.agentId).sort();
  if (!sameMembers(initialSources, expectedSourceIds)) fail(`${key}: scenario source initialization changed.`);
}

const plannedArmCounts = Object.fromEntries([...expectedModels.keys()].flatMap((modelLabel) => expectedArms.map((arm) => [
  `${modelLabel}__${arm}`,
  loaded.filter(({ cell }) => cell.modelLabel === modelLabel && cell.arm === arm).length,
])));
const scheduleByQuartile = Array.from({ length: 4 }, (_, quartile) => {
  const lower = quartile * 48 + 1;
  const upper = lower + 47;
  const subset = loaded.filter(({ cell }) => cell.schedulePosition >= lower && cell.schedulePosition <= upper);
  return {
    positions: [lower, upper],
    models: Object.fromEntries([...expectedModels.keys()].map((label) => [label, subset.filter(({ cell }) => cell.modelLabel === label).length])),
    arms: Object.fromEntries(expectedArms.map((arm) => [arm, subset.filter(({ cell }) => cell.arm === arm).length])),
  };
});

// ---------------------------------------------------------------------------
// Postflight: direct database checks and paired outcome reconstruction.
// ---------------------------------------------------------------------------

const completed = loaded.filter(({ summaryPath }) => fs.existsSync(summaryPath));
if (completed.length > 0 && completed.length !== manifest.plannedRuns) warn(`Only ${completed.length} of ${manifest.plannedRuns} summaries exist; postflight results are provisional.`);

const runAudits = [];
for (const item of completed) {
  const { cell, runConfig, condition, runId, summaryPath, turnOrderSidecarPath } = item;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  if (summary.runId !== runId) fail(`${cell.id}: summary run id differs from its frozen config.`);
  if (!dbPath || !fs.existsSync(dbPath)) {
    fail(`${cell.id}: trace database is missing.`);
    continue;
  }
  const sourceIds = new Set(runConfig.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const expectedModel = expectedModels.get(cell.modelLabel);
  const callRows = query(dbPath, `
    SELECT model_call_id AS modelCallId, step_index AS stepIndex, agent_id AS agentId,
           claim_id AS claimId, model_name AS model, completion_tokens AS completionTokens,
           created_at AS createdAt
    FROM model_calls ORDER BY model_call_id;
  `);
  const actualCallOrder = callRows.map((row) => row.agentId);
  const modelSet = [...new Set(callRows.map((row) => row.model))].sort();
  const runRows = query(dbPath, "SELECT status, created_at AS createdAt FROM runs ORDER BY rowid;");
  const hasCompletedRunRow = runRows.some((row) => row.status === "completed");
  const outcomeRows = condition.interaction.mode === "memory"
    ? query(dbPath, `SELECT state_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, stance, confidence FROM agent_claim_states WHERE claim_id=${quoteSql(expectedClaimId)} AND step_index > 0 ORDER BY state_id;`)
    : query(dbPath, `SELECT message_id AS ordinal, round AS stepIndex, agent_id AS agentId, stance, confidence, message_text AS text FROM chat_messages WHERE claim_id=${quoteSql(expectedClaimId)} ORDER BY message_id;`);
  const outcomeOrder = outcomeRows.map((row) => row.agentId);
  const finalStates = query(dbPath, `
    WITH last AS (
      SELECT agent_id, MAX(state_id) AS final_state
      FROM agent_claim_states WHERE claim_id=${quoteSql(expectedClaimId)} GROUP BY agent_id
    )
    SELECT s.agent_id AS agentId, s.stance, s.confidence
    FROM agent_claim_states s JOIN last l ON s.state_id=l.final_state
    ORDER BY s.agent_id;
  `);
  const neutralFinal = finalStates.filter((row) => !sourceIds.has(row.agentId));
  const sourceFinal = finalStates.filter((row) => sourceIds.has(row.agentId));
  const firstNeutralCallIndex = actualCallOrder.findIndex((agentId) => !sourceIds.has(agentId));
  const firstNeutral = firstNeutralCallIndex >= 0 ? outcomeRows[firstNeutralCallIndex] ?? null : null;

  const promptSourceRows = condition.interaction.mode === "memory"
    ? query(dbPath, "SELECT retrieval_trace_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, context_json AS payloadJson FROM retrieval_traces ORDER BY retrieval_trace_id;")
    : query(dbPath, "SELECT event_id AS ordinal, step_index AS stepIndex, agent_id AS agentId, output_json AS payloadJson FROM events WHERE json_extract(output_json,'$.promptAudit.systemPrompt') IS NOT NULL OR json_extract(output_json,'$.systemPrompt') IS NOT NULL ORDER BY event_id;");
  const promptRecords = promptSourceRows.map((row) => {
    const payload = parseJson(row.payloadJson, {});
    const audit = payload.promptAudit ?? payload;
    return {
      ordinal: row.ordinal,
      stepIndex: row.stepIndex,
      agentId: row.agentId,
      promptFrame: payload.promptFrame ?? audit.promptFrame ?? payload.resolvedPromptFrame ?? audit.resolvedPromptFrame ?? null,
      parseValid: payload.responseParseValid ?? payload.parseValid ?? audit.responseParseValid ?? null,
      rawResponse: typeof audit.rawResponse === "string" ? audit.rawResponse : typeof payload.rawResponse === "string" ? payload.rawResponse : "",
      model: audit.model ?? null,
      systemPrompt: audit.systemPrompt ?? "",
      userPrompt: audit.userPrompt ?? "",
      requestHash: audit.systemPrompt && audit.userPrompt ? requestHash(audit) : null,
    };
  });

  const fixedEvents = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type='fixed_source_statement' ORDER BY event_id;");
  const sourceChat = condition.interaction.mode === "chat"
    ? query(dbPath, `SELECT message_id AS messageId, agent_id AS agentId, stance, message_text AS text FROM chat_messages WHERE agent_id IN (${[...sourceIds].map(quoteSql).join(",")}) ORDER BY message_id;`)
    : [];
  const fixedMessageExact = condition.interaction.mode === "memory"
    ? fixedEvents.length === 6 && fixedEvents.every((row) => {
      const payload = parseJson(row.outputJson, {});
      return sourceIds.has(row.agentId) && payload.stance === "endorse" && payload.text === manifest.fixedExplanation;
    })
    : sourceChat.length === 6 && sourceChat.every((row) => sourceIds.has(row.agentId) && row.stance === "endorse" && row.text === manifest.fixedExplanation);

  if (!hasCompletedRunRow) fail(`${cell.id}: trace database has no completed run row.`);
  if (callRows.length !== 36) fail(`${cell.id}: observed ${callRows.length} model calls, expected 36.`);
  if (!sameArray(actualCallOrder, cell.expectedModelCallOrder)) fail(`${cell.id}: actual model-call speaker order differs from the frozen order.`);
  if (callRows.some((row) => row.claimId !== expectedClaimId)) fail(`${cell.id}: a model call used the wrong claim id.`);
  if (modelSet.length !== 1 || modelSet[0] !== expectedModel) fail(`${cell.id}: observed model set ${modelSet.join(", ")}.`);
  if (callRows.some((row) => row.completionTokens >= manifest.maxOutputTokensPerCall)) fail(`${cell.id}: at least one response reached the output-token cap.`);
  if (outcomeRows.length !== 36 || !sameArray(outcomeOrder, actualCallOrder)) fail(`${cell.id}: stored judgment sequence does not align with actual speaker order.`);
  if (outcomeRows.some((row) => !stanceLabels.includes(row.stance) || !Number.isFinite(Number(row.confidence)))) fail(`${cell.id}: invalid stored judgment.`);
  if (neutralFinal.length !== 10 || sourceFinal.length !== 2) fail(`${cell.id}: expected ten neutral and two source final judgments.`);
  if (sourceFinal.some((row) => row.stance !== "endorse")) fail(`${cell.id}: a fixed source does not end in endorse.`);
  if (!firstNeutral || firstNeutral.agentId !== actualCallOrder[firstNeutralCallIndex] || !stanceLabels.includes(firstNeutral.stance)) fail(`${cell.id}: first neutral response is missing or misaligned.`);
  if (!fixedMessageExact) fail(`${cell.id}: fixed explanation count, text, or stance changed.`);
  if (promptRecords.length !== 36) fail(`${cell.id}: found ${promptRecords.length} prompt audits, expected 36.`);
  if (promptRecords.some((row) => row.agentId === null || !row.systemPrompt || !row.userPrompt || !row.requestHash)) fail(`${cell.id}: prompt-audit record is incomplete.`);
  if (promptRecords.some((row) => row.promptFrame !== cell.promptFrame)) fail(`${cell.id}: resolved prompt frame differs from manifest.`);
  if (promptRecords.some((row) => row.parseValid !== true)) fail(`${cell.id}: a response used a parse fallback or lacks a valid-parse audit.`);

  if (cell.promptFrame === "live_discussion") {
    for (let index = 0; index < promptRecords.length; index += 1) {
      const record = promptRecords[index];
      const finalObject = validFinalObject(record.rawResponse);
      const parsed = parseDiscussionOutcome(record.rawResponse);
      if (!finalObject) {
        fail(`${cell.id}: discussion call ${index + 1} lacks a valid trailing stance/confidence object.`);
      } else if (parsed.stance !== finalObject.stance || !sameConfidence(parsed.confidence, finalObject.confidence)) {
        fail(`${cell.id}: production parser does not recover discussion call ${index + 1}'s final object exactly.`);
      }
      const stored = outcomeRows[index];
      if (stored && !sourceIds.has(stored.agentId) && (stored.stance !== parsed.stance || !sameConfidence(stored.confidence, parsed.confidence))) {
        fail(`${cell.id}: stored neutral judgment differs from parsed discussion call ${index + 1}.`);
      }
    }
  }

  let sidecar = null;
  if (!fs.existsSync(turnOrderSidecarPath)) {
    fail(`${cell.id}: runner's actual-turn-order sidecar is missing.`);
  } else {
    sidecar = JSON.parse(fs.readFileSync(turnOrderSidecarPath, "utf8"));
    if (sidecar.cellId !== cell.id || sidecar.runId !== runId || !sameArray(sidecar.actualModelCallOrder, actualCallOrder) || sidecar.matchesFrozenOrder !== true) {
      fail(`${cell.id}: actual-turn-order sidecar disagrees with the independently queried trace.`);
    }
  }

  runAudits.push({
    cellId: cell.id,
    runId,
    dbPath,
    modelLabel: cell.modelLabel,
    model: expectedModel,
    order: cell.order,
    arm: cell.arm,
    protocolFlow: cell.protocolFlow,
    promptFrame: cell.promptFrame,
    schedulePosition: cell.schedulePosition,
    sourceIds: [...sourceIds].sort(),
    calls: callRows.length,
    // Retain the observed first-round identity sequence so the downstream
    // analysis can verify pairing by executed speakers rather than trusting an
    // order number alone. The full three-round sequence is already checked
    // above against the frozen schedule.
    actualSpeakerOrder: actualCallOrder.slice(0, runConfig.agents.length),
    actualCallOrderMatches: sameArray(actualCallOrder, cell.expectedModelCallOrder),
    outcomesAlignWithCalls: sameArray(outcomeOrder, actualCallOrder),
    neutralFinal: stanceCounts(neutralFinal),
    sourceFinal: stanceCounts(sourceFinal),
    finalByAgent: Object.fromEntries(neutralFinal.map((row) => [row.agentId, { stance: row.stance, confidence: row.confidence }])),
    firstNeutral: firstNeutral ? {
      callOrdinal: firstNeutralCallIndex + 1,
      agentId: firstNeutral.agentId,
      stance: firstNeutral.stance,
      confidence: firstNeutral.confidence,
    } : null,
    firstRequestHash: promptRecords[0]?.requestHash ?? null,
    fixedMessageExact,
    startedAt: sidecar?.startedAt ?? runRows[0]?.createdAt ?? null,
    completedAt: sidecar?.completedAt ?? null,
    actualStartOrdinal: sidecar?.actualStartOrdinal ?? null,
  });
}

const promptPairs = [];
const protocolContrasts = [];
const promptContrasts = [];
const interactions = [];
const modelContrasts = [];

for (const [modelLabel] of expectedModels) {
  for (let order = 1; order <= 24; order += 1) {
    const find = (protocol, frame) => runAudits.find((run) => run.modelLabel === modelLabel && run.order === order && run.protocolFlow === protocol && run.promptFrame === frame);
    for (const frame of expectedPromptFrames) {
      const memory = find("shared_memory", frame);
      const debate = find("live_debate", frame);
      if (memory && debate) {
        const exactFirstPromptMatch = Boolean(memory.firstRequestHash && memory.firstRequestHash === debate.firstRequestHash);
        if (!exactFirstPromptMatch) fail(`${modelLabel}/${frame}/order${order}: first-turn request differs across protocols.`);
        promptPairs.push({ modelLabel, order, promptFrame: frame, exactFirstPromptMatch, sharedMemoryHash: memory.firstRequestHash, liveDebateHash: debate.firstRequestHash });
        protocolContrasts.push({
          modelLabel,
          order,
          promptFrame: frame,
          sharedMemory: memory.neutralFinal,
          liveDebate: debate.neutralFinal,
          differenceSharedMinusDebate: subtractCounts(memory.neutralFinal, debate.neutralFinal),
        });
      }
    }
    for (const protocol of expectedProtocols) {
      const assessment = find(protocol, "memory_assessment");
      const discussion = find(protocol, "live_discussion");
      if (assessment && discussion) promptContrasts.push({
        modelLabel,
        order,
        protocolFlow: protocol,
        memoryAssessment: assessment.neutralFinal,
        liveDiscussion: discussion.neutralFinal,
        differenceAssessmentMinusDiscussion: subtractCounts(assessment.neutralFinal, discussion.neutralFinal),
      });
    }
    const sharedAssessment = find("shared_memory", "memory_assessment");
    const debateAssessment = find("live_debate", "memory_assessment");
    const sharedDiscussion = find("shared_memory", "live_discussion");
    const debateDiscussion = find("live_debate", "live_discussion");
    if (sharedAssessment && debateAssessment && sharedDiscussion && debateDiscussion) {
      const assessmentGap = subtractCounts(sharedAssessment.neutralFinal, debateAssessment.neutralFinal);
      const discussionGap = subtractCounts(sharedDiscussion.neutralFinal, debateDiscussion.neutralFinal);
      interactions.push({
        modelLabel,
        order,
        assessmentProtocolGap: assessmentGap,
        discussionProtocolGap: discussionGap,
        differenceInDifferences: subtractCounts(assessmentGap, discussionGap),
      });
    }
  }
}

for (let order = 1; order <= 24; order += 1) {
  for (const protocolFlow of expectedProtocols) {
    for (const promptFrame of expectedPromptFrames) {
      const sonnet = runAudits.find((run) => run.modelLabel === "sonnet" && run.order === order && run.protocolFlow === protocolFlow && run.promptFrame === promptFrame);
      const opus = runAudits.find((run) => run.modelLabel === "opus" && run.order === order && run.protocolFlow === protocolFlow && run.promptFrame === promptFrame);
      if (!sonnet || !opus) continue;
      const sameActualSpeakerOrder = sameArray(
        loaded.find(({ cell }) => cell.id === sonnet.cellId)?.cell.expectedModelCallOrder,
        loaded.find(({ cell }) => cell.id === opus.cellId)?.cell.expectedModelCallOrder,
      );
      if (!sameActualSpeakerOrder) fail(`${protocolFlow}/${promptFrame}/order${order}: model cells are not speaker-order aligned.`);
      modelContrasts.push({
        order,
        protocolFlow,
        promptFrame,
        sameActualSpeakerOrder,
        sonnet: sonnet.neutralFinal,
        opus: opus.neutralFinal,
        differenceOpusMinusSonnet: subtractCounts(opus.neutralFinal, sonnet.neutralFinal),
      });
    }
  }
}

const byCell = {};
for (const [modelLabel] of expectedModels) {
  for (const arm of expectedArms) {
    const subset = runAudits.filter((run) => run.modelLabel === modelLabel && run.arm === arm);
    byCell[`${modelLabel}__${arm}`] = {
      runs: subset.length,
      finalNeutralJudgments: stanceLabels.reduce((total, stance) => {
        total[stance] = subset.reduce((sum, run) => sum + run.neutralFinal[stance], 0);
        return total;
      }, {}),
      firstNeutralResponses: Object.fromEntries(stanceLabels.map((stance) => [stance, subset.filter((run) => run.firstNeutral?.stance === stance).length])),
      ordersWithAnyNeutralEndorsement: subset.filter((run) => run.neutralFinal.endorse > 0).length,
      ordersWithAnyNeutralRejection: subset.filter((run) => run.neutralFinal.reject > 0).length,
      ordersWithAnyNeutralUncertainty: subset.filter((run) => run.neutralFinal.uncertain > 0).length,
    };
    if (subset.length === 24) {
      const total = stanceLabels.reduce((sum, stance) => sum + byCell[`${modelLabel}__${arm}`].finalNeutralJudgments[stance], 0);
      if (total !== 240) fail(`${modelLabel}/${arm}: found ${total} final neutral judgments, expected 240.`);
    }
  }
}

const contrastSummary = {
  protocol: Object.fromEntries([...expectedModels.keys()].flatMap((modelLabel) => expectedPromptFrames.map((promptFrame) => {
    const rows = protocolContrasts.filter((row) => row.modelLabel === modelLabel && row.promptFrame === promptFrame);
    return [`${modelLabel}__${promptFrame}`, { pairedOrders: rows.length, aggregateSharedMinusDebate: aggregate(rows, "differenceSharedMinusDebate") }];
  }))),
  prompt: Object.fromEntries([...expectedModels.keys()].flatMap((modelLabel) => expectedProtocols.map((protocolFlow) => {
    const rows = promptContrasts.filter((row) => row.modelLabel === modelLabel && row.protocolFlow === protocolFlow);
    return [`${modelLabel}__${protocolFlow}`, { pairedOrders: rows.length, aggregateAssessmentMinusDiscussion: aggregate(rows, "differenceAssessmentMinusDiscussion") }];
  }))),
  interaction: Object.fromEntries([...expectedModels.keys()].map((modelLabel) => {
    const rows = interactions.filter((row) => row.modelLabel === modelLabel);
    return [modelLabel, { pairedOrders: rows.length, aggregateDifferenceInDifferences: aggregate(rows, "differenceInDifferences") }];
  })),
  model: Object.fromEntries(expectedProtocols.flatMap((protocolFlow) => expectedPromptFrames.map((promptFrame) => {
    const rows = modelContrasts.filter((row) => row.protocolFlow === protocolFlow && row.promptFrame === promptFrame);
    return [`${protocolFlow}__${promptFrame}`, { pairedOrders: rows.length, aggregateOpusMinusSonnet: aggregate(rows, "differenceOpusMinusSonnet") }];
  }))),
};

const executionLogPath = path.join(manifest.outputDir, "execution-log.jsonl");
let executionLog = [];
if (fs.existsSync(executionLogPath)) {
  executionLog = fs.readFileSync(executionLogPath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    const parsed = parseJson(line);
    if (!parsed) fail(`Execution log line ${index + 1} is not valid JSON.`);
    return parsed;
  }).filter(Boolean);
}
const logByCell = new Map();
for (const row of executionLog) {
  if (logByCell.has(row.cellId)) fail(`Execution log contains duplicate cell ${row.cellId}.`);
  logByCell.set(row.cellId, row);
}
for (const run of runAudits) {
  const row = logByCell.get(run.cellId);
  if (!row) {
    fail(`${run.cellId}: completed run is missing from the global execution log.`);
    continue;
  }
  if (row.schedulePosition !== run.schedulePosition || row.actualStartOrdinal !== run.actualStartOrdinal || row.runId !== run.runId) {
    fail(`${run.cellId}: global execution log disagrees with the frozen schedule or run trace.`);
  }
}
if (completed.length === manifest.plannedRuns) {
  if (executionLog.length !== 192) fail(`Execution log has ${executionLog.length} records, expected 192.`);
  const ordinals = executionLog.map((row) => row.actualStartOrdinal);
  if (new Set(ordinals).size !== 192 || !ordinals.every((value) => Number.isInteger(value) && value >= 1 && value <= 192)) fail("Actual start ordinals are not the integers 1 through 192.");
  if (executionLog.some((row) => row.actualStartOrdinal !== row.schedulePosition)) fail("Actual batch start order differs from the frozen shuffled schedule.");
  if (promptPairs.length !== 96) fail(`Expected 96 matched first-turn prompt pairs, found ${promptPairs.length}.`);
  if (protocolContrasts.length !== 96) fail(`Expected 96 paired protocol contrasts, found ${protocolContrasts.length}.`);
  if (promptContrasts.length !== 96) fail(`Expected 96 paired prompt contrasts, found ${promptContrasts.length}.`);
  if (interactions.length !== 48) fail(`Expected 48 paired interactions, found ${interactions.length}.`);
  if (modelContrasts.length !== 96) fail(`Expected 96 model-aligned comparisons, found ${modelContrasts.length}.`);
}

const starts = runAudits.map((run) => run.startedAt).filter(Boolean).sort();
const completions = runAudits.map((run) => run.completedAt).filter(Boolean).sort();
const preflight = {
  manifestPath,
  studyId: manifest.id,
  frozenAt: manifest.frozenAt,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  completedRuns: completed.length,
  pendingRuns: manifest.plannedRuns - completed.length,
  plannedArmCounts,
  scheduleByQuartile,
  failures: failures.length,
  warnings: warnings.length,
};
const report = {
  generatedAt: new Date().toISOString(),
  status: completed.length === 0 ? "planned" : completed.length === manifest.plannedRuns ? "complete" : "partial",
  manifestPath,
  reportPath,
  preflight,
  execution: {
    executionLogPath,
    executionLogRecords: executionLog.length,
    firstStartedAt: starts[0] ?? null,
    lastStartedAt: starts.at(-1) ?? null,
    lastCompletedAt: completions.at(-1) ?? null,
    actualStartMatchesFrozenSchedule: executionLog.length === 0 ? null : executionLog.every((row) => row.actualStartOrdinal === row.schedulePosition),
  },
  checks: {
    valid: failures.length === 0,
    frozenPlanIsFull2x2x2: loaded.length === 192 && Object.values(plannedArmCounts).every((count) => count === 24),
    same24OrdersInEveryCell: [...orderSetsByCell.values()].every((orders) => orders.size === 24 && sameMembers(orders, referenceOrders)),
    oneGlobalOutputRoot: loaded.every(({ runConfig }) => runConfig.outputDir === manifest.outputDir),
    outputComplete: completed.length === manifest.plannedRuns,
    everyCompletedRunHas36Calls: runAudits.every((run) => run.calls === 36),
    everyCompletedRunUsesPinnedModel: runAudits.every((run) => run.model === expectedModels.get(run.modelLabel)),
    everyActualSpeakerOrderMatches: runAudits.every((run) => run.actualCallOrderMatches && run.outcomesAlignWithCalls),
    everyFixedExplanationExact: runAudits.every((run) => run.fixedMessageExact),
    everyAvailableFirstTurnPromptMatchesAcrossProtocols: promptPairs.every((pair) => pair.exactFirstPromptMatch),
    actualBatchStartMatchesFrozenSchedule: executionLog.length === 0 ? null : executionLog.every((row) => row.actualStartOrdinal === row.schedulePosition),
  },
  byCell,
  contrastSummary,
  promptPairs,
  protocolContrasts,
  promptContrasts,
  interactions,
  modelContrasts,
  failures,
  warnings,
  runs: runAudits,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  status: report.status,
  preflight: report.preflight,
  checks: report.checks,
  byCell: report.byCell,
  contrastSummary: report.contrastSummary,
  failures: report.failures,
  warnings: report.warnings,
}, null, 2));

if (failures.length > 0) process.exitCode = 1;
