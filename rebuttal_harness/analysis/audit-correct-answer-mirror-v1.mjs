import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const harnessRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(harnessRoot, "output");
const runPrefix = "yoked_scale12_correct_source_control_v1_";
const fixedSourceText = "I reject this claim. The evidence does not support a strong, reliable ego-depletion effect.";
const expectedConditions = [
  "shared_memory_fixed_correct_sources",
  "live_debate_fixed_correct_sources",
];
const stances = ["endorse", "reject", "uncertain"];

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    rows.filter((row) => row.stance === stance).length,
  ]));
}

function finalStates(dbPath) {
  return query(dbPath, `
    SELECT s.agent_id AS agentId, s.stance, s.confidence, s.step_index AS stepIndex
    FROM agent_claim_states s
    JOIN (
      SELECT agent_id, MAX(step_index) AS finalStep
      FROM agent_claim_states
      WHERE claim_id = 'claim_ego_depletion'
      GROUP BY agent_id
    ) f ON s.agent_id = f.agent_id AND s.step_index = f.finalStep
    WHERE s.claim_id = 'claim_ego_depletion'
    ORDER BY CAST(SUBSTR(s.agent_id, 9) AS INTEGER);
  `);
}

const summaryPaths = fs.readdirSync(outputRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith(runPrefix))
  .map((entry) => path.join(outputRoot, entry.name, "summary.json"))
  .filter((summaryPath) => fs.existsSync(summaryPath));

const runs = summaryPaths.map((summaryPath) => {
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const rotation = Number(summary.runId.match(/scale12_a2_r(\d+)_haiku/)?.[1]);
  const rosterPath = path.join(harnessRoot, "rosters", "scale12-dose-a2-v1", `scale12_a2_r${rotation}_haiku.json`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const roleByAgent = new Map(roster.agents.map((agent) => [agent.id, agent.role]));
  const sourceIds = new Set(roster.agents
    .filter((agent) => agent.role === "contamination_agent")
    .map((agent) => agent.id));

  const calls = query(dbPath, `
    SELECT agent_id AS agentId, COUNT(*) AS calls
    FROM model_calls
    GROUP BY agent_id
    ORDER BY CAST(SUBSTR(agent_id, 9) AS INTEGER);
  `);
  const finals = finalStates(dbPath);
  const sourceFinals = finals.filter((row) => sourceIds.has(row.agentId));
  const neutralFinals = finals.filter((row) => roleByAgent.get(row.agentId) === "neutral_agent");
  const sourceStatesAfterStart = query(dbPath, `
    SELECT step_index AS stepIndex, agent_id AS agentId, stance, confidence
    FROM agent_claim_states
    WHERE claim_id = 'claim_ego_depletion'
      AND step_index > 0
      AND agent_id IN (${[...sourceIds].map((id) => `'${id}'`).join(",")})
    ORDER BY step_index, agent_id;
  `);
  const sourceInitialStates = query(dbPath, `
    SELECT agent_id AS agentId, stance, confidence
    FROM agent_claim_states
    WHERE claim_id = 'claim_ego_depletion'
      AND step_index = 0
      AND agent_id IN (${[...sourceIds].map((id) => `'${id}'`).join(",")})
    ORDER BY agent_id;
  `);
  const fixedEvents = query(dbPath, `
    SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson
    FROM events
    WHERE event_type = 'fixed_source_statement'
    ORDER BY step_index;
  `);
  const memoryEntries = query(dbPath, `
    SELECT step_index AS stepIndex, agent_id AS agentId, stance, confidence, entry_text AS text
    FROM memory_entries
    ORDER BY step_index, memory_entry_id;
  `);
  const chatMessages = query(dbPath, `
    SELECT round, agent_id AS agentId, stance, confidence, message_text AS text
    FROM chat_messages
    ORDER BY round, message_id;
  `);
  const retrievalCount = query(dbPath, "SELECT COUNT(*) AS count FROM retrieval_traces;")[0]?.count ?? 0;
  const agentStepEvents = query(dbPath, "SELECT COUNT(*) AS count, COUNT(DISTINCT step_index) AS distinctSteps, MIN(step_index) AS firstStep, MAX(step_index) AS lastStep FROM events WHERE event_type = 'agent_step';")[0];
  const finalizedRows = query(dbPath, "SELECT COUNT(*) AS count FROM runs WHERE status = 'completed';")[0]?.count ?? 0;
  const sourceMemoryEntries = memoryEntries.filter((entry) => sourceIds.has(entry.agentId));
  const sourceChatMessages = chatMessages.filter((entry) => sourceIds.has(entry.agentId));
  const sourcePublicTurns = summary.conditionId === "shared_memory_fixed_correct_sources"
    ? sourceMemoryEntries
    : sourceChatMessages;
  const fixedEventChecks = fixedEvents.map((event) => {
    const output = JSON.parse(event.outputJson);
    return sourceIds.has(event.agentId)
      && output.stance === "reject"
      && output.confidence === 0.9
      && output.text === fixedSourceText;
  });
  const publicTurnChecks = sourcePublicTurns.map((turn) => sourceIds.has(turn.agentId)
    && turn.stance === "reject"
    && turn.confidence >= 0.9
    && (summary.conditionId === "shared_memory_fixed_correct_sources"
      ? turn.text.endsWith(fixedSourceText)
      : turn.text === fixedSourceText));
  const parserFallbacks = {
    memoryEntries: memoryEntries.filter((entry) => entry.text.includes("[parse fallback]") || entry.text.includes("[heuristic fallback]")).length,
    chatMessages: chatMessages.filter((entry) => entry.text.includes("[parse fallback]") || entry.text.includes("[heuristic fallback]")).length,
    events: query(dbPath, "SELECT COUNT(*) AS count FROM events WHERE output_json LIKE '%[parse fallback]%' OR output_json LIKE '%[heuristic fallback]%';")[0]?.count ?? 0,
  };
  parserFallbacks.total = parserFallbacks.memoryEntries + parserFallbacks.chatMessages + parserFallbacks.events;

  const sharedTraceComplete = summary.conditionId !== "shared_memory_fixed_correct_sources"
    || (agentStepEvents.count === 36
      && agentStepEvents.distinctSteps === 36
      && agentStepEvents.firstStep === 1
      && agentStepEvents.lastStep === 36
      && retrievalCount === 36);
  const debateTraceComplete = summary.conditionId !== "live_debate_fixed_correct_sources"
    || (chatMessages.length === 36
      && roster.agents.every((agent) => chatMessages.filter((message) => message.agentId === agent.id).length === 3)
      && [1, 2, 3].every((round) => chatMessages.filter((message) => message.round === round).length === 12));

  return {
    runId: summary.runId,
    conditionId: summary.conditionId,
    rotation,
    summaryPath,
    dbPath,
    traceDbBytes: fs.statSync(dbPath).size,
    traceDbSha256: sha256(dbPath),
    sourceIds: [...sourceIds].sort(),
    totalCalls: calls.reduce((sum, row) => sum + row.calls, 0),
    perAgentCalls: calls,
    logicalPublicTurns: summary.conditionId === "shared_memory_fixed_correct_sources"
      ? agentStepEvents.count
      : chatMessages.length,
    finalStateCount: finals.length,
    neutralFinals: countStances(neutralFinals),
    sourceFinals: countStances(sourceFinals),
    sourceInitialStates,
    sourceStatesAfterStart,
    sourcePublicTurnCount: sourcePublicTurns.length,
    allSourcePublicTurnsExactRejections: sourcePublicTurns.length === 6 && publicTurnChecks.every(Boolean),
    fixedEventCount: fixedEvents.length,
    fixedEventsExact: summary.conditionId === "shared_memory_fixed_correct_sources"
      ? fixedEvents.length === 6 && fixedEventChecks.every(Boolean)
      : fixedEvents.length === 0,
    parserFallbacks,
    retrievalTraceCount: retrievalCount,
    completedRunRows: finalizedRows,
    traceComplete: sharedTraceComplete && debateTraceComplete && finals.length === 12 && finalizedRows === 1,
  };
}).sort((left, right) => left.conditionId.localeCompare(right.conditionId) || left.rotation - right.rotation);

const byCondition = Object.fromEntries(expectedConditions.map((conditionId) => {
  const subset = runs.filter((run) => run.conditionId === conditionId);
  return [conditionId, {
    runs: subset.length,
    rotations: subset.map((run) => run.rotation),
    modelCalls: subset.reduce((sum, run) => sum + run.totalCalls, 0),
    logicalPublicTurns: subset.reduce((sum, run) => sum + run.logicalPublicTurns, 0),
    neutralFinals: Object.fromEntries(stances.map((stance) => [
      stance,
      subset.reduce((sum, run) => sum + run.neutralFinals[stance], 0),
    ])),
    sourceFinals: Object.fromEntries(stances.map((stance) => [
      stance,
      subset.reduce((sum, run) => sum + run.sourceFinals[stance], 0),
    ])),
    parserFallbacks: subset.reduce((sum, run) => sum + run.parserFallbacks.total, 0),
  }];
}));

const expectedRotations = Array.from({ length: 12 }, (_, index) => index + 1);
const checks = {
  runCount: runs.length,
  uniqueRunIds: new Set(runs.map((run) => run.runId)).size,
  expectedConditionsOnly: runs.every((run) => expectedConditions.includes(run.conditionId)),
  eachConditionHasTwelveRuns: Object.values(byCondition).every((condition) => condition.runs === 12),
  completeUniqueRotationCoverage: Object.values(byCondition).every((condition) => (
    new Set(condition.rotations).size === 12
      && JSON.stringify([...condition.rotations].sort((a, b) => a - b)) === JSON.stringify(expectedRotations)
  )),
  allRunsHaveThirtySixCalls: runs.every((run) => run.totalCalls === 36),
  allAgentsHaveThreeCalls: runs.every((run) => run.perAgentCalls.length === 12 && run.perAgentCalls.every((row) => row.calls === 3)),
  allRunsHaveThirtySixLogicalPublicTurns: runs.every((run) => run.logicalPublicTurns === 36),
  allFinalStatesPresent: runs.every((run) => run.finalStateCount === 12),
  allSourcePublicTurnsExactRejections: runs.every((run) => run.allSourcePublicTurnsExactRejections),
  allSharedMemoryFixedEventsExact: runs.every((run) => run.fixedEventsExact),
  allSourcesRejectAfterFirstPublicTurn: runs.every((run) => run.sourceStatesAfterStart.every((state) => state.stance === "reject")),
  allSourcesRejectFinally: runs.every((run) => run.sourceFinals.reject === 2),
  noParserFallbacks: runs.every((run) => run.parserFallbacks.total === 0),
  allTracesComplete: runs.every((run) => run.traceComplete),
  neutralTotalsComplete: Object.values(byCondition).every((condition) => (
    Object.values(condition.neutralFinals).reduce((sum, count) => sum + count, 0) === 120
  )),
};

const report = {
  generatedAt: new Date().toISOString(),
  auditScope: "Earlier 12-order correct-answer mirror comparing shared memory with live debate",
  design: {
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
    agentsPerRun: 12,
    fixedCorrectSourcesPerRun: 2,
    neutralAgentsPerRun: 10,
    rotationsPerCondition: 12,
    rounds: 3,
    callsPerRun: 36,
    fixedSourceText,
    initializationNote: "The inherited scenario initializes the two source-role states as endorsements at step 0. This initialization is not a public response. The audit requires rejection on every public source turn and in both final source states.",
  },
  checks,
  byCondition,
  runs,
};

const reportPath = path.join(import.meta.dirname, "correct-answer-mirror-v1-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, checks, byCondition }, null, 2));
