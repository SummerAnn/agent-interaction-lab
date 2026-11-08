import fs from "fs";
import path from "path";

import { queryRows } from "../src/db/sqlite.ts";

const [gridPathArg, outputPathArg] = process.argv.slice(2);
if (!gridPathArg) {
  throw new Error(
    "Usage: node --import tsx analysis/audit-record-removal-persistence-v1.mjs "
      + "<record-removal-grid-results.json> [audit-output.json]",
  );
}

const gridPath = path.resolve(gridPathArg);
const outputPath = path.resolve(
  outputPathArg ?? "analysis/record-removal-persistence-v1-audit.json",
);
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
const claimId = "claim_ego_depletion";
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const expectedMessage = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const conditions = {
  shared_to_personal_after_three_rounds: "personal",
  shared_to_no_history_after_three_rounds: "no_history",
};

function assert(value, message) {
  if (!value) throw new Error(message);
}

function equal(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function emptyCounts() {
  return { endorse: 0, reject: 0, uncertain: 0 };
}

function stanceCounts(states) {
  return states.reduce((counts, state) => {
    assert(["endorse", "reject", "uncertain"].includes(state.stance), `unknown stance ${state.stance}`);
    counts[state.stance] += 1;
    return counts;
  }, emptyCounts());
}

function addCounts(left, right) {
  return {
    endorse: left.endorse + right.endorse,
    reject: left.reject + right.reject,
    uncertain: left.uncertain + right.uncertain,
  };
}

function transitionMatrix(fromByAgent, toByAgent, agentIds) {
  const matrix = {
    endorse: emptyCounts(),
    reject: emptyCounts(),
    uncertain: emptyCounts(),
  };
  for (const agentId of agentIds) {
    const from = fromByAgent.get(agentId)?.stance;
    const to = toByAgent.get(agentId)?.stance;
    assert(from && to, `missing transition state for ${agentId}`);
    matrix[from][to] += 1;
  }
  return matrix;
}

function addMatrices(left, right) {
  const result = {
    endorse: emptyCounts(),
    reject: emptyCounts(),
    uncertain: emptyCounts(),
  };
  for (const from of Object.keys(result)) {
    result[from] = addCounts(left[from], right[from]);
  }
  return result;
}

function rotate(values, start) {
  return [...values.slice(start), ...values.slice(0, start)];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function choose(n, k) {
  const smaller = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= smaller; index += 1) {
    value = value * (n - smaller + index) / index;
  }
  return value;
}

function exactTwoSidedSignP(wins, losses) {
  const nonTies = wins + losses;
  if (nonTies === 0) return 1;
  const tail = Math.min(wins, losses);
  let probability = 0;
  for (let successes = 0; successes <= tail; successes += 1) {
    probability += choose(nonTies, successes) * (0.5 ** nonTies);
  }
  return Math.min(1, 2 * probability);
}

assert(grid.grid.id === "record_removal_persistence_haiku_v1", `wrong grid id ${grid.grid.id}`);
assert(grid.cells.length === 48, `expected 48 runs, found ${grid.cells.length}`);
assert(new Set(grid.cells.map((cell) => cell.summary.runId)).size === 48, "run IDs are not unique");
assert(grid.grid.seeds.length === 1 && grid.grid.seeds[0] === 732, "unexpected seed");
assert(grid.grid.maxSteps === 66, `expected maxSteps 66, found ${grid.grid.maxSteps}`);
assert(grid.grid.cellOrderSeed === 2026103102, "frozen cell-order seed changed");

const rosterCatalog = new Map(grid.inputCatalog.rosters.map((roster) => [roster.id, roster.path]));
const runReports = [];

for (const cell of grid.cells) {
  const condition = conditions[cell.conditionId];
  assert(condition, `unexpected condition ${cell.conditionId}`);
  assert(cell.scenarioId === "blind_ego_depletion_scale12_a2_v1", `unexpected scenario ${cell.scenarioId}`);
  assert(cell.seed === 732, `${cell.rosterId}: unexpected seed ${cell.seed}`);
  assert(cell.summary.maxSteps === 66, `${cell.rosterId}: incomplete maxSteps`);
  assert(cell.manipulationCheck.passed, `${cell.rosterId} ${cell.conditionId}: manipulation check failed`);

  const rosterPath = rosterCatalog.get(cell.rosterId);
  assert(rosterPath, `missing roster path for ${cell.rosterId}`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  assert(roster.agents.length === 12, `${cell.rosterId}: roster does not contain 12 agents`);
  assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
    `${cell.rosterId}: non-Haiku agent`);
  const rosterAgentIds = roster.agents.map((agent) => agent.id);
  const neutralIds = rosterAgentIds.filter((agentId) => !sourceIds.has(agentId));
  assert(neutralIds.length === 10, `${cell.rosterId}: expected ten neutral agents`);
  assert(roster.agents.filter((agent) => sourceIds.has(agent.id)).every((agent) => agent.activeUntilStep === 36),
    `${cell.rosterId}: source exit step changed`);

  const dbPath = cell.summary.dbPath;
  assert(fs.existsSync(dbPath), `${cell.rosterId}: missing trace database`);
  const calls = queryRows(dbPath, "SELECT COUNT(*) AS count FROM model_calls;")[0]?.count ?? 0;
  assert(calls === 66, `${cell.rosterId} ${cell.conditionId}: expected 66 calls, found ${calls}`);

  const events = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId
    FROM events WHERE event_type = 'agent_step'
    ORDER BY step_index, event_id;
  `);
  assert(events.length === 66, `${cell.rosterId} ${cell.conditionId}: expected 66 agent turns`);
  assert(events.every((event, index) => event.step === index + 1), `${cell.rosterId}: nonconsecutive steps`);
  const sharedOrder = events.slice(0, 12).map((event) => event.agentId);
  const expectedSharedOrder = rotate(rosterAgentIds, cell.seed % rosterAgentIds.length);
  assert(equal(sharedOrder, expectedSharedOrder), `${cell.rosterId}: actual shared order differs from roster/seed`);
  assert(chunks(events.slice(0, 36).map((event) => event.agentId), 12)
    .every((round) => equal(round, sharedOrder)), `${cell.rosterId}: shared rounds use different orders`);

  const postEvents = events.slice(36);
  assert(postEvents.every((event) => !sourceIds.has(event.agentId)), `${cell.rosterId}: source spoke after removal`);
  const expectedPostStart = (cell.seed % neutralIds.length + 36) % neutralIds.length;
  const expectedFollowupOrder = rotate(neutralIds, expectedPostStart);
  const followupRounds = chunks(postEvents.map((event) => event.agentId), 10);
  assert(followupRounds.length === 3 && followupRounds.every((round) => equal(round, expectedFollowupOrder)),
    `${cell.rosterId}: follow-up does not give every neutral one turn per round`);

  const transitions = queryRows(dbPath, `
    SELECT step_index AS step, output_json AS outputJson
    FROM events WHERE event_type = 'memory_mode_transition';
  `);
  assert(transitions.length === 1 && transitions[0].step === 37, `${cell.rosterId}: transition is not at step 37`);
  const transition = JSON.parse(transitions[0].outputJson);
  assert(transition.from === "shared", `${cell.rosterId}: transition did not begin in shared memory`);
  assert(transition.to === (condition === "personal" ? "personal" : "none"),
    `${cell.rosterId}: wrong transition target ${transition.to}`);

  const fixedStatements = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId, output_json AS outputJson
    FROM events WHERE event_type = 'fixed_source_statement'
    ORDER BY step_index;
  `);
  assert(fixedStatements.length === 6, `${cell.rosterId}: expected six fixed-source statements`);
  assert(fixedStatements.every((row) => row.step <= 36 && sourceIds.has(row.agentId)),
    `${cell.rosterId}: fixed source spoke after removal or wrong author`);
  assert(fixedStatements.every((row) => {
    const output = JSON.parse(row.outputJson);
    return output.stance === "endorse" && output.text === expectedMessage;
  }), `${cell.rosterId}: fixed message mismatch`);

  const entries = new Map(queryRows(dbPath, `
    SELECT memory_entry_id AS id, step_index AS step, agent_id AS agentId,
           visibility, source_type AS sourceType
    FROM memory_entries;
  `).map((entry) => [entry.id, entry]));
  const retrievals = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId,
           retrieved_entry_ids_json AS idsJson, context_json AS contextJson
    FROM retrieval_traces ORDER BY step_index;
  `);
  assert(retrievals.length === 66, `${cell.rosterId}: expected one retrieval trace per turn`);
  let postRetrievedEntries = 0;
  for (const row of retrievals) {
    const context = JSON.parse(row.contextJson);
    assert(context.responseParseValid !== false, `${cell.rosterId}: parser fallback at step ${row.step}`);
    if (row.step <= 36) continue;
    const ids = JSON.parse(row.idsJson);
    assert((context.visibleEvidenceIds ?? []).length === 0, `${cell.rosterId}: hidden task evidence became visible`);
    assert((context.interventionIds ?? []).length === 0, `${cell.rosterId}: unexpected intervention after removal`);
    if (condition === "personal") {
      assert(context.priorStance !== null, `${cell.rosterId}: personal phase omitted own prior stance`);
      for (const id of ids) {
        const entry = entries.get(id);
        assert(entry, `${cell.rosterId}: retrieved unknown entry ${id}`);
        assert(entry.agentId === row.agentId, `${cell.rosterId}: personal phase exposed ${entry.agentId} to ${row.agentId}`);
        assert(!sourceIds.has(entry.agentId), `${cell.rosterId}: personal phase exposed source content`);
        assert(entry.sourceType === "agent" && entry.step < row.step,
          `${cell.rosterId}: personal phase exposed a non-agent or future entry`);
      }
      postRetrievedEntries += ids.length;
    } else {
      assert(ids.length === 0, `${cell.rosterId}: no-history phase retrieved memory`);
      assert(context.priorStance === null, `${cell.rosterId}: no-history phase exposed prior stance`);
    }
  }

  const postEntries = [...entries.values()].filter((entry) => entry.step > 36);
  if (condition === "personal") {
    assert(postEntries.every((entry) => entry.visibility === "personal" && !sourceIds.has(entry.agentId)),
      `${cell.rosterId}: personal follow-up wrote a shared/source entry`);
  } else {
    assert(postEntries.length === 0, `${cell.rosterId}: no-history follow-up wrote memory entries`);
  }

  const stateRows = queryRows(dbPath, `
    SELECT state_id AS stateId, step_index AS step, agent_id AS agentId, stance, confidence
    FROM agent_claim_states
    WHERE claim_id = '${claimId}' AND agent_id NOT IN ('analyst_1', 'analyst_7')
    ORDER BY step_index, state_id;
  `);
  const removalByAgent = new Map();
  const postByAgent = new Map(neutralIds.map((agentId) => [agentId, []]));
  for (const state of stateRows) {
    if (state.step <= 36) removalByAgent.set(state.agentId, state);
    else postByAgent.get(state.agentId)?.push(state);
  }
  assert(removalByAgent.size === 10, `${cell.rosterId}: missing removal endpoint states`);
  assert([...postByAgent.values()].every((states) => states.length === 3),
    `${cell.rosterId}: each neutral must have three post-removal states`);
  const roundMaps = [0, 1, 2].map((round) => new Map(
    neutralIds.map((agentId) => [agentId, postByAgent.get(agentId)[round]]),
  ));
  const removalEndorserIds = neutralIds.filter((agentId) => removalByAgent.get(agentId).stance === "endorse");
  const removalEndorserTrajectories = {};
  for (const agentId of removalEndorserIds) {
    const trajectory = [
      removalByAgent.get(agentId).stance,
      ...roundMaps.map((round) => round.get(agentId).stance),
    ].join("->");
    removalEndorserTrajectories[trajectory] = (removalEndorserTrajectories[trajectory] ?? 0) + 1;
  }

  runReports.push({
    condition,
    conditionId: cell.conditionId,
    rosterId: cell.rosterId,
    runId: cell.summary.runId,
    dbPath,
    modelCalls: calls,
    sharedOrder,
    followupOrder: expectedFollowupOrder,
    postRetrievedEntries,
    atRemoval: stanceCounts([...removalByAgent.values()]),
    round1: stanceCounts([...roundMaps[0].values()]),
    round2: stanceCounts([...roundMaps[1].values()]),
    round3: stanceCounts([...roundMaps[2].values()]),
    removalEndorsers: removalEndorserIds.length,
    removalEndorsersAtRound1: stanceCounts(removalEndorserIds.map((id) => roundMaps[0].get(id))),
    removalEndorsersAtRound2: stanceCounts(removalEndorserIds.map((id) => roundMaps[1].get(id))),
    removalEndorsersAtRound3: stanceCounts(removalEndorserIds.map((id) => roundMaps[2].get(id))),
    removalEndorserTrajectories,
    transitions: {
      removalToRound1: transitionMatrix(removalByAgent, roundMaps[0], neutralIds),
      round1ToRound2: transitionMatrix(roundMaps[0], roundMaps[1], neutralIds),
      round2ToRound3: transitionMatrix(roundMaps[1], roundMaps[2], neutralIds),
    },
  });
}

function aggregate(condition) {
  const runs = runReports.filter((run) => run.condition === condition);
  assert(runs.length === 24, `${condition}: expected 24 runs, found ${runs.length}`);
  assert(new Set(runs.map((run) => run.rosterId)).size === 24, `${condition}: roster coverage is incomplete`);
  const positionCounts = Array.from({ length: 12 }, () => ({}));
  for (const run of runs) {
    run.sharedOrder.forEach((agentId, position) => {
      positionCounts[position][agentId] = (positionCounts[position][agentId] ?? 0) + 1;
    });
  }
  assert(positionCounts.every((position) =>
    Object.keys(position).length === 12 && Object.values(position).every((count) => count === 2)),
  `${condition}: shared-phase orders are not position-balanced`);

  const sumField = (field) => runs.reduce((total, run) => addCounts(total, run[field]), emptyCounts());
  const sumMatrix = (field) => runs.reduce(
    (total, run) => addMatrices(total, run.transitions[field]),
    { endorse: emptyCounts(), reject: emptyCounts(), uncertain: emptyCounts() },
  );
  const trajectories = {};
  for (const run of runs) {
    for (const [trajectory, count] of Object.entries(run.removalEndorserTrajectories)) {
      trajectories[trajectory] = (trajectories[trajectory] ?? 0) + count;
    }
  }
  const removalEndorsers = runs.reduce((sum, run) => sum + run.removalEndorsers, 0);
  const removalEndorsersAfter = {
    turn1: sumField("removalEndorsersAtRound1"),
    turn2: sumField("removalEndorsersAtRound2"),
    turn3: sumField("removalEndorsersAtRound3"),
  };
  return {
    runs: runs.length,
    neutralJudgmentsPerStage: 240,
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0),
    stages: {
      sharedRecordRemoval: sumField("atRemoval"),
      followupTurn1: sumField("round1"),
      followupTurn2: sumField("round2"),
      followupTurn3: sumField("round3"),
    },
    removalEndorsers,
    removalEndorsersAfter,
    removalEndorsementRetention: {
      turn1: removalEndorsers === 0 ? null : removalEndorsersAfter.turn1.endorse / removalEndorsers,
      turn2: removalEndorsers === 0 ? null : removalEndorsersAfter.turn2.endorse / removalEndorsers,
      turn3: removalEndorsers === 0 ? null : removalEndorsersAfter.turn3.endorse / removalEndorsers,
    },
    ordersWithAnyEndorsement: {
      atRemoval: runs.filter((run) => run.atRemoval.endorse > 0).length,
      turn1: runs.filter((run) => run.round1.endorse > 0).length,
      turn2: runs.filter((run) => run.round2.endorse > 0).length,
      turn3: runs.filter((run) => run.round3.endorse > 0).length,
    },
    allAgentTransitions: {
      removalToTurn1: sumMatrix("removalToRound1"),
      turn1ToTurn2: sumMatrix("round1ToRound2"),
      turn2ToTurn3: sumMatrix("round2ToRound3"),
    },
    removalEndorserTrajectories: trajectories,
    postTransitionRetrievedEntries: runs.reduce((sum, run) => sum + run.postRetrievedEntries, 0),
    positionBalance: positionCounts,
  };
}

const pairedRosters = new Map();
for (const run of runReports) {
  const item = pairedRosters.get(run.rosterId) ?? {};
  item[run.condition] = run;
  pairedRosters.set(run.rosterId, item);
}
assert([...pairedRosters.values()].every((pair) => pair.personal && pair.no_history),
  "conditions do not cover the same 24 rosters");
assert([...pairedRosters.values()].every((pair) => equal(pair.personal.sharedOrder, pair.no_history.sharedOrder)),
  "paired conditions use different shared-phase orders");

const pairedByRoster = [...pairedRosters.entries()]
  .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  .map(([rosterId, pair]) => ({
    rosterId,
    atRemoval: {
      personal: pair.personal.atRemoval.endorse,
      noHistory: pair.no_history.atRemoval.endorse,
    },
    turn1: {
      personal: pair.personal.round1.endorse,
      noHistory: pair.no_history.round1.endorse,
    },
    turn2: {
      personal: pair.personal.round2.endorse,
      noHistory: pair.no_history.round2.endorse,
    },
    turn3: {
      personal: pair.personal.round3.endorse,
      noHistory: pair.no_history.round3.endorse,
    },
  }));

function pairedEndorsementComparison(stage) {
  const personalTotal = pairedByRoster.reduce((sum, pair) => sum + pair[stage].personal, 0);
  const noHistoryTotal = pairedByRoster.reduce((sum, pair) => sum + pair[stage].noHistory, 0);
  const personalHigher = pairedByRoster.filter(
    (pair) => pair[stage].personal > pair[stage].noHistory,
  ).length;
  const noHistoryHigher = pairedByRoster.filter(
    (pair) => pair[stage].personal < pair[stage].noHistory,
  ).length;
  const ties = pairedByRoster.length - personalHigher - noHistoryHigher;
  return {
    personalTotal,
    noHistoryTotal,
    personalMinusNoHistory: personalTotal - noHistoryTotal,
    personalHigher,
    noHistoryHigher,
    ties,
    nonTiedOrders: personalHigher + noHistoryHigher,
    exactTwoSidedSignP: exactTwoSidedSignP(personalHigher, noHistoryHigher),
  };
}

const pairedComparison = {
  atRemoval: pairedEndorsementComparison("atRemoval"),
  turn1: pairedEndorsementComparison("turn1"),
  turn2: pairedEndorsementComparison("turn2"),
  turn3: pairedEndorsementComparison("turn3"),
  byRoster: pairedByRoster,
};
assert(
  pairedComparison.atRemoval.personalHigher === 0
    && pairedComparison.atRemoval.noHistoryHigher === 2
    && pairedComparison.atRemoval.ties === 22
    && pairedComparison.atRemoval.personalMinusNoHistory === -5,
  "unexpected paired removal-endpoint comparison",
);
assert(
  pairedComparison.turn3.personalHigher === 16
    && pairedComparison.turn3.noHistoryHigher === 0
    && pairedComparison.turn3.ties === 8
    && pairedComparison.turn3.personalMinusNoHistory === 85
    && Math.abs(pairedComparison.turn3.exactTwoSidedSignP - 0.000030517578125) < 1e-15,
  "unexpected paired turn-3 comparison",
);

const report = {
  generatedAt: new Date().toISOString(),
  eligibleForAnalysis: true,
  gridPath,
  design: {
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
    agents: 12,
    fixedSources: 2,
    neutralAgents: 10,
    balancedOrdersPerCondition: 24,
    conditions: 2,
    runs: 48,
    sharedMemoryTurns: 36,
    sharedMemoryRounds: 3,
    transitionStep: 37,
    followupTurnsPerNeutral: 3,
    plannedAndObservedModelCalls: 3168,
    fixedMessage: expectedMessage,
    controls: {
      personal: "shared record removed; each neutral sees only its own earlier entries and prior stance",
      noHistory: "shared record removed; no earlier entry or prior stance is shown",
    },
  },
  auditChecks: {
    completeRuns: 48,
    exactCallsPerRun: 66,
    parserFallbacks: 0,
    sourcesExitAfterStep36: true,
    oneTransitionAtStep37: true,
    threeTurnsPerNeutralAfterRemoval: true,
    personalRetrievalsOwnEntriesOnly: true,
    personalRetrievalsContainNoSourceEntries: true,
    personalPriorStancePresent: true,
    noHistoryRetrievalsEmpty: true,
    noHistoryPriorStanceAbsent: true,
    sharedOrdersPositionBalanced: true,
    pairedConditionsUseSameOrders: true,
    pairedEndpointComparisonVerified: true,
    fixedMessagesExact: true,
  },
  personal: aggregate("personal"),
  noHistory: aggregate("no_history"),
  pairedComparison,
  orderMapping: runReports.map((run) => ({
    condition: run.condition,
    rosterId: run.rosterId,
    sharedOrder: run.sharedOrder,
    followupOrder: run.followupOrder,
  })),
  runs: runReports,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  eligibleForAnalysis: report.eligibleForAnalysis,
  design: report.design,
  personal: report.personal,
  noHistory: report.noHistory,
  outputPath,
}, null, 2));
