import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(root, "output");
const prefix = "correct_source_recording_rule_v1_";
const fixedText = "I reject this claim. The evidence does not support a strong, reliable ego-depletion effect.";
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const stances = ["endorse", "reject", "uncertain"];

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}

const summaryPaths = fs.readdirSync(outputRoot)
  .filter((name) => name.startsWith(prefix) && fs.existsSync(path.join(outputRoot, name, "summary.json")))
  .map((name) => path.join(outputRoot, name, "summary.json"));

const runs = summaryPaths.map((summaryPath) => {
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const order = Number(summary.runId.match(/content_order_(\d+)/)?.[1]);
  const calls = query(dbPath, "SELECT agent_id AS agentId, COUNT(*) AS calls FROM model_calls GROUP BY agent_id ORDER BY agent_id;");
  const finals = query(dbPath, `
    SELECT s.agent_id AS agentId, s.stance, s.confidence
    FROM agent_claim_states s
    JOIN (
      SELECT agent_id, MAX(step_index) AS finalStep
      FROM agent_claim_states
      WHERE claim_id = 'claim_ego_depletion'
      GROUP BY agent_id
    ) f ON s.agent_id = f.agent_id AND s.step_index = f.finalStep
    WHERE s.claim_id = 'claim_ego_depletion';
  `);
  const fixedEvents = query(dbPath, "SELECT agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type = 'fixed_source_statement' ORDER BY step_index;");
  const agentSteps = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type = 'agent_step' ORDER BY step_index;");
  const memoryEntries = query(dbPath, "SELECT memory_entry_id AS entryId, step_index AS stepIndex, agent_id AS agentId, stance, entry_text AS text FROM memory_entries ORDER BY step_index;");
  const retrievals = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, retrieved_entry_ids_json AS idsJson FROM retrieval_traces ORDER BY step_index;");
  const sourceEntryIds = new Set(memoryEntries.filter((entry) => sourceIds.has(entry.agentId)).map((entry) => entry.entryId));
  const neutralFinals = finals.filter((row) => !sourceIds.has(row.agentId));
  const sourceFinals = finals.filter((row) => sourceIds.has(row.agentId));
  const fixedChecks = fixedEvents.map((event) => {
    const output = JSON.parse(event.outputJson);
    return sourceIds.has(event.agentId) && output.stance === "reject" && output.confidence === 0.9 && output.text === fixedText;
  });
  const uncertainSteps = agentSteps.filter((event) => JSON.parse(event.outputJson).focusClaimStance === "uncertain");
  const uncertainEntries = memoryEntries.filter((entry) => entry.stance === "uncertain");
  const parserFallbackEntries = memoryEntries.filter((entry) => entry.text.includes("[parse fallback]") || entry.text.includes("[heuristic fallback]")).length;
  const neutralRetrievalsOfSource = retrievals.filter((retrieval) => {
    if (sourceIds.has(retrieval.agentId)) return false;
    const ids = JSON.parse(retrieval.idsJson);
    return ids.some((id) => sourceEntryIds.has(id));
  }).length;
  const savesUncertainty = summary.conditionId === "shared_memory_fixed_correct_sources_save_uncertain";

  return {
    runId: summary.runId,
    conditionId: summary.conditionId,
    order,
    completedSteps: summary.completedSteps,
    totalCalls: calls.reduce((sum, row) => sum + row.calls, 0),
    perAgentCalls: calls,
    neutralFinals: countStances(neutralFinals),
    sourceFinals: countStances(sourceFinals),
    fixedEventCount: fixedEvents.length,
    fixedMessagesExact: fixedEvents.length === 6 && fixedChecks.every(Boolean),
    uncertainStepCount: uncertainSteps.length,
    uncertainEntryCount: uncertainEntries.length,
    uncertaintyRulePassed: savesUncertainty
      ? uncertainEntries.length === uncertainSteps.length
      : uncertainEntries.length === 0,
    neutralRetrievalsOfSource,
    parserFallbackEntries,
    summaryPath,
    dbPath,
  };
}).sort((left, right) => left.conditionId.localeCompare(right.conditionId) || left.order - right.order);

const conditionIds = [
  "shared_memory_fixed_correct_sources",
  "shared_memory_fixed_correct_sources_save_uncertain",
];
const byCondition = Object.fromEntries(conditionIds.map((conditionId) => {
  const subset = runs.filter((run) => run.conditionId === conditionId);
  return [conditionId, {
    runs: subset.length,
    orders: subset.map((run) => run.order),
    neutralFinals: Object.fromEntries(stances.map((stance) => [stance, subset.reduce((sum, run) => sum + run.neutralFinals[stance], 0)])),
    sourceFinals: Object.fromEntries(stances.map((stance) => [stance, subset.reduce((sum, run) => sum + run.sourceFinals[stance], 0)])),
    uncertainSteps: subset.reduce((sum, run) => sum + run.uncertainStepCount, 0),
    uncertainEntries: subset.reduce((sum, run) => sum + run.uncertainEntryCount, 0),
  }];
}));

const expectedOrders = Array.from({ length: 24 }, (_, index) => index + 1);
const checks = {
  runCount: runs.length,
  uniqueRunIds: new Set(runs.map((run) => run.runId)).size,
  eachConditionHasTwentyFourRuns: Object.values(byCondition).every((condition) => condition.runs === 24),
  completeOrderCoverage: Object.values(byCondition).every((condition) => JSON.stringify(condition.orders) === JSON.stringify(expectedOrders)),
  allRunsHaveThirtySixSteps: runs.every((run) => run.completedSteps === 36),
  allRunsHaveThirtySixCalls: runs.every((run) => run.totalCalls === 36),
  allAgentsHaveThreeCalls: runs.every((run) => run.perAgentCalls.length === 12 && run.perAgentCalls.every((row) => row.calls === 3)),
  allFixedMessagesExact: runs.every((run) => run.fixedMessagesExact),
  allSourcesRejectFinally: runs.every((run) => run.sourceFinals.reject === 2),
  noParserFallbacks: runs.every((run) => run.parserFallbackEntries === 0),
  recordingRulesApplied: runs.every((run) => run.uncertaintyRulePassed),
  sourceEntriesRetrievedByNeutralAgents: runs.every((run) => run.neutralRetrievalsOfSource > 0),
  neutralTotalsComplete: Object.values(byCondition).every((condition) => Object.values(condition.neutralFinals).reduce((sum, value) => sum + value, 0) === 240),
};

const report = {
  generatedAt: new Date().toISOString(),
  design: {
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
    agentsPerRun: 12,
    fixedCorrectSourcesPerRun: 2,
    neutralAgentsPerRun: 10,
    orders: 24,
    callsPerRun: 36,
    fixedSourceText: fixedText,
  },
  checks,
  byCondition,
  runs,
};

const reportPath = path.join(import.meta.dirname, "correct-source-recording-rule-v1-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, checks, byCondition }, null, 2));
