import fs from "fs";
import path from "path";

import { queryRows } from "../src/db/sqlite.ts";

const [correctionPathArg, persistencePathArg, outputPathArg] = process.argv.slice(2);
if (!correctionPathArg || !persistencePathArg) {
  throw new Error(
    "Usage: node --import tsx analysis/audit-lockin-depth-v1.mjs "
      + "<fair-correction-grid.json> <persistence-grid.json> [audit-output.json]",
  );
}

const correctionPath = path.resolve(correctionPathArg);
const persistencePath = path.resolve(persistencePathArg);
const outputPath = path.resolve(outputPathArg ?? "analysis/lockin-depth-v1-audit.json");
const correctionGrid = JSON.parse(fs.readFileSync(correctionPath, "utf8"));
const persistenceGrid = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
const expectedMessage = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const sourceIds = new Set(["analyst_1", "analyst_7"]);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function latestNeutralStates(dbPath, where = "1=1") {
  return queryRows(dbPath, `
    WITH ranked AS (
      SELECT agent_id AS agentId, stance, confidence, step_index AS step,
             ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY step_index DESC, state_id DESC) AS rank
      FROM agent_claim_states
      WHERE claim_id = 'claim_ego_depletion'
        AND agent_id NOT IN ('analyst_1', 'analyst_7')
        AND ${where}
    )
    SELECT agentId, stance, confidence, step FROM ranked WHERE rank = 1 ORDER BY agentId;
  `);
}

function stanceCounts(states) {
  return states.reduce((counts, state) => {
    counts[state.stance] = (counts[state.stance] ?? 0) + 1;
    return counts;
  }, { endorse: 0, reject: 0, uncertain: 0 });
}

function parseHealth(dbPath) {
  const rows = queryRows(dbPath, `
    SELECT context_json AS contextJson
    FROM retrieval_traces
    WHERE claim_id = 'claim_ego_depletion';
  `);
  return {
    calls: rows.length,
    invalid: rows.filter((row) => JSON.parse(row.contextJson).responseParseValid === false).length,
  };
}

function fixedMessageHealth(dbPath) {
  const rows = queryRows(dbPath, `
    SELECT agent_id AS agentId, output_json AS outputJson
    FROM events WHERE event_type = 'fixed_source_statement';
  `);
  const mismatches = rows.filter((row) => {
    const value = JSON.parse(row.outputJson);
    return !sourceIds.has(row.agentId) || value.stance !== "endorse" || value.text !== expectedMessage;
  });
  return { count: rows.length, mismatches: mismatches.length };
}

assert(correctionGrid.grid.id === "fair_correction_timing_haiku_v1", "wrong C grid id");
assert(correctionGrid.cells.length === 48, `C expected 48 runs, found ${correctionGrid.cells.length}`);

const correctionRuns = [];
for (const cell of correctionGrid.cells) {
  const isEarly = cell.scenarioId === "ego_depletion_early_correction_step12";
  const isLate = cell.scenarioId === "ego_depletion_late_correction_step30";
  assert(isEarly || isLate, `unexpected C scenario ${cell.scenarioId}`);
  const correctionStep = isEarly ? 12 : 30;
  const expectedFinalStep = isEarly ? 35 : 53;
  const dbPath = cell.summary.dbPath;
  const maxStep = queryRows(dbPath, "SELECT MAX(step_index) AS step FROM agent_claim_states;")[0]?.step;
  const interventions = queryRows(dbPath, "SELECT step_index AS step FROM interventions;");
  const exposedTurns = queryRows(
    dbPath,
    `SELECT COUNT(*) AS count FROM events WHERE event_type = 'agent_step' AND step_index >= ${correctionStep};`,
  )[0]?.count ?? 0;
  const finalStates = latestNeutralStates(dbPath);
  const beforeStates = latestNeutralStates(dbPath, `step_index < ${correctionStep}`);
  const finalByAgent = new Map(finalStates.map((state) => [state.agentId, state]));
  const atRisk = beforeStates.filter((state) => state.stance === "endorse");
  const atRiskFinal = atRisk.map((state) => finalByAgent.get(state.agentId)).filter(Boolean);
  const fixed = fixedMessageHealth(dbPath);
  const parse = parseHealth(dbPath);

  assert(maxStep === expectedFinalStep, `${cell.rosterId} ${cell.scenarioId}: final step ${maxStep}`);
  assert(interventions.length === 1 && interventions[0].step === correctionStep,
    `${cell.rosterId} ${cell.scenarioId}: correction mismatch`);
  assert(exposedTurns === 24, `${cell.rosterId} ${cell.scenarioId}: ${exposedTurns} correction-visible turns`);
  assert(finalStates.length === 10, `${cell.rosterId} ${cell.scenarioId}: incomplete neutral final states`);
  assert(fixed.mismatches === 0, `${cell.rosterId} ${cell.scenarioId}: fixed-message mismatch`);
  assert(parse.invalid === 0, `${cell.rosterId} ${cell.scenarioId}: ${parse.invalid} parser fallbacks`);
  assert(cell.manipulationCheck.passed, `${cell.rosterId} ${cell.scenarioId}: manipulation check failed`);

  correctionRuns.push({
    timing: isEarly ? "early" : "late",
    rosterId: cell.rosterId,
    correctionStep,
    finalStep: maxStep,
    correctionVisibleTurns: exposedTurns,
    final: stanceCounts(finalStates),
    endorsingBeforeCorrection: atRisk.length,
    finalAmongPriorEndorsers: stanceCounts(atRiskFinal),
    fixedSourceTurns: fixed.count,
    modelCalls: parse.calls,
  });
}

function aggregateCorrection(timing) {
  const runs = correctionRuns.filter((run) => run.timing === timing);
  return {
    runs: runs.length,
    neutralFinal: stanceCounts(runs.flatMap((run) => [
      ...Array(run.final.endorse).fill({ stance: "endorse" }),
      ...Array(run.final.reject).fill({ stance: "reject" }),
      ...Array(run.final.uncertain).fill({ stance: "uncertain" }),
    ])),
    endorsingBeforeCorrection: runs.reduce((sum, run) => sum + run.endorsingBeforeCorrection, 0),
    finalAmongPriorEndorsers: stanceCounts(runs.flatMap((run) => [
      ...Array(run.finalAmongPriorEndorsers.endorse).fill({ stance: "endorse" }),
      ...Array(run.finalAmongPriorEndorsers.reject).fill({ stance: "reject" }),
      ...Array(run.finalAmongPriorEndorsers.uncertain).fill({ stance: "uncertain" }),
    ])),
    affectedOrders: runs.filter((run) => run.final.endorse > 0).length,
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0),
  };
}

assert(persistenceGrid.grid.id === "record_removal_persistence_haiku_v1", "wrong D grid id");
assert(persistenceGrid.cells.length === 48, `D expected 48 runs, found ${persistenceGrid.cells.length}`);

const persistenceRuns = [];
for (const cell of persistenceGrid.cells) {
  const personal = cell.conditionId === "shared_to_personal_after_three_rounds";
  const noHistory = cell.conditionId === "shared_to_no_history_after_three_rounds";
  assert(personal || noHistory, `unexpected D condition ${cell.conditionId}`);
  const dbPath = cell.summary.dbPath;
  const transitions = queryRows(
    dbPath,
    "SELECT step_index AS step, output_json AS outputJson FROM events WHERE event_type = 'memory_mode_transition';",
  );
  assert(transitions.length === 1 && transitions[0].step === 37, `${cell.rosterId}: missing turn-37 transition`);
  const transition = JSON.parse(transitions[0].outputJson);
  assert(transition.to === (personal ? "personal" : "none"), `${cell.rosterId}: wrong transition target`);

  const postTurns = queryRows(dbPath, `
    SELECT agent_id AS agentId, COUNT(*) AS count
    FROM events WHERE event_type = 'agent_step' AND step_index > 36
    GROUP BY agent_id ORDER BY agent_id;
  `);
  assert(postTurns.length === 10 && postTurns.every((row) => row.count === 3),
    `${cell.rosterId} ${cell.conditionId}: follow-up is not three turns per neutral`);
  assert(postTurns.every((row) => !sourceIds.has(row.agentId)), `${cell.rosterId}: source spoke after removal`);

  const retrievals = queryRows(dbPath, `
    SELECT agent_id AS agentId, retrieved_entry_ids_json AS ids, context_json AS contextJson
    FROM retrieval_traces WHERE step_index > 36;
  `);
  const entries = new Map(queryRows(
    dbPath,
    "SELECT memory_entry_id AS id, agent_id AS agentId FROM memory_entries;",
  ).map((row) => [row.id, row.agentId]));
  if (personal) {
    assert(retrievals.every((row) => JSON.parse(row.ids).every((id) => entries.get(id) === row.agentId)),
      `${cell.rosterId}: personal phase exposed another agent's entry`);
  } else {
    assert(retrievals.every((row) => JSON.parse(row.ids).length === 0), `${cell.rosterId}: no-history retrieved memory`);
    assert(retrievals.every((row) => JSON.parse(row.contextJson).priorStance === null),
      `${cell.rosterId}: no-history exposed a prior stance`);
  }

  const atRemoval = latestNeutralStates(dbPath, "step_index <= 36");
  const finalStates = latestNeutralStates(dbPath);
  const finalByAgent = new Map(finalStates.map((state) => [state.agentId, state]));
  const endorsersAtRemoval = atRemoval.filter((state) => state.stance === "endorse");
  const endorserFinal = endorsersAtRemoval.map((state) => finalByAgent.get(state.agentId)).filter(Boolean);
  const fixed = fixedMessageHealth(dbPath);
  const parse = parseHealth(dbPath);
  assert(atRemoval.length === 10 && finalStates.length === 10, `${cell.rosterId}: incomplete neutral states`);
  assert(fixed.mismatches === 0, `${cell.rosterId}: fixed-message mismatch`);
  assert(parse.invalid === 0, `${cell.rosterId}: ${parse.invalid} parser fallbacks`);
  assert(cell.manipulationCheck.passed, `${cell.rosterId} ${cell.conditionId}: manipulation check failed`);

  persistenceRuns.push({
    condition: personal ? "personal" : "no_history",
    rosterId: cell.rosterId,
    atRemoval: stanceCounts(atRemoval),
    final: stanceCounts(finalStates),
    endorsersAtRemoval: endorsersAtRemoval.length,
    finalAmongRemovalEndorsers: stanceCounts(endorserFinal),
    modelCalls: parse.calls,
  });
}

function aggregatePersistence(condition) {
  const runs = persistenceRuns.filter((run) => run.condition === condition);
  const synthesize = (field) => stanceCounts(runs.flatMap((run) => [
    ...Array(run[field].endorse).fill({ stance: "endorse" }),
    ...Array(run[field].reject).fill({ stance: "reject" }),
    ...Array(run[field].uncertain).fill({ stance: "uncertain" }),
  ]));
  return {
    runs: runs.length,
    neutralAtRemoval: synthesize("atRemoval"),
    neutralFinal: synthesize("final"),
    endorsersAtRemoval: runs.reduce((sum, run) => sum + run.endorsersAtRemoval, 0),
    finalAmongRemovalEndorsers: synthesize("finalAmongRemovalEndorsers"),
    ordersWithAnyPersistentEndorsement: runs.filter((run) => run.finalAmongRemovalEndorsers.endorse > 0).length,
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  eligibleForAnalysis: true,
  correction: {
    design: {
      runs: 48,
      balancedOrdersPerTiming: 24,
      correctionVisibleTurnsPerRun: 24,
      early: { correctionStep: 12, finalStep: 35 },
      late: { correctionStep: 30, finalStep: 53 },
    },
    early: aggregateCorrection("early"),
    late: aggregateCorrection("late"),
    runs: correctionRuns,
  },
  persistence: {
    design: {
      runs: 48,
      balancedOrdersPerCondition: 24,
      sharedPhaseTurns: 36,
      transitionStep: 37,
      followupTurnsPerNeutral: 3,
    },
    personal: aggregatePersistence("personal"),
    noHistory: aggregatePersistence("no_history"),
    runs: persistenceRuns,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  eligibleForAnalysis: report.eligibleForAnalysis,
  correction: { early: report.correction.early, late: report.correction.late },
  persistence: { personal: report.persistence.personal, noHistory: report.persistence.noHistory },
  outputPath,
}, null, 2));
