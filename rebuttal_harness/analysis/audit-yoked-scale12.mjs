import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputRoot = path.join(root, "output");
const fixedText = "I continue to endorse this claim. I consider the underlying effect real, and the objections raised so far do not overturn it.";
const stances = ["endorse", "reject", "uncertain"];

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [stance, rows.filter((row) => row.stance === stance).length]));
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - index + 1)) / index;
  return result;
}

function twoSidedSignP(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let k = 0; k <= tail; k += 1) probability += choose(n, k) * (0.5 ** n);
  return Math.min(1, 2 * probability);
}

const summaryPaths = fs.existsSync(outputRoot)
  ? fs.readdirSync(outputRoot)
      .filter((name) => (
        name.startsWith("yoked_scale12_fixed_sources_v1_") ||
        name.startsWith("yoked_scale12_fixed_sources_debate_continuation_v1_") ||
        name.startsWith("yoked_scale12_fixed_sources_debate_continuation_v2_")
      ) && fs.existsSync(path.join(outputRoot, name, "summary.json")))
      .map((name) => path.join(outputRoot, name, "summary.json"))
  : [];

const runs = summaryPaths.map((summaryPath) => {
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const rotation = Number(summary.runId.match(/scale12_a2_r(\d+)_haiku/)?.[1]);
  const rosterPath = path.join(root, "rosters", "scale12-dose-a2-v1", `scale12_a2_r${rotation}_haiku.json`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const roleByAgent = new Map(roster.agents.map((agent) => [agent.id, agent.role]));
  const sourceIds = new Set(roster.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));

  const calls = query(summary.dbPath, "SELECT agent_id AS agentId, COUNT(*) AS calls FROM model_calls GROUP BY agent_id ORDER BY agent_id;");
  const finals = query(summary.dbPath, `
    SELECT s.agent_id AS agentId, s.stance, s.confidence
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
  const memoryEntries = query(summary.dbPath, "SELECT agent_id AS agentId, stance, confidence, entry_text AS text FROM memory_entries WHERE claim_id = 'claim_ego_depletion' ORDER BY step_index;");
  const chatMessages = query(summary.dbPath, "SELECT agent_id AS agentId, stance, confidence, message_text AS text FROM chat_messages WHERE claim_id = 'claim_ego_depletion' ORDER BY message_id;");
  const fixedEvents = query(summary.dbPath, "SELECT agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type = 'fixed_source_statement' ORDER BY step_index;");

  const sourceMemoryEntries = memoryEntries.filter((entry) => sourceIds.has(entry.agentId));
  const sourceChatMessages = chatMessages.filter((entry) => sourceIds.has(entry.agentId));
  const sourcePublicEntries = summary.conditionId === "shared_memory_fixed_sources" ? sourceMemoryEntries : sourceChatMessages;
  const neutralFinals = finals.filter((row) => roleByAgent.get(row.agentId) === "neutral_agent");
  const sourceFinals = finals.filter((row) => roleByAgent.get(row.agentId) === "contamination_agent");
  const textMatches = summary.conditionId === "shared_memory_fixed_sources"
    ? sourcePublicEntries.every((entry) => entry.text.endsWith(fixedText))
    : sourcePublicEntries.every((entry) => entry.text === fixedText);

  return {
    runId: summary.runId,
    conditionId: summary.conditionId,
    rotation,
    agentCount: summary.agentCount,
    completedSteps: summary.completedSteps,
    totalCalls: calls.reduce((sum, row) => sum + row.calls, 0),
    perAgentCalls: calls,
    neutralFinals: countStances(neutralFinals),
    sourceFinals: countStances(sourceFinals),
    sourcePublicEntryCount: sourcePublicEntries.length,
    fixedEventCount: fixedEvents.length,
    allSourcePublicEntriesFixed: sourcePublicEntries.length === 6 && textMatches && sourcePublicEntries.every((entry) => entry.stance === "endorse" && entry.confidence >= 0.9),
    summaryPath,
    dbPath: summary.dbPath,
  };
}).sort((left, right) => left.conditionId.localeCompare(right.conditionId) || left.rotation - right.rotation);

const byCondition = {};
for (const conditionId of ["shared_memory_fixed_sources", "live_debate_fixed_sources"]) {
  const subset = runs.filter((run) => run.conditionId === conditionId);
  byCondition[conditionId] = {
    runs: subset.length,
    rotations: subset.map((run) => run.rotation),
    neutralFinals: Object.fromEntries(stances.map((stance) => [stance, subset.reduce((sum, run) => sum + run.neutralFinals[stance], 0)])),
    sourceFinals: Object.fromEntries(stances.map((stance) => [stance, subset.reduce((sum, run) => sum + run.sourceFinals[stance], 0)])),
    runsWithAnyNeutralEndorsement: subset.filter((run) => run.neutralFinals.endorse > 0).length,
    runsWithAllNeutralEndorsement: subset.filter((run) => run.neutralFinals.endorse === 10).length,
    neutralEndorsementsByRotation: subset.map((run) => ({ rotation: run.rotation, endorsements: run.neutralFinals.endorse })),
  };
}

const paired = Array.from({ length: 12 }, (_, index) => index + 1).map((rotation) => {
  const memory = runs.find((run) => run.conditionId === "shared_memory_fixed_sources" && run.rotation === rotation);
  const debate = runs.find((run) => run.conditionId === "live_debate_fixed_sources" && run.rotation === rotation);
  return {
    rotation,
    sharedMemoryEndorsements: memory?.neutralFinals.endorse ?? null,
    liveDebateEndorsements: debate?.neutralFinals.endorse ?? null,
    difference: memory && debate ? memory.neutralFinals.endorse - debate.neutralFinals.endorse : null,
  };
});
const completePairs = paired.filter((row) => row.difference !== null);
const memoryHigher = completePairs.filter((row) => row.difference > 0).length;
const debateHigher = completePairs.filter((row) => row.difference < 0).length;
const ties = completePairs.filter((row) => row.difference === 0).length;

const report = {
  generatedAt: new Date().toISOString(),
  fixedSourceText: fixedText,
  design: {
    agentsPerRun: 12,
    persistentSourcesPerRun: 2,
    neutralAgentsPerRun: 10,
    rotations: 12,
    callsPerAgent: 3,
    callsPerRun: 36,
    temperature: 0,
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
  },
  checks: {
    runCount: runs.length,
    uniqueRunIds: new Set(runs.map((run) => run.runId)).size,
    eachConditionHasTwelveRuns: Object.values(byCondition).every((condition) => condition.runs === 12),
    completeRotationCoverage: Object.values(byCondition).every((condition) => JSON.stringify(condition.rotations) === JSON.stringify(Array.from({ length: 12 }, (_, index) => index + 1))),
    allRunsHaveTwelveAgents: runs.every((run) => run.agentCount === 12),
    allRunsHaveThirtySixCalls: runs.every((run) => run.totalCalls === 36),
    allAgentsHaveThreeCalls: runs.every((run) => run.perAgentCalls.length === 12 && run.perAgentCalls.every((row) => row.calls === 3)),
    allSourceStatementsFixed: runs.every((run) => run.allSourcePublicEntriesFixed),
    allSourcesEndorseFinally: runs.every((run) => run.sourceFinals.endorse === 2),
  },
  byCondition,
  pairedOrderComparison: {
    memoryHigher,
    debateHigher,
    ties,
    twoSidedSignTestP: twoSidedSignP(memoryHigher, debateHigher),
    pairs: paired,
  },
  runs,
};

const reportPath = path.join(root, "analysis", "yoked-scale12-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, checks: report.checks, byCondition: report.byCondition, pairedOrderComparison: report.pairedOrderComparison }, null, 2));
