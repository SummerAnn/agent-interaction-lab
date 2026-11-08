import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

// RESERVED REBUTTAL EXPERIMENT. --preflight is static and makes no API calls.
// Do not run the experiment itself unless a reviewer specifically requests it.

const root = path.resolve(import.meta.dirname, "..");
const version = "tool-notes-case-study-v2";
const studyPath = path.join(root, "experiments", version, "study-manifest.json");
const preflightOnly = process.argv.includes("--preflight");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--preflight");
const outputRoot = path.join(root, "output", version);

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  process.exit(2);
}
if (!fs.existsSync(studyPath)) {
  console.error("Missing v2 study manifest. Run the v2 generator first.");
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

const study = JSON.parse(fs.readFileSync(studyPath, "utf8"));
const scenarios = {
  clean: readData(`scenarios/${version}/clean.yaml`),
  poisoned: readData(`scenarios/${version}/poisoned.yaml`),
  corrected: readData(`scenarios/${version}/corrected.yaml`),
};
const conditions = {
  shared: readData(`conditions/${version}/shared.yaml`),
  personal: readData(`conditions/${version}/personal.yaml`),
};
const rosters = study.orders.map(readData);
const experiments = Object.fromEntries(
  study.cells.map((cell) => [cell.id, readData(cell.experiment)]),
);
const upstreamId = study.upstreamAgentId;
const downstreamIds = study.downstreamAgentIds;
const selectedOrders = study.orderConstruction.selectedOrders;
const candidateOrders = study.orderConstruction.candidateOrders;

const executionOrderKeys = selectedOrders.map((order) => order.downstreamExecutionOrder.join("|"));
const candidateOrderKeys = candidateOrders.map((order) => order.downstreamOrder.join("|"));
const downstreamPositionCounts = Object.fromEntries(
  downstreamIds.map((agentId) => [agentId, Object.fromEntries([1, 2, 3, 4, 5].map((position) => [position, 0]))]),
);
for (const order of selectedOrders) {
  order.downstreamExecutionOrder.forEach((agentId, index) => {
    downstreamPositionCounts[agentId][index + 1] += 1;
  });
}

const rosterMap = new Map(rosters.map((roster) => [roster.id, roster]));
const rosterOrderEncodingMatches = selectedOrders.every((order) => {
  const roster = rosterMap.get(order.rosterId);
  if (!roster) return false;
  const expectedStored = [
    order.downstreamExecutionOrder.at(-1),
    ...order.downstreamExecutionOrder.slice(0, -1),
  ];
  return sameJson(roster.agents.slice(1).map((agent) => agent.id), expectedStored);
});

const commonClaim = scenarios.clean.claims[0];
function commonScenarioFields(scenario) {
  const { id, title, evidence, scheduledInterventions, ...rest } = scenario;
  return rest;
}

const expectedCellDefinitions = {
  clean_shared: [scenarios.clean.id, conditions.shared.id],
  poisoned_shared: [scenarios.poisoned.id, conditions.shared.id],
  poisoned_personal: [scenarios.poisoned.id, conditions.personal.id],
  poisoned_corrected_shared: [scenarios.corrected.id, conditions.shared.id],
};

const staticChecks = {
  reservedNotCompletedStatus: study.status === "reserved_reviewer_followup"
    && study.executionPolicy.includes("DO NOT RUN"),
  fourPrespecifiedCells: study.cells.length === 4
    && new Set(study.cells.map((cell) => cell.id)).size === 4
    && Object.keys(expectedCellDefinitions).every((cellId) => experiments[cellId]),
  twentyFiveUniqueCandidates: candidateOrders.length === 25
    && new Set(candidateOrders.map((order) => order.candidateId)).size === 25
    && new Set(candidateOrderKeys).size === 25,
  onePrespecifiedCandidateOmitted: study.orderConstruction.omittedCandidateId === "family05_shift05"
    && candidateOrders.some((order) => order.candidateId === study.orderConstruction.omittedCandidateId)
    && selectedOrders.every((order) => order.candidateId !== study.orderConstruction.omittedCandidateId),
  twentyFourUniqueSelectedOrders: rosters.length === 24
    && selectedOrders.length === 24
    && new Set(rosters.map((roster) => roster.id)).size === 24
    && new Set(executionOrderKeys).size === 24,
  selectedOrdersAreCandidateSubset: executionOrderKeys.every((key) => candidateOrderKeys.includes(key)),
  rosterEncodingProducesDeclaredOrders: rosterOrderEncodingMatches,
  upstreamAlwaysFirstInStoredRoster: rosters.every((roster) => roster.agents[0]?.id === upstreamId),
  sixNeutralAgentsOnly: rosters.every((roster) =>
    roster.agents.length === 6 && roster.agents.every((agent) => agent.role === "neutral_agent")),
  noForcedStancePolicies: rosters.every((roster) =>
    roster.agents.every((agent) => !agent.seedStatementPolicy && agent.role !== "contamination_agent")),
  oneUpstreamTurnOnly: rosters.every((roster) =>
    roster.agents.find((agent) => agent.id === upstreamId)?.activeUntilStep === 1),
  downstreamCannotWriteMemory: rosters.every((roster) =>
    roster.agents.filter((agent) => downstreamIds.includes(agent.id)).every((agent) => agent.canWriteMemory === false)),
  downstreamPositionsNearBalanced: Object.values(downstreamPositionCounts).every((counts) =>
    Object.values(counts).every((count) => count === 4 || count === 5)
    && sum(counts) === 24),
  everyPositionContainsTwentyFourAssignments: [1, 2, 3, 4, 5].every((position) =>
    downstreamIds.reduce((total, agentId) => total + downstreamPositionCounts[agentId][position], 0) === 24),
  oneRawToolRecipient: Object.values(scenarios).every((scenario) =>
    scenario.evidence.length === 1
    && sameJson(scenario.evidence[0].visibleToAgentIds, [upstreamId])),
  downstreamNeverConfiguredForRawTool: Object.values(scenarios).every((scenario) =>
    downstreamIds.every((agentId) => !scenario.evidence[0].visibleToAgentIds.includes(agentId))),
  objectiveClaimHeldConstant: Object.values(scenarios).every((scenario) =>
    scenario.focusClaimId === commonClaim.id
    && scenario.claims[0].text === commonClaim.text
    && scenario.claims[0].truthLabel === "false"),
  scenarioStructureHeldConstant: sameJson(commonScenarioFields(scenarios.clean), commonScenarioFields(scenarios.poisoned))
    && sameJson(commonScenarioFields(scenarios.poisoned), commonScenarioFields(scenarios.corrected)),
  poisonedAndCorrectedUseSameToolOutput: sameJson(scenarios.poisoned.evidence, scenarios.corrected.evidence),
  correctionOnlyInCorrectedScenario: scenarios.clean.scheduledInterventions.length === 0
    && scenarios.poisoned.scheduledInterventions.length === 0
    && scenarios.corrected.scheduledInterventions.length === 1
    && scenarios.corrected.scheduledInterventions[0].step === 7,
  agentJudgmentRecordOnly: conditions.shared.memory.record === "agent_judgment"
    && conditions.personal.memory.record === "agent_judgment",
  intendedMemoryContrast: conditions.shared.memory.mode === "shared"
    && conditions.personal.memory.mode === "personal",
  standardUncertaintyRule: conditions.shared.memory.writeUncertainAnswers === false
    && conditions.personal.memory.writeUncertainAnswers === false,
  oneUpstreamAndThreeDownstreamPasses: Object.values(experiments).every((experiment) =>
    experiment.maxSteps === 16 && experiment.budget.maxModelCalls === 16),
  seedPreservesUpstreamFirst: Object.values(experiments).every((experiment) =>
    sameJson(experiment.seeds, [study.seed])
    && study.seed % 6 === 0
    && study.seed % 5 === 0),
  sameOrdersEverywhere: Object.values(experiments).every((experiment) =>
    sameJson(experiment.rosterPaths, study.orders)),
  reservedLabelsAndWarning: Object.values(experiments).every((experiment) =>
    experiment.benchmarkMeta?.status === "supporting"
    && experiment.benchmarkMeta?.locked === true
    && experiment.benchmarkMeta?.notes?.some((note) => note.includes("DO NOT RUN"))),
  cellMappingsCorrect: Object.entries(expectedCellDefinitions).every(([cellId, [scenarioId, conditionId]]) => {
    const experiment = experiments[cellId];
    return experiment
      && readData(experiment.scenarios[0]).id === scenarioId
      && readData(experiment.conditions[0]).id === conditionId;
  }),
  exactPlannedBudget: study.plannedRuns === 96
    && study.plannedModelCalls === 1536
    && study.cells.length * study.orders.length === 96
    && study.cells.length * study.orders.length * 16 === 1536,
  newV2PathsOnly: study.orders.every((relativePath) => relativePath.includes(version))
    && study.cells.every((cell) => cell.experiment.includes(version))
    && Object.values(experiments).every((experiment) => experiment.outputDir === `output/${version}`),
};

const staticPassed = Object.values(staticChecks).every(Boolean);
const baseReport = {
  generatedAt: new Date().toISOString(),
  mode: preflightOnly ? "preflight" : "post-run",
  executionPolicy: study.executionPolicy,
  design: {
    studyId: study.id,
    interpretationLimit: study.interpretationLimit,
    model: rosters[0].agents[0].model,
    agentsPerRun: 6,
    upstreamAgentsPerRun: 1,
    downstreamAgentsPerRun: 5,
    candidateOrders: 25,
    omittedCandidateId: study.orderConstruction.omittedCandidateId,
    ordersPerCell: 24,
    cells: study.cells.map((cell) => cell.id),
    plannedRuns: 96,
    plannedModelCalls: 1536,
    correctCalculation: study.task.correctCalculation,
  },
  staticChecks,
  downstreamPositionCounts,
};

if (preflightOnly) {
  const reportPath = path.join(import.meta.dirname, "tool-notes-case-study-v2-preflight.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({ ...baseReport, passed: staticPassed }, null, 2)}\n`);
  console.log(JSON.stringify({
    reportPath,
    passed: staticPassed,
    plannedRuns: 96,
    plannedModelCalls: 1536,
    downstreamPositionCounts,
    failedChecks: Object.entries(staticChecks).filter(([, passed]) => !passed).map(([name]) => name),
  }, null, 2));
  process.exit(staticPassed ? 0 : 1);
}

const resultPaths = Object.values(experiments).map((experiment) =>
  path.join(outputRoot, `${experiment.id}-grid-results.json`),
);
const missingResultPaths = resultPaths.filter((resultPath) => !fs.existsSync(resultPath));
if (missingResultPaths.length > 0) {
  console.error(JSON.stringify({
    error: "V2 outputs are incomplete. Do not treat this as a completed experiment.",
    missingResultPaths,
  }, null, 2));
  process.exit(2);
}

const cellResults = resultPaths.flatMap((resultPath) => {
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const studyCellId = Object.entries(experiments)
    .find(([, experiment]) => experiment.id === result.grid.id)?.[0] ?? result.grid.id;
  return result.cells.map((cell) => ({ ...cell, resultPath, studyCellId }));
});

const runAudits = cellResults.map((cell) => {
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
    SELECT agent_id AS agentId, COUNT(*) AS calls
    FROM model_calls GROUP BY agent_id ORDER BY agent_id;
  `);
  const states = query(dbPath, `
    SELECT step_index AS step, agent_id AS agentId, stance
    FROM agent_claim_states WHERE step_index > 0 ORDER BY step_index;
  `);
  const interventions = query(dbPath, `
    SELECT intervention_id AS interventionId, step_index AS step
    FROM interventions ORDER BY step_index;
  `);
  const upstreamTrace = traces.find((trace) => trace.agentId === upstreamId);
  const downstreamTraces = traces.filter((trace) => downstreamIds.includes(trace.agentId));
  const upstreamEntries = memoryEntries.filter((entry) => entry.agentId === upstreamId);
  const upstreamEntryIds = new Set(upstreamEntries.map((entry) => entry.entryId));
  const downstreamRetrievingUpstream = downstreamTraces.filter((trace) =>
    trace.retrievedIds.some((entryId) => upstreamEntryIds.has(entryId)),
  );
  const downstreamStates = states.filter((state) => downstreamIds.includes(state.agentId));
  const firstDownstreamStates = downstreamIds.map((agentId) =>
    downstreamStates.filter((state) => state.agentId === agentId).sort((left, right) => left.step - right.step)[0],
  );
  const finalDownstreamStates = downstreamIds.map((agentId) =>
    downstreamStates.filter((state) => state.agentId === agentId).sort((left, right) => right.step - left.step)[0],
  );
  const isPersonal = cell.conditionId === conditions.personal.id;
  const isCorrected = cell.scenarioId === scenarios.corrected.id;
  const expectedUpstreamStance = cell.scenarioId === scenarios.clean.id ? "reject" : "endorse";
  const perAgentCalls = Object.fromEntries(calls.map((row) => [row.agentId, row.calls]));

  return {
    runId: cell.summary.runId,
    cellId: cell.studyCellId,
    scenarioId: cell.scenarioId,
    conditionId: cell.conditionId,
    dbPath,
    completedSteps: cell.summary.completedSteps,
    modelCalls: calls.reduce((total, row) => total + row.calls, 0),
    perAgentCalls,
    firstSpeakerIsUpstream: traces[0]?.agentId === upstreamId && traces[0]?.step === 1,
    upstreamRawEvidenceOnly: sameJson(upstreamTrace?.context.visibleEvidenceIds ?? [], [study.rawToolEvidenceId])
      && downstreamTraces.every((trace) => (trace.context.visibleEvidenceIds ?? []).length === 0),
    upstreamCitedTool: (upstreamTrace?.context.citedSourceIds ?? []).includes(study.rawToolEvidenceId),
    upstreamRetrievedNoRecord: (upstreamTrace?.retrievedIds ?? []).length === 0,
    upstreamStance: states.find((state) => state.agentId === upstreamId)?.stance ?? null,
    upstreamStanceMatchesTool: states.find((state) => state.agentId === upstreamId)?.stance === expectedUpstreamStance,
    allAgentsNeutral: traces.every((trace) => trace.context.role === "neutral_agent"),
    noRawEvidenceStored: memoryEntries.every((entry) => entry.sourceType === "agent"),
    upstreamNoteCount: upstreamEntries.length,
    downstreamMemoryEntryCount: memoryEntries.filter((entry) => entry.agentId !== upstreamId).length,
    downstreamRetrievingUpstreamCount: downstreamRetrievingUpstream.length,
    sharingRulePassed: upstreamEntries.length === 0
      ? true
      : isPersonal
        ? downstreamRetrievingUpstream.length === 0
        : downstreamRetrievingUpstream.length === downstreamIds.length * 3,
    correctionRulePassed: isCorrected
      ? interventions.length === 1
        && interventions[0].interventionId === "verified_recalculation"
        && downstreamTraces.filter((trace) => trace.step <= 6).every((trace) =>
          (trace.context.interventionIds ?? []).length === 0)
        && downstreamTraces.filter((trace) => trace.step >= 7).every((trace) =>
          (trace.context.interventionIds ?? []).includes("verified_recalculation"))
      : interventions.length === 0
        && downstreamTraces.every((trace) => (trace.context.interventionIds ?? []).length === 0),
    parserFallbackCount: memoryEntries.filter((entry) =>
      entry.text.includes("[parse fallback]") || entry.text.includes("[heuristic fallback]"),
    ).length,
    responseParseFailureCount: traces.filter((trace) => trace.context.responseParseValid !== true).length,
    firstDownstreamStances: {
      endorse: firstDownstreamStates.filter((state) => state?.stance === "endorse").length,
      reject: firstDownstreamStates.filter((state) => state?.stance === "reject").length,
      uncertain: firstDownstreamStates.filter((state) => state?.stance === "uncertain").length,
    },
    finalDownstreamStances: {
      endorse: finalDownstreamStates.filter((state) => state?.stance === "endorse").length,
      reject: finalDownstreamStates.filter((state) => state?.stance === "reject").length,
      uncertain: finalDownstreamStates.filter((state) => state?.stance === "uncertain").length,
    },
  };
});

const runtimeChecks = {
  ninetySixRuns: runAudits.length === 96,
  uniqueRunIds: new Set(runAudits.map((run) => run.runId)).size === 96,
  twentyFourRunsPerCell: study.cells.every((cell) =>
    runAudits.filter((run) => run.cellId === cell.id).length === 24),
  sixteenStepsAndCalls: runAudits.every((run) => run.completedSteps === 16 && run.modelCalls === 16),
  oneUpstreamAndThreeCallsPerDownstream: runAudits.every((run) =>
    run.perAgentCalls[upstreamId] === 1
    && downstreamIds.every((agentId) => run.perAgentCalls[agentId] === 3)),
  upstreamIsFirstSpeaker: runAudits.every((run) => run.firstSpeakerIsUpstream),
  upstreamGeneratedOneNotePerRun: runAudits.every((run) => run.upstreamNoteCount === 1),
  upstreamCitedPrivateTool: runAudits.every((run) => run.upstreamCitedTool),
  upstreamRetrievedNoPriorRecord: runAudits.every((run) => run.upstreamRetrievedNoRecord),
  upstreamRespondedInToolDirection: runAudits.every((run) => run.upstreamStanceMatchesTool),
  upstreamAloneSeesRawTool: runAudits.every((run) => run.upstreamRawEvidenceOnly),
  allAgentsRemainNeutral: runAudits.every((run) => run.allAgentsNeutral),
  rawToolNeverStoredDirectly: runAudits.every((run) => run.noRawEvidenceStored),
  downstreamNeverWritesMemory: runAudits.every((run) => run.downstreamMemoryEntryCount === 0),
  memoryExposureMatchesCondition: runAudits.every((run) => run.sharingRulePassed),
  correctionExposureMatchesCondition: runAudits.every((run) => run.correctionRulePassed),
  noParserFallbacks: runAudits.every((run) =>
    run.parserFallbackCount === 0 && run.responseParseFailureCount === 0),
  completeDownstreamOutcomes: runAudits.every((run) =>
    sum(run.firstDownstreamStances) === 5 && sum(run.finalDownstreamStances) === 5),
};

const byCell = Object.fromEntries(study.cells.map((cell) => {
  const subset = runAudits.filter((run) => run.cellId === cell.id);
  return [cell.id, {
    runs: subset.length,
    upstreamNotesWritten: subset.reduce((total, run) => total + run.upstreamNoteCount, 0),
    downstreamRetrievalsOfUpstreamNote: subset.reduce(
      (total, run) => total + run.downstreamRetrievingUpstreamCount,
      0,
    ),
    upstreamStances: {
      endorse: subset.filter((run) => run.upstreamStance === "endorse").length,
      reject: subset.filter((run) => run.upstreamStance === "reject").length,
      uncertain: subset.filter((run) => run.upstreamStance === "uncertain").length,
    },
    firstDownstreamStances: {
      endorse: subset.reduce((total, run) => total + run.firstDownstreamStances.endorse, 0),
      reject: subset.reduce((total, run) => total + run.firstDownstreamStances.reject, 0),
      uncertain: subset.reduce((total, run) => total + run.firstDownstreamStances.uncertain, 0),
    },
    finalDownstreamStances: {
      endorse: subset.reduce((total, run) => total + run.finalDownstreamStances.endorse, 0),
      reject: subset.reduce((total, run) => total + run.finalDownstreamStances.reject, 0),
      uncertain: subset.reduce((total, run) => total + run.finalDownstreamStances.uncertain, 0),
    },
  }];
}));

const passed = staticPassed && Object.values(runtimeChecks).every(Boolean);
const report = { ...baseReport, runtimeChecks, byCell, runs: runAudits, passed };
const reportPath = path.join(import.meta.dirname, "tool-notes-case-study-v2-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  passed,
  failedStaticChecks: Object.entries(staticChecks).filter(([, value]) => !value).map(([name]) => name),
  failedRuntimeChecks: Object.entries(runtimeChecks).filter(([, value]) => !value).map(([name]) => name),
  byCell,
}, null, 2));
process.exit(passed ? 0 : 1);
