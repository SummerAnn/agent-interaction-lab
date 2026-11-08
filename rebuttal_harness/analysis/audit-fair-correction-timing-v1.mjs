import fs from "node:fs";
import path from "node:path";

import { queryRows } from "../src/db/sqlite.ts";

const root = process.cwd();
const inputPath = path.resolve(process.argv[2] ?? path.join(
  "experiments",
  "fair_correction_timing_haiku_v1",
  "study-manifest.json",
));
const reportPath = path.resolve(process.argv[3] ?? path.join(
  "output",
  "fair-correction-timing-haiku-v1-audit.json",
));

const manifest = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const stances = ["endorse", "reject", "uncertain"];
const expectedModel = "claude-haiku-4-5-20251001";
const expectedMessage = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const expectedCorrection = "A preregistered multi-lab replication and later bias analyses do not support a strong ego depletion effect.";
const expectedOrderIds = Array.from({ length: 24 }, (_, index) =>
  `content_order_${String(index + 1).padStart(2, "0")}`);
const orderIdBySequence = new Map(expectedOrderIds.map((orderId) => {
  const rosterPath = path.join(root, "rosters", "content-factorial-v1", `${orderId}.json`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  return [roster.agents.map((agent) => agent.id).join(">"), orderId];
}));

function assert(value, message) {
  if (!value) throw new Error(message);
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    rows.filter((row) => row.stance === stance).length,
  ]));
}

function addStanceCounts(items, field) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    items.reduce((sum, item) => sum + item[field][stance], 0),
  ]));
}

function latestNeutralStates(dbPath, beforeStep = null) {
  const stepFilter = beforeStep === null ? "" : `AND step_index < ${Number(beforeStep)}`;
  return queryRows(dbPath, `
    WITH ranked AS (
      SELECT agent_id AS agentId, stance, confidence, step_index AS step,
             ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY step_index DESC, state_id DESC) AS rank
      FROM agent_claim_states
      WHERE claim_id = 'claim_ego_depletion'
        AND agent_id NOT IN ('analyst_1', 'analyst_7')
        ${stepFilter}
    )
    SELECT agentId, stance, confidence, step
    FROM ranked
    WHERE rank = 1
    ORDER BY CAST(SUBSTR(agentId, 9) AS INTEGER);
  `);
}

function summaryPathFor(cell) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  return path.join(runConfig.outputDir, runId, "summary.json");
}

function binomialCoefficient(n, k) {
  const reduced = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= reduced; index += 1) {
    value = (value * (n - reduced + index)) / index;
  }
  return value;
}

function twoSidedSignTest(positive, negative) {
  const n = positive + negative;
  if (n === 0) return { nonTies: 0, pValue: 1 };
  const k = Math.min(positive, negative);
  let lowerTail = 0;
  for (let index = 0; index <= k; index += 1) {
    lowerTail += binomialCoefficient(n, index) * (0.5 ** n);
  }
  return { nonTies: n, pValue: Math.min(1, 2 * lowerTail) };
}

assert(manifest.id === "fair_correction_timing_haiku_v1", `Unexpected study id: ${manifest.id}`);
assert(manifest.cells.length === 48, `Expected 48 runs, found ${manifest.cells.length}`);

const runs = manifest.cells.map((cell) => {
  const summaryPath = summaryPathFor(cell);
  assert(fs.existsSync(summaryPath), `Missing summary: ${summaryPath}`);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const roster = JSON.parse(fs.readFileSync(cell.rosterPath, "utf8"));
  const scenario = JSON.parse(fs.readFileSync(cell.scenarioPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const correction = scenario.scheduledInterventions[0];
  const correctionStep = correction.step;
  const finalStep = correctionStep + condition.interventions.stopAfterCorrectionTurns - 1;

  const models = queryRows(dbPath, "SELECT DISTINCT model_name AS model FROM model_calls ORDER BY model_name;")
    .map((row) => row.model);
  const calls = queryRows(dbPath, `
    SELECT model_call_id AS callId, step_index AS step, agent_id AS agentId
    FROM model_calls
    ORDER BY model_call_id;
  `);
  const firstCycle = calls.slice(0, 12);
  const executedOrderKey = firstCycle.map((row) => row.agentId).join(">");
  const executedOrderId = orderIdBySequence.get(executedOrderKey) ?? null;
  const states = queryRows(dbPath, `
    SELECT agent_id AS agentId, stance, confidence, step_index AS step
    FROM agent_claim_states
    WHERE claim_id = 'claim_ego_depletion'
    ORDER BY step_index, state_id;
  `);
  const finalStates = latestNeutralStates(dbPath);
  const beforeStates = latestNeutralStates(dbPath, correctionStep);
  const finalByAgent = new Map(finalStates.map((state) => [state.agentId, state]));
  const endorsersBefore = beforeStates.filter((state) => state.stance === "endorse");
  const finalAmongPriorEndorsers = endorsersBefore
    .map((state) => finalByAgent.get(state.agentId))
    .filter(Boolean);
  const interventions = queryRows(dbPath, `
    SELECT intervention_id AS interventionId, step_index AS step,
           intervention_type AS type, payload_json AS payloadJson
    FROM interventions
    ORDER BY intervention_event_id;
  `);
  const postCorrectionEvents = queryRows(dbPath, `
    SELECT agent_id AS agentId, COUNT(*) AS turns
    FROM events
    WHERE event_type = 'agent_step' AND step_index >= ${correctionStep}
    GROUP BY agent_id
    ORDER BY agent_id;
  `);
  const postCorrectionRetrievals = queryRows(dbPath, `
    SELECT agent_id AS agentId, step_index AS step, context_json AS contextJson
    FROM retrieval_traces
    WHERE claim_id = 'claim_ego_depletion' AND step_index >= ${correctionStep}
    ORDER BY step_index, retrieval_trace_id;
  `);
  const allRetrievals = queryRows(dbPath, `
    SELECT agent_id AS agentId, retrieved_entry_ids_json AS ids, context_json AS contextJson
    FROM retrieval_traces
    WHERE claim_id = 'claim_ego_depletion'
    ORDER BY retrieval_trace_id;
  `);
  const fixedRows = queryRows(dbPath, `
    SELECT agent_id AS agentId, output_json AS outputJson
    FROM events
    WHERE event_type = 'fixed_source_statement'
    ORDER BY event_id;
  `);
  const sourceFinal = states.filter((row) => sourceIds.has(row.agentId))
    .reduce((latest, row) => latest.set(row.agentId, row), new Map());
  const memoryEntries = queryRows(dbPath, `
    SELECT memory_entry_id AS id, visibility
    FROM memory_entries
    WHERE claim_id = 'claim_ego_depletion';
  `);
  const sharedEntryIds = new Set(memoryEntries.filter((row) => row.visibility === "shared").map((row) => row.id));

  const parsedIntervention = interventions.length === 1
    ? JSON.parse(interventions[0].payloadJson)
    : null;
  const fixedMessagesExact = fixedRows.every((row) => {
    const output = JSON.parse(row.outputJson);
    return sourceIds.has(row.agentId)
      && output.stance === "endorse"
      && output.confidence >= 0.9
      && output.text === expectedMessage;
  });
  const parseInvalid = allRetrievals.filter((row) =>
    JSON.parse(row.contextJson).responseParseValid === false).length;
  const correctionVisibleInEveryPostTurn = postCorrectionRetrievals.length === 24
    && postCorrectionRetrievals.every((row) =>
      JSON.parse(row.contextJson).interventionIds.includes(correction.id));
  const sharedMemoryUsed = allRetrievals.some((row) =>
    JSON.parse(row.ids).some((id) => sharedEntryIds.has(id)));
  const finalStepObserved = Math.max(...states.map((row) => row.step));
  const neutralPreCorrectionSpeakers = new Set(calls
    .filter((row) => row.step < correctionStep && !sourceIds.has(row.agentId))
    .map((row) => row.agentId));

  const checks = {
    summaryComplete: summary.completedSteps === finalStep && fs.existsSync(dbPath),
    expectedModel: JSON.stringify(models) === JSON.stringify([expectedModel]),
    configurationMatchesFrozenDesign: runConfig.seed === 731
      && runConfig.maxSteps === 54
      && runConfig.budget.maxModelCalls === 54
      && runConfig.budget.maxOutputTokensPerCall === 384
      && runConfig.budget.temperature === 0
      && scenario.focusClaimId === "claim_ego_depletion"
      && scenario.claims.length === 1
      && scenario.claims[0].truthLabel === "false"
      && correction.effect === -0.9
      && condition.memory.mode === "shared"
      && condition.memory.record === "agent_judgment"
      && condition.memory.maxRetrievedEntries === 6
      && condition.interaction.mode === "memory"
      && condition.interaction.adversaryCommitment === "enforced"
      && condition.interaction.fixedSourceMessage === expectedMessage
      && condition.interventions.correctionVisibility === "global"
      && condition.interventions.stopAfterCorrectionTurns === 24,
    expectedRoles: roster.agents.length === 12
      && roster.agents.filter((agent) => agent.role === "contamination_agent")
        .map((agent) => agent.id).sort().join(",") === "analyst_1,analyst_7"
      && roster.agents.filter((agent) => agent.role === "neutral_agent").length === 10,
    executedOrderMapped: executedOrderId !== null,
    expectedCallCount: calls.length === finalStep,
    expectedFinalStep: finalStepObserved === finalStep,
    oneExactCorrection: interventions.length === 1
      && interventions[0].step === correctionStep
      && interventions[0].type === "correction"
      && parsedIntervention?.text === expectedCorrection,
    equalPostCorrectionTurns: postCorrectionEvents.length === 12
      && postCorrectionEvents.every((row) => row.turns === 2),
    correctionVisibleInEveryPostTurn,
    tenNeutralFinalStates: finalStates.length === 10,
    sourceFinalsEndorse: sourceFinal.size === 2
      && [...sourceFinal.values()].every((row) => row.stance === "endorse"),
    fixedMessagesExact: fixedRows.length > 0 && fixedMessagesExact,
    allResponsesParsed: parseInvalid === 0,
    sharedMemoryUsed,
  };

  return {
    runId: summary.runId,
    timing: cell.timing,
    configuredRosterId: cell.rosterId,
    executedOrderId,
    executedOrderKey,
    seed: cell.seed,
    correctionStep,
    finalStep,
    modelCalls: calls.length,
    neutralLatestStatesBeforeCorrection: beforeStates.length,
    neutralAgentsWithoutPreCorrectionTurn: 10 - neutralPreCorrectionSpeakers.size,
    preCorrection: countStances(beforeStates),
    endorsingImmediatelyBeforeCorrection: endorsersBefore.length,
    final: countStances(finalStates),
    finalAmongPriorEndorsers: countStances(finalAmongPriorEndorsers),
    recoveredPriorEndorsers: finalAmongPriorEndorsers.filter((state) => state.stance !== "endorse").length,
    postCorrectionTurnsByAgent: postCorrectionEvents,
    fixedSourceTurns: fixedRows.length,
    checks,
    summaryPath,
    dbPath,
  };
});

function aggregateTiming(timing) {
  const subset = runs.filter((run) => run.timing === timing);
  const final = addStanceCounts(subset, "final");
  const finalAmongPriorEndorsers = addStanceCounts(subset, "finalAmongPriorEndorsers");
  const endorsingBefore = subset.reduce((sum, run) => sum + run.endorsingImmediatelyBeforeCorrection, 0);
  const recovered = subset.reduce((sum, run) => sum + run.recoveredPriorEndorsers, 0);
  return {
    runs: subset.length,
    neutralFinal: final,
    neutralFinalTotal: Object.values(final).reduce((sum, value) => sum + value, 0),
    affectedOrders: subset.filter((run) => run.final.endorse > 0).length,
    endorsingImmediatelyBeforeCorrection: endorsingBefore,
    finalAmongPriorEndorsers,
    recoveredPriorEndorsers: recovered,
    recoveryRateAmongPriorEndorsers: endorsingBefore === 0 ? null : recovered / endorsingBefore,
    modelCalls: subset.reduce((sum, run) => sum + run.modelCalls, 0),
  };
}

const earlyByOrder = new Map(runs.filter((run) => run.timing === "early")
  .map((run) => [run.executedOrderId, run]));
const lateByOrder = new Map(runs.filter((run) => run.timing === "late")
  .map((run) => [run.executedOrderId, run]));
const pairedByExecutedOrder = expectedOrderIds.map((executedOrderId) => {
  const early = earlyByOrder.get(executedOrderId);
  const late = lateByOrder.get(executedOrderId);
  assert(early && late, `Missing actual-order pair for ${executedOrderId}`);
  return {
    executedOrderId,
    early: {
      configuredRosterId: early.configuredRosterId,
      final: early.final,
      endorsingImmediatelyBeforeCorrection: early.endorsingImmediatelyBeforeCorrection,
      recoveredPriorEndorsers: early.recoveredPriorEndorsers,
    },
    late: {
      configuredRosterId: late.configuredRosterId,
      final: late.final,
      endorsingImmediatelyBeforeCorrection: late.endorsingImmediatelyBeforeCorrection,
      recoveredPriorEndorsers: late.recoveredPriorEndorsers,
    },
    deltaLateMinusEarly: Object.fromEntries(stances.map((stance) => [
      stance,
      late.final[stance] - early.final[stance],
    ])),
  };
});

const lateMore = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.endorse > 0).length;
const tied = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.endorse === 0).length;
const lateFewer = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.endorse < 0).length;
const signTest = twoSidedSignTest(lateMore, lateFewer);
const earlyMoreRejections = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.reject < 0).length;
const tiedRejections = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.reject === 0).length;
const earlyFewerRejections = pairedByExecutedOrder.filter((pair) => pair.deltaLateMinusEarly.reject > 0).length;
const rejectionSignTest = twoSidedSignTest(earlyMoreRejections, earlyFewerRejections);

const expectedExecutedOrders = [...expectedOrderIds].sort();
const executedOrderCoverage = Object.fromEntries(["early", "late"].map((timing) => {
  const observed = runs.filter((run) => run.timing === timing)
    .map((run) => run.executedOrderId).sort();
  return [timing, {
    observed,
    hasEachExpectedOrderExactlyOnce: JSON.stringify(observed) === JSON.stringify(expectedExecutedOrders),
  }];
}));

const checks = {
  expectedRuns: 48,
  observedRuns: runs.length,
  uniqueRunIds: new Set(runs.map((run) => run.runId)).size,
  eachTimingHas24Runs: ["early", "late"].every((timing) =>
    runs.filter((run) => run.timing === timing).length === 24),
  everyRunPassesTraceChecks: runs.every((run) => Object.values(run.checks).every(Boolean)),
  everyExecutedSequenceMapsToKnownOrder: runs.every((run) => run.executedOrderId !== null),
  eachTimingHasSame24ActuallyExecutedOrders: Object.values(executedOrderCoverage)
    .every((item) => item.hasEachExpectedOrderExactlyOnce),
  everyExecutedOrderHasAnEarlyLatePair: pairedByExecutedOrder.length === 24,
  exactTotalModelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0) === 2112,
};
const eligibleForAnalysis = checks.observedRuns === checks.expectedRuns
  && checks.uniqueRunIds === checks.expectedRuns
  && Object.entries(checks)
    .filter(([key]) => !["expectedRuns", "observedRuns", "uniqueRunIds"].includes(key))
    .every(([, value]) => value === true);

const early = aggregateTiming("early");
const late = aggregateTiming("late");
const report = {
  generatedAt: new Date().toISOString(),
  inputPath,
  reportPath,
  eligibleForAnalysis,
  design: {
    model: expectedModel,
    task: "ego depletion",
    agentsPerRun: 12,
    fixedSourcesPerRun: 2,
    neutralAgentsPerRun: 10,
    actuallyExecutedOrdersPerTiming: 24,
    correctionVisibleResponseTurnsPerRun: 24,
    postCorrectionTurnsPerAgent: 2,
    recoveryAmongPriorEndorsers: "latest final stance is reject or uncertain rather than endorse",
    early: { correctionStep: 12, finalStep: 35 },
    late: { correctionStep: 30, finalStep: 53 },
    fixedSourceText: expectedMessage,
    correctionText: expectedCorrection,
  },
  checks,
  executedOrderCoverage,
  early,
  late,
  pairedComparison: {
    falseEndorsement: {
      metric: "neutral final endorsements, late minus early",
      lateMoreEndorsements: lateMore,
      tiedEndorsements: tied,
      lateFewerEndorsements: lateFewer,
      twoSidedExactSignTest: signTest,
      pooledLateMinusEarly: late.neutralFinal.endorse - early.neutralFinal.endorse,
    },
    correctRejection: {
      metric: "neutral final rejections, early minus late",
      earlyMoreRejections,
      tiedRejections,
      earlyFewerRejections,
      twoSidedExactSignTest: rejectionSignTest,
      pooledEarlyMinusLate: early.neutralFinal.reject - late.neutralFinal.reject,
    },
    pairedByExecutedOrder,
  },
  interpretation: {
    lateLeavesMoreFinalFalseEndorsements: late.neutralFinal.endorse > early.neutralFinal.endorse,
    lateLeavesFewerCorrectRejections: late.neutralFinal.reject < early.neutralFinal.reject,
    lateWinsMoreActualOrderPairsOnFalseEndorsement: lateMore > lateFewer,
    earlyWinsMoreActualOrderPairsOnCorrectRejection: earlyMoreRejections > earlyFewerRejections,
    resultConsistentWithReducedCorrectionEffectAfterLongerExposure:
      late.neutralFinal.reject < early.neutralFinal.reject
      && earlyMoreRejections > earlyFewerRejections,
    falseBeliefPersistsMoreAfterLateCorrection:
      late.neutralFinal.endorse > early.neutralFinal.endorse
      && lateMore > lateFewer,
  },
  runs,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  eligibleForAnalysis,
  checks,
  early,
  late,
  pairedComparison: {
    falseEndorsement: report.pairedComparison.falseEndorsement,
    correctRejection: report.pairedComparison.correctRejection,
  },
  interpretation: report.interpretation,
}, null, 2));

if (!eligibleForAnalysis) process.exitCode = 1;
