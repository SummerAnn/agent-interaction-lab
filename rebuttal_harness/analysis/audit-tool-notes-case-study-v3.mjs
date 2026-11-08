import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

const root = path.resolve(import.meta.dirname, "..");
const version = "tool-notes-case-study-v3";
const manifestPath = path.join(root, "experiments", version, "study-manifest.json");
const reportPath = path.join(import.meta.dirname, `${version}-audit.json`);
const preflightOnly = process.argv.includes("--preflight");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--preflight");

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  process.exit(2);
}
if (!fs.existsSync(manifestPath)) {
  console.error("Missing multitask manifest. Run the generator first.");
  process.exit(2);
}

function readData(relativePath) {
  return yaml.load(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sum(object) {
  return Object.values(object).reduce((total, value) => total + value, 0);
}

function stripConditionLabels(condition) {
  const { id, title, ...rest } = condition;
  return rest;
}

function choose(n, k) {
  const kk = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= kk; index += 1) {
    value = (value * (n - kk + index)) / index;
  }
  return value;
}

function twoSidedSignP(sharedGreater, personalGreater) {
  const n = sharedGreater + personalGreater;
  if (n === 0) return 1;
  const tail = Math.min(sharedGreater, personalGreater);
  let probability = 0;
  for (let index = 0; index <= tail; index += 1) probability += choose(n, index) * (0.5 ** n);
  return Math.min(1, 2 * probability);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const experiment = readData(manifest.experiment);
const tasks = manifest.tasks.map((task) => ({ ...task, scenarioData: readData(task.scenario) }));
const methods = manifest.methods.map((method) => ({ ...method, conditionData: readData(method.condition) }));
const rosters = manifest.orders.map(readData);
const upstreamId = manifest.upstreamAgentId;
const downstreamIds = manifest.downstreamAgentIds;
const sharedMethod = methods.find((method) => method.memoryMode === "shared");
const personalMethod = methods.find((method) => method.memoryMode === "personal");

const expectedTaskIds = ["rollback", "ego_depletion", "scitat_a", "gsm8k_duck_eggs"];
const expectedScenarioIds = new Set(tasks.map((task) => task.scenarioData.id));
const expectedConditionIds = new Set(methods.map((method) => method.conditionData.id));
const expectedRosterIds = new Set(rosters.map((roster) => roster.id));
const selectedOrders = manifest.orderConstruction.selectedOrders;

const computedPositionCounts = Object.fromEntries(
  downstreamIds.map((agentId) => [agentId, Object.fromEntries([1, 2, 3, 4, 5].map((position) => [position, 0]))]),
);
for (const order of selectedOrders) {
  order.downstreamExecutionOrder.forEach((agentId, index) => {
    computedPositionCounts[agentId][index + 1] += 1;
  });
}

const rosterMap = new Map(rosters.map((roster) => [roster.id, roster]));
const rosterEncodingMatches = selectedOrders.every((order) => {
  const roster = rosterMap.get(order.rosterId);
  if (!roster) return false;
  const expectedStored = [order.downstreamExecutionOrder.at(-1), ...order.downstreamExecutionOrder.slice(0, -1)];
  return sameJson(roster.agents.slice(1).map((agent) => agent.id), expectedStored);
});

const sharedWithoutMode = stripConditionLabels({
  ...sharedMethod.conditionData,
  memory: { ...sharedMethod.conditionData.memory, mode: "METHOD" },
});
const personalWithoutMode = stripConditionLabels({
  ...personalMethod.conditionData,
  memory: { ...personalMethod.conditionData.memory, mode: "METHOD" },
});

const staticChecks = {
  preparedNotAuthorized: manifest.status === "prepared_not_authorized"
    && manifest.executionPolicy.includes("Do not launch model calls"),
  pinnedHaikuModel: manifest.model === "claude-haiku-4-5-20251001"
    && rosters.every((roster) => roster.agents.every((agent) => agent.model === manifest.model)),
  exactFourTasks: sameJson(tasks.map((task) => task.id), expectedTaskIds)
    && new Set(tasks.map((task) => task.scenarioData.id)).size === 4,
  exactTwoMethods: methods.length === 2
    && sharedMethod
    && personalMethod
    && sharedMethod.conditionData.memory.mode === "shared"
    && personalMethod.conditionData.memory.mode === "personal",
  memoryModeIsOnlyConditionDifference: sameJson(sharedWithoutMode, personalWithoutMode),
  twelveUniqueOrders: rosters.length === 12
    && selectedOrders.length === 12
    && new Set(rosters.map((roster) => roster.id)).size === 12
    && new Set(selectedOrders.map((order) => order.downstreamExecutionOrder.join("|"))).size === 12,
  positionCountsAreTwoOrThree: Object.values(computedPositionCounts).every((counts) =>
    Object.values(counts).every((count) => count === 2 || count === 3)
    && sum(counts) === 12),
  rosterEncodingProducesDeclaredOrders: rosterEncodingMatches,
  sixNeutralAgentsOnly: rosters.every((roster) =>
    roster.agents.length === 6 && roster.agents.every((agent) => agent.role === "neutral_agent")),
  upstreamStoredFirst: rosters.every((roster) => roster.agents[0]?.id === upstreamId),
  upstreamActsOnce: rosters.every((roster) =>
    roster.agents.find((agent) => agent.id === upstreamId)?.activeUntilStep === 1),
  downstreamCannotWrite: rosters.every((roster) =>
    roster.agents.filter((agent) => downstreamIds.includes(agent.id)).every((agent) => agent.canWriteMemory === false)),
  noForcedStanceOrLiarRole: rosters.every((roster) => roster.agents.every((agent) =>
    agent.role === "neutral_agent" && !agent.seedStatementPolicy)),
  everyTaskHasOneFalseClaim: tasks.every((task) => {
    const scenario = task.scenarioData;
    return scenario.claims.length === 1
      && scenario.focusClaimId === task.claimId
      && scenario.claims[0].id === task.claimId
      && scenario.claims[0].truthLabel === "false";
  }),
  rawToolVisibleOnlyToUpstream: tasks.every((task) => {
    const scenario = task.scenarioData;
    return scenario.evidence.length === 1
      && scenario.evidence[0].id === task.toolEvidenceId
      && sameJson(scenario.evidence[0].visibleToAgentIds, [upstreamId]);
  }),
  noInitialMemoryOrStance: tasks.every((task) =>
    task.scenarioData.initialMemoryEntries.length === 0
    && task.scenarioData.initialBeliefStates.length === 0),
  commonMemoryRules: methods.every((method) =>
    method.conditionData.memory.record === "agent_judgment"
    && method.conditionData.memory.maxRetrievedEntries === 6
    && method.conditionData.memory.writeUncertainAnswers === false
    && method.conditionData.interaction.chatRounds === 3
    && method.conditionData.interaction.adaptiveStopping === false),
  oneShuffledGridContainsAllCells: experiment.scenarios.length === 4
    && experiment.conditions.length === 2
    && experiment.rosterPaths.length === 12
    && experiment.cellOrderSeed === 20261107
    && new Set(experiment.scenarios.map((scenarioPath) => readData(scenarioPath).id)).size === 4,
  exactExperimentMappings: new Set(experiment.scenarios.map((scenarioPath) => readData(scenarioPath).id)).size === expectedScenarioIds.size
    && experiment.scenarios.every((scenarioPath) => expectedScenarioIds.has(readData(scenarioPath).id))
    && experiment.conditions.every((conditionPath) => expectedConditionIds.has(readData(conditionPath).id))
    && experiment.rosterPaths.every((rosterPath) => expectedRosterIds.has(readData(rosterPath).id)),
  seedKeepsUpstreamFirst: sameJson(experiment.seeds, [manifest.seed])
    && manifest.seed === 810
    && manifest.seed % 6 === 0,
  exactTurnAndCallBudget: experiment.maxSteps === 16
    && experiment.budget.maxModelCalls === 16
    && experiment.budget.maxOutputTokensPerCall === 256
    && experiment.budget.temperature === 0,
  exactPlannedTotals: manifest.plannedRuns === 96
    && manifest.callsPerRun === 16
    && manifest.plannedModelCalls === 1536
    && tasks.length * methods.length * rosters.length === 96,
  lockedPreparationLabel: experiment.benchmarkMeta?.locked === true
    && experiment.benchmarkMeta?.notes?.some((note) => note.includes("NOT AUTHORIZED")),
  isolatedOutputPath: experiment.outputDir === `output/${version}`,
  analysisUsesRunLevelPairs: manifest.primaryOutcome.includes("paired difference")
    && manifest.analysisPlan.some((line) => line.includes("do not treat the five downstream judgments")),
};

const staticPassed = Object.values(staticChecks).every(Boolean);
const baseReport = {
  generatedAt: new Date().toISOString(),
  mode: preflightOnly ? "preflight" : "post-run",
  design: {
    studyId: manifest.id,
    status: manifest.status,
    model: manifest.model,
    provider: manifest.provider,
    taskIds: tasks.map((task) => task.id),
    methods: methods.map((method) => method.id),
    ordersPerTaskMethod: rosters.length,
    plannedRuns: manifest.plannedRuns,
    callsPerRun: manifest.callsPerRun,
    plannedModelCalls: manifest.plannedModelCalls,
    primaryOutcome: manifest.primaryOutcome,
  },
  staticChecks,
  downstreamPositionCounts: computedPositionCounts,
};

if (preflightOnly) {
  fs.writeFileSync(reportPath, `${JSON.stringify({ ...baseReport, passed: staticPassed }, null, 2)}\n`);
  console.log(JSON.stringify({
    reportPath,
    passed: staticPassed,
    plannedRuns: manifest.plannedRuns,
    plannedModelCalls: manifest.plannedModelCalls,
    failedChecks: Object.entries(staticChecks).filter(([, passed]) => !passed).map(([name]) => name),
  }, null, 2));
  process.exit(staticPassed ? 0 : 1);
}

const resultPath = path.join(root, experiment.outputDir, `${experiment.id}-grid-results.json`);
if (!fs.existsSync(resultPath)) {
  console.error(JSON.stringify({
    error: "No complete result grid exists. Do not treat this prepared study as executed.",
    expectedResultPath: resultPath,
  }, null, 2));
  process.exit(2);
}

const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const scenarioToTask = new Map(tasks.map((task) => [task.scenarioData.id, task]));
const conditionToMethod = new Map(methods.map((method) => [method.conditionData.id, method]));

const runAudits = result.cells.map((cell) => {
  const task = scenarioToTask.get(cell.scenarioId);
  const method = conditionToMethod.get(cell.conditionId);
  const dbPath = cell.summary.dbPath;
  const traces = query(dbPath, `
    SELECT step_index AS step, agent_id AS agentId,
           retrieved_entry_ids_json AS retrievedIdsJson, context_json AS contextJson
    FROM retrieval_traces ORDER BY step_index;
  `).map((row) => ({
    ...row,
    retrievedIds: JSON.parse(row.retrievedIdsJson || "[]"),
    context: JSON.parse(row.contextJson || "{}"),
  }));
  const memoryEntries = query(dbPath, `
    SELECT memory_entry_id AS entryId, step_index AS step, agent_id AS agentId,
           stance, source_type AS sourceType, entry_text AS text
    FROM memory_entries ORDER BY step_index;
  `);
  const calls = query(dbPath, `
    SELECT agent_id AS agentId, COUNT(*) AS calls,
           SUM(prompt_tokens) AS promptTokens,
           SUM(completion_tokens) AS completionTokens
    FROM model_calls GROUP BY agent_id ORDER BY agent_id;
  `);
  const states = query(dbPath, `
    SELECT step_index AS step, agent_id AS agentId, stance, confidence
    FROM agent_claim_states WHERE step_index > 0 ORDER BY step_index;
  `);
  const upstreamTrace = traces.find((trace) => trace.agentId === upstreamId);
  const downstreamTraces = traces.filter((trace) => downstreamIds.includes(trace.agentId));
  const upstreamStates = states.filter((state) => state.agentId === upstreamId);
  const downstreamStates = states.filter((state) => downstreamIds.includes(state.agentId));
  const upstreamEntries = memoryEntries.filter((entry) => entry.agentId === upstreamId);
  const upstreamEntryIds = new Set(upstreamEntries.map((entry) => entry.entryId));
  const downstreamRetrievingUpstream = downstreamTraces.filter((trace) =>
    trace.retrievedIds.some((entryId) => upstreamEntryIds.has(entryId)),
  );
  const firstDownstreamStates = downstreamIds.map((agentId) =>
    downstreamStates.filter((state) => state.agentId === agentId).sort((left, right) => left.step - right.step)[0],
  );
  const finalDownstreamStates = downstreamIds.map((agentId) =>
    downstreamStates.filter((state) => state.agentId === agentId).sort((left, right) => right.step - left.step)[0],
  );
  const perAgentCalls = Object.fromEntries(calls.map((row) => [row.agentId, row.calls]));

  function stanceCounts(rows) {
    return {
      endorse: rows.filter((row) => row?.stance === "endorse").length,
      uncertain: rows.filter((row) => row?.stance === "uncertain").length,
      reject: rows.filter((row) => row?.stance === "reject").length,
    };
  }

  return {
    taskId: task?.id ?? null,
    methodId: method?.id ?? null,
    memoryMode: method?.memoryMode ?? null,
    rosterId: cell.rosterId,
    runId: cell.summary.runId,
    dbPath,
    completedSteps: cell.summary.completedSteps,
    modelCalls: calls.reduce((total, row) => total + row.calls, 0),
    promptTokens: calls.reduce((total, row) => total + (row.promptTokens ?? 0), 0),
    completionTokens: calls.reduce((total, row) => total + (row.completionTokens ?? 0), 0),
    perAgentCalls,
    firstSpeakerIsUpstream: traces[0]?.agentId === upstreamId && traces[0]?.step === 1,
    upstreamRawEvidenceOnly: sameJson(upstreamTrace?.context.visibleEvidenceIds ?? [], [task?.toolEvidenceId])
      && downstreamTraces.every((trace) => (trace.context.visibleEvidenceIds ?? []).length === 0),
    upstreamCitedTool: (upstreamTrace?.context.citedSourceIds ?? []).includes(task?.toolEvidenceId),
    allAgentsNeutral: traces.every((trace) => trace.context.role === "neutral_agent"),
    noRawEvidenceStored: memoryEntries.every((entry) => entry.sourceType === "agent"),
    downstreamMemoryEntryCount: memoryEntries.filter((entry) => entry.agentId !== upstreamId).length,
    upstreamStance: upstreamStates[0]?.stance ?? null,
    upstreamConfidence: upstreamStates[0]?.confidence ?? null,
    upstreamEntryCount: upstreamEntries.length,
    upstreamEntryText: upstreamEntries[0]?.text ?? null,
    downstreamRetrievingUpstreamCount: downstreamRetrievingUpstream.length,
    sharingRulePassed: method?.memoryMode === "personal"
      ? downstreamRetrievingUpstream.length === 0
      : upstreamEntries.length === 0
        ? downstreamRetrievingUpstream.length === 0
        : downstreamRetrievingUpstream.length === downstreamIds.length * 3,
    parserFallbackCount: memoryEntries.filter((entry) =>
      entry.text.includes("[parse fallback]") || entry.text.includes("[heuristic fallback]"),
    ).length,
    responseParseFailureCount: traces.filter((trace) => trace.context.responseParseValid !== true).length,
    firstDownstreamStances: stanceCounts(firstDownstreamStates),
    finalDownstreamStances: stanceCounts(finalDownstreamStates),
  };
});

const expectedCellKeys = new Set(tasks.flatMap((task) => methods.flatMap((method) =>
  rosters.map((roster) => `${task.id}|${method.id}|${roster.id}`),
)));
const observedCellKeys = new Set(runAudits.map((run) => `${run.taskId}|${run.methodId}|${run.rosterId}`));

const runtimeChecks = {
  ninetySixRuns: runAudits.length === 96,
  uniqueRunIds: new Set(runAudits.map((run) => run.runId)).size === 96,
  allExpectedCellsExactlyOnce: observedCellKeys.size === expectedCellKeys.size
    && [...expectedCellKeys].every((key) => observedCellKeys.has(key)),
  twelveRunsPerTaskMethod: tasks.every((task) => methods.every((method) =>
    runAudits.filter((run) => run.taskId === task.id && run.methodId === method.id).length === 12)),
  sixteenStepsAndCalls: runAudits.every((run) => run.completedSteps === 16 && run.modelCalls === 16),
  oneUpstreamAndThreeCallsPerDownstream: runAudits.every((run) =>
    run.perAgentCalls[upstreamId] === 1
    && downstreamIds.every((agentId) => run.perAgentCalls[agentId] === 3)),
  upstreamIsFirstSpeaker: runAudits.every((run) => run.firstSpeakerIsUpstream),
  upstreamAloneSeesRawTool: runAudits.every((run) => run.upstreamRawEvidenceOnly),
  upstreamCitesPrivateTool: runAudits.every((run) => run.upstreamCitedTool),
  allAgentsRemainNeutral: runAudits.every((run) => run.allAgentsNeutral),
  rawToolNeverStoredDirectly: runAudits.every((run) => run.noRawEvidenceStored),
  downstreamNeverWritesMemory: runAudits.every((run) => run.downstreamMemoryEntryCount === 0),
  upstreamWritesAtMostOneJudgment: runAudits.every((run) => run.upstreamEntryCount === 0 || run.upstreamEntryCount === 1),
  memoryExposureMatchesMethod: runAudits.every((run) => run.sharingRulePassed),
  noParserFallbacks: runAudits.every((run) =>
    run.parserFallbackCount === 0 && run.responseParseFailureCount === 0),
  completeDownstreamOutcomes: runAudits.every((run) =>
    sum(run.firstDownstreamStances) === 5 && sum(run.finalDownstreamStances) === 5),
};

const byTaskMethod = Object.fromEntries(tasks.flatMap((task) => methods.map((method) => {
  const runs = runAudits.filter((run) => run.taskId === task.id && run.methodId === method.id);
  const aggregate = (field) => ({
    endorse: runs.reduce((total, run) => total + run[field].endorse, 0),
    uncertain: runs.reduce((total, run) => total + run[field].uncertain, 0),
    reject: runs.reduce((total, run) => total + run[field].reject, 0),
  });
  return [`${task.id}|${method.id}`, {
    taskId: task.id,
    methodId: method.id,
    runs: runs.length,
    upstreamStances: {
      endorse: runs.filter((run) => run.upstreamStance === "endorse").length,
      uncertain: runs.filter((run) => run.upstreamStance === "uncertain").length,
      reject: runs.filter((run) => run.upstreamStance === "reject").length,
    },
    upstreamSavedJudgments: runs.reduce((total, run) => total + run.upstreamEntryCount, 0),
    firstDownstreamStances: aggregate("firstDownstreamStances"),
    finalDownstreamStances: aggregate("finalDownstreamStances"),
  }];
})));

const pairs = tasks.flatMap((task) => rosters.map((roster) => {
  const shared = runAudits.find((run) =>
    run.taskId === task.id && run.methodId === sharedMethod.id && run.rosterId === roster.id);
  const personal = runAudits.find((run) =>
    run.taskId === task.id && run.methodId === personalMethod.id && run.rosterId === roster.id);
  const sharedEndorse = shared?.finalDownstreamStances.endorse ?? null;
  const personalEndorse = personal?.finalDownstreamStances.endorse ?? null;
  return {
    taskId: task.id,
    rosterId: roster.id,
    sharedEndorse,
    personalEndorse,
    difference: sharedEndorse === null || personalEndorse === null ? null : sharedEndorse - personalEndorse,
    bothUpstreamEndorse: shared?.upstreamStance === "endorse" && personal?.upstreamStance === "endorse",
    upstreamStanceMatch: shared?.upstreamStance === personal?.upstreamStance,
    upstreamEntryTextMatch: shared?.upstreamEntryText === personal?.upstreamEntryText,
  };
}));

function summarizePairs(rows) {
  const complete = rows.filter((pair) => Number.isFinite(pair.difference));
  const sharedGreater = complete.filter((pair) => pair.difference > 0).length;
  const personalGreater = complete.filter((pair) => pair.difference < 0).length;
  const ties = complete.filter((pair) => pair.difference === 0).length;
  return {
    pairs: complete.length,
    sharedGreater,
    personalGreater,
    ties,
    meanDifferenceInEndorsersPerRun: complete.reduce((total, pair) => total + pair.difference, 0) / complete.length,
    exactTwoSidedSignP: twoSidedSignP(sharedGreater, personalGreater),
  };
}

const pairedAnalysis = {
  pooledIntentionToTest: summarizePairs(pairs),
  byTask: Object.fromEntries(tasks.map((task) => [
    task.id,
    summarizePairs(pairs.filter((pair) => pair.taskId === task.id)),
  ])),
  conditionalOnBothUpstreamEndorsing: summarizePairs(pairs.filter((pair) => pair.bothUpstreamEndorse)),
  upstreamPairAgreement: {
    stanceMatches: pairs.filter((pair) => pair.upstreamStanceMatch).length,
    savedTextMatches: pairs.filter((pair) => pair.upstreamEntryTextMatch).length,
    totalPairs: pairs.length,
  },
  pairRows: pairs,
};

const tokenUsage = {
  promptTokens: runAudits.reduce((total, run) => total + run.promptTokens, 0),
  completionTokens: runAudits.reduce((total, run) => total + run.completionTokens, 0),
};
tokenUsage.totalTokens = tokenUsage.promptTokens + tokenUsage.completionTokens;
tokenUsage.listPriceEstimateUsd = tokenUsage.promptTokens / 1_000_000
  + 5 * tokenUsage.completionTokens / 1_000_000;

const runtimePassed = Object.values(runtimeChecks).every(Boolean);
const report = {
  ...baseReport,
  passed: staticPassed && runtimePassed,
  runtimeChecks,
  byTaskMethod,
  pairedAnalysis,
  tokenUsage,
  runAudits,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  passed: report.passed,
  failedStaticChecks: Object.entries(staticChecks).filter(([, passed]) => !passed).map(([name]) => name),
  failedRuntimeChecks: Object.entries(runtimeChecks).filter(([, passed]) => !passed).map(([name]) => name),
  byTaskMethod,
  pairedSummary: {
    pooledIntentionToTest: pairedAnalysis.pooledIntentionToTest,
    byTask: pairedAnalysis.byTask,
    conditionalOnBothUpstreamEndorsing: pairedAnalysis.conditionalOnBothUpstreamEndorsing,
    upstreamPairAgreement: pairedAnalysis.upstreamPairAgreement,
  },
  tokenUsage,
}, null, 2));
process.exit(report.passed ? 0 : 1);
