import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const inputPath = path.resolve(process.argv[2] ?? path.join(
  "experiments",
  "debate_visibility_ablation_ego_haiku_v1",
  "study-manifest.json",
));

const expectedConditions = [
  "content_mechanism_live_debate",
  "causal_live_debate_hide_uncertain",
  "causal_live_debate_last6",
  "causal_live_debate_hide_uncertain_last6",
  "content_mechanism_shared_memory",
];
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const stances = ["endorse", "reject", "uncertain"];
const fixedText = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const orderIdBySequence = new Map(Array.from({ length: 24 }, (_, index) => {
  const orderId = `content_order_${String(index + 1).padStart(2, "0")}`;
  const rosterPath = path.resolve("rosters", "content-factorial-v1", `${orderId}.json`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  return [roster.agents.map((agent) => agent.id).join(">"), orderId];
}));

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    rows.filter((row) => row.stance === stance).length,
  ]));
}

function visibilitySettings(conditionId) {
  return {
    hideUncertain: conditionId.includes("hide_uncertain"),
    limit: conditionId.includes("last6") ? 6 : null,
  };
}

function theoreticalVisibility(messages, conditionId) {
  if (conditionId === "content_mechanism_shared_memory") return null;
  const { hideUncertain, limit } = visibilitySettings(conditionId);
  let totalVisible = 0;
  let totalUncertainHidden = 0;
  let totalOlderHidden = 0;
  let cappedCalls = 0;
  const perCall = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const priorOther = messages.slice(0, index).filter((item) => item.agentId !== message.agentId);
    const uncertaintyFiltered = hideUncertain
      ? priorOther.filter((item) => item.stance !== "uncertain")
      : priorOther;
    const visible = limit === null ? uncertaintyFiltered : uncertaintyFiltered.slice(-limit);
    const uncertainHidden = priorOther.length - uncertaintyFiltered.length;
    const olderHidden = uncertaintyFiltered.length - visible.length;
    totalVisible += visible.length;
    totalUncertainHidden += uncertainHidden;
    totalOlderHidden += olderHidden;
    if (olderHidden > 0) cappedCalls += 1;
    perCall.push({
      round: message.round,
      agentId: message.agentId,
      priorOther: priorOther.length,
      visible: visible.length,
      uncertainHidden,
      olderHidden,
    });
  }
  return { totalVisible, totalUncertainHidden, totalOlderHidden, cappedCalls, perCall };
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const conditionConfigById = new Map(
  [...new Set((input.cells ?? []).map((cell) => cell.conditionPath).filter(Boolean))]
    .map((conditionPath) => {
      const condition = JSON.parse(fs.readFileSync(conditionPath, "utf8"));
      return [condition.id, condition];
    }),
);
const grid = input.cells?.every((cell) => cell.summary)
  ? input
  : {
      grid: { id: input.id },
      cells: input.cells.map((cell) => {
        const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
        const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
        const roster = JSON.parse(fs.readFileSync(cell.rosterPath, "utf8"));
        const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
        const summaryPath = path.join(runConfig.outputDir, runId, "summary.json");
        if (!fs.existsSync(summaryPath)) throw new Error(`Missing summary: ${summaryPath}`);
        return {
          conditionId: condition.id,
          rosterId: roster.id,
          agents: roster.agents,
          seed: runConfig.seed,
          summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")),
        };
      }),
    };
if (grid.grid.id !== "debate_visibility_ablation_ego_haiku_v1") {
  throw new Error(`Unexpected grid id: ${grid.grid.id}`);
}

const runs = grid.cells.map((cell) => {
  const dbPath = cell.summary.dbPath;
  const calls = query(dbPath, "SELECT agent_id AS agentId, COUNT(*) AS calls FROM model_calls GROUP BY agent_id ORDER BY agent_id;");
  const models = query(dbPath, "SELECT DISTINCT model_name AS model FROM model_calls ORDER BY model_name;")
    .map((row) => row.model);
  const firstCycle = query(dbPath, `
    SELECT agent_id AS agentId
    FROM model_calls
    ORDER BY model_call_id
    LIMIT 12;
  `);
  const executedOrderKey = firstCycle.map((row) => row.agentId).join(">");
  const executedOrderId = orderIdBySequence.get(executedOrderKey);
  const finals = query(dbPath, `
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
  const chatMessages = query(dbPath, `
    SELECT message_id AS messageId, round, agent_id AS agentId, stance, confidence,
           message_text AS text
    FROM chat_messages
    WHERE claim_id = 'claim_ego_depletion'
    ORDER BY message_id;
  `);
  const memoryEntries = query(dbPath, `
    SELECT step_index AS step, agent_id AS agentId, stance, confidence,
           entry_text AS text
    FROM memory_entries
    WHERE claim_id = 'claim_ego_depletion'
    ORDER BY step_index, memory_entry_id;
  `);
  const sources = finals.filter((row) => sourceIds.has(row.agentId));
  const neutral = finals.filter((row) => !sourceIds.has(row.agentId));
  const publicEntries = cell.conditionId === "content_mechanism_shared_memory"
    ? memoryEntries.filter((row) => sourceIds.has(row.agentId))
    : chatMessages.filter((row) => sourceIds.has(row.agentId));
  const fixedTextExact = cell.conditionId === "content_mechanism_shared_memory"
    ? publicEntries.every((row) => row.text.endsWith(fixedText))
    : publicEntries.every((row) => row.text === fixedText);
  return {
    runId: cell.summary.runId,
    conditionId: cell.conditionId,
    configuredRosterId: cell.rosterId,
    executedOrderId,
    executedOrderKey,
    seed: cell.seed,
    models,
    rosterRolesValid: !cell.agents || (
      cell.agents.length === 12
      && cell.agents.filter((agent) => agent.role === "contamination_agent")
        .map((agent) => agent.id).sort().join(",") === "analyst_1,analyst_7"
      && cell.agents.filter((agent) => agent.role === "neutral_agent").length === 10
    ),
    calls: calls.reduce((sum, row) => sum + row.calls, 0),
    perAgentCalls: calls,
    chatMessages: chatMessages.length,
    memoryEntries: memoryEntries.length,
    neutralFinal: countStances(neutral),
    sourceFinal: countStances(sources),
    sourcePublicEntries: publicEntries.length,
    sourceMessageFixed: fixedTextExact,
    sourceStanceFixed: publicEntries.every((row) => row.stance === "endorse" && row.confidence >= 0.9),
    theoreticalVisibility: theoreticalVisibility(chatMessages, cell.conditionId),
    dbPath,
  };
});

const byCondition = Object.fromEntries(expectedConditions.map((conditionId) => {
  const subset = runs.filter((run) => run.conditionId === conditionId);
  const totals = Object.fromEntries(stances.map((stance) => [
    stance,
    subset.reduce((sum, run) => sum + run.neutralFinal[stance], 0),
  ]));
  const exposure = subset[0]?.theoreticalVisibility === null ? null : {
    totalVisibleAcrossRuns: subset.reduce((sum, run) => sum + run.theoreticalVisibility.totalVisible, 0),
    totalUncertainHiddenAcrossRuns: subset.reduce((sum, run) => sum + run.theoreticalVisibility.totalUncertainHidden, 0),
    totalOlderHiddenAcrossRuns: subset.reduce((sum, run) => sum + run.theoreticalVisibility.totalOlderHidden, 0),
    callsWhereWindowBinds: subset.reduce((sum, run) => sum + run.theoreticalVisibility.cappedCalls, 0),
  };
  return [conditionId, {
    runs: subset.length,
    neutralFinal: totals,
    neutralTotal: Object.values(totals).reduce((sum, value) => sum + value, 0),
    runsWithAnyNeutralEndorsement: subset.filter((run) => run.neutralFinal.endorse > 0).length,
    runsWithAnyNeutralRejection: subset.filter((run) => run.neutralFinal.reject > 0).length,
    runsWithAllNeutralEndorsement: subset.filter((run) => run.neutralFinal.endorse === 10).length,
    neutralEndorsementsByOrder: subset
      .map((run) => ({
        executedOrderId: run.executedOrderId,
        configuredRosterId: run.configuredRosterId,
        endorsements: run.neutralFinal.endorse,
      }))
      .sort((left, right) => left.executedOrderId.localeCompare(right.executedOrderId)),
    exposure,
  }];
}));

const report = {
  generatedAt: new Date().toISOString(),
  inputPath,
  design: {
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
    agentsPerRun: 12,
    fixedSourcesPerRun: 2,
    neutralAgentsPerRun: 10,
    speakingOrders: 24,
    conditions: expectedConditions,
    fixedSourceText: fixedText,
  },
  checks: {
    expectedRuns: 120,
    observedRuns: runs.length,
    uniqueRunIds: new Set(runs.map((run) => run.runId)).size,
    conditionFilesMatchDesign: expectedConditions.every((conditionId) => {
      const condition = conditionConfigById.get(conditionId);
      if (!condition) return true;
      const expected = {
        content_mechanism_live_debate: ["chat", false, null],
        causal_live_debate_hide_uncertain: ["chat", true, null],
        causal_live_debate_last6: ["chat", false, 6],
        causal_live_debate_hide_uncertain_last6: ["chat", true, 6],
        content_mechanism_shared_memory: ["memory", false, null],
      }[conditionId];
      const observed = [
        condition.interaction.mode,
        condition.interaction.hideUncertainMessages ?? false,
        condition.interaction.maxVisibleMessages ?? null,
      ];
      return JSON.stringify(observed) === JSON.stringify(expected)
        && condition.interaction.fixedSourceMessage === fixedText
        && condition.interaction.chatRounds === 3
        && condition.interaction.adversaryCommitment === "enforced";
    }),
    everyRunUsesExpectedModel: runs.every((run) =>
      JSON.stringify(run.models) === JSON.stringify(["claude-haiku-4-5-20251001"])),
    everyRosterHasExpectedRoles: runs.every((run) => run.rosterRolesValid),
    eachConditionHas24Runs: expectedConditions.every((conditionId) => byCondition[conditionId].runs === 24),
    everyExecutedSequenceMapsToKnownOrder: runs.every((run) => typeof run.executedOrderId === "string"),
    everyConditionHasSame24ExecutedOrders: expectedConditions.every((conditionId) => {
      const observed = runs.filter((run) => run.conditionId === conditionId)
        .map((run) => run.executedOrderId).sort();
      const expected = Array.from({ length: 24 }, (_, index) =>
        `content_order_${String(index + 1).padStart(2, "0")}`).sort();
      return JSON.stringify(observed) === JSON.stringify(expected);
    }),
    everyRunHas36Calls: runs.every((run) => run.calls === 36),
    everyAgentHas3Calls: runs.every((run) =>
      run.perAgentCalls.length === 12 && run.perAgentCalls.every((row) => row.calls === 3)),
    everyDebateRunStores36Messages: runs.every((run) =>
      run.conditionId === "content_mechanism_shared_memory" || run.chatMessages === 36),
    everyRunHas2FinalSourceEndorsements: runs.every((run) => run.sourceFinal.endorse === 2),
    everyRunHas10NeutralFinals: runs.every((run) =>
      Object.values(run.neutralFinal).reduce((sum, value) => sum + value, 0) === 10),
    everySourceMessageExact: runs.every((run) =>
      run.sourcePublicEntries === 6 && run.sourceMessageFixed && run.sourceStanceFixed),
  },
  byCondition,
  runs,
};

report.eligibleForAnalysis = report.checks.observedRuns === report.checks.expectedRuns
  && Object.entries(report.checks)
    .filter(([key]) => !["expectedRuns", "observedRuns", "uniqueRunIds"].includes(key))
    .every(([, value]) => value === true)
  && report.checks.uniqueRunIds === report.checks.expectedRuns;

const reportPath = path.join(
  path.resolve("output"),
  "debate-visibility-ablation-ego-haiku-v1-audit.json",
);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  checks: report.checks,
  eligibleForAnalysis: report.eligibleForAnalysis,
  byCondition: Object.fromEntries(Object.entries(report.byCondition).map(([conditionId, result]) => [
    conditionId,
    {
      runs: result.runs,
      neutralFinal: result.neutralFinal,
      runsWithAnyNeutralEndorsement: result.runsWithAnyNeutralEndorsement,
      exposure: result.exposure,
    },
  ])),
}, null, 2));
if (!report.eligibleForAnalysis) process.exitCode = 1;
