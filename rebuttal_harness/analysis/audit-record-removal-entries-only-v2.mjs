import fs from "fs";
import path from "path";

import { queryRows } from "../src/db/sqlite.ts";

const [gridPathArg, outputPathArg] = process.argv.slice(2);
if (!gridPathArg) {
  throw new Error(
    "Usage: node --import tsx analysis/audit-record-removal-entries-only-v2.mjs "
      + "<record-removal-grid-results.json> [audit-output.json]",
  );
}

const gridPath = path.resolve(gridPathArg);
const outputPath = path.resolve(
  outputPathArg ?? "analysis/record-removal-history-components-v2-audit.json",
);
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
const claimId = "claim_ego_depletion";
const expectedMessage = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const expectedConditions = new Set([
  "shared_to_personal_after_three_rounds",
  "shared_to_personal_entries_only_after_three_rounds",
  "shared_to_reminder_only_after_three_rounds",
  "shared_to_no_history_after_three_rounds",
]);
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const conditionKeys = {
  shared_to_personal_after_three_rounds: "both",
  shared_to_personal_entries_only_after_three_rounds: "entriesOnly",
  shared_to_reminder_only_after_three_rounds: "reminderOnly",
  shared_to_no_history_after_three_rounds: "neither",
};
const transitionTargets = {
  shared_to_personal_after_three_rounds: "personal",
  shared_to_personal_entries_only_after_three_rounds: "personal",
  shared_to_reminder_only_after_three_rounds: "reminder_only",
  shared_to_no_history_after_three_rounds: "none",
};

function assert(value, message) {
  if (!value) throw new Error(message);
}

function equal(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function emptyCounts() {
  return { endorse: 0, reject: 0, uncertain: 0 };
}

function stanceCounts(states) {
  return states.reduce((counts, state) => {
    assert(["endorse", "reject", "uncertain"].includes(state.stance),
      `Unknown stance: ${state.stance}`);
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

assert(grid.grid.id === "record_removal_history_components_haiku_v2", `Wrong grid id: ${grid.grid.id}`);
assert(grid.cells.length === 96, `Expected 96 runs, found ${grid.cells.length}`);
assert(new Set(grid.cells.map((cell) => cell.summary.runId)).size === 96, "Run IDs are not unique");
assert(grid.grid.maxSteps === 66, `Expected 66 turns, found ${grid.grid.maxSteps}`);
assert(grid.grid.cellOrderSeed === 2026110701, "Frozen same-batch shuffle seed changed");

const rosterCatalog = new Map(grid.inputCatalog.rosters.map((roster) => [roster.id, roster.path]));
const byCondition = new Map([...expectedConditions].map((id) => [id, []]));
const runReports = [];

for (const cell of grid.cells) {
  assert(expectedConditions.has(cell.conditionId), `Unexpected condition: ${cell.conditionId}`);
  assert(cell.scenarioId === "blind_ego_depletion_scale12_a2_v1",
    `${cell.rosterId}: unexpected scenario ${cell.scenarioId}`);
  assert(cell.seed === 732, `${cell.rosterId}: unexpected seed ${cell.seed}`);
  assert(cell.summary.maxSteps === 66, `${cell.rosterId}: run did not retain the 66-turn plan`);
  assert(cell.manipulationCheck.passed,
    `${cell.rosterId} ${cell.conditionId}: manipulation check failed`);

  const rosterPath = rosterCatalog.get(cell.rosterId);
  assert(rosterPath, `${cell.rosterId}: missing roster path`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  assert(roster.agents.length === 12, `${cell.rosterId}: roster does not contain 12 agents`);
  assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
    `${cell.rosterId}: roster contains a non-Haiku agent`);
  const rosterAgentIds = roster.agents.map((agent) => agent.id);
  const rosterNeutralIds = rosterAgentIds.filter((agentId) => !sourceIds.has(agentId));
  assert(rosterNeutralIds.length === 10, `${cell.rosterId}: expected ten neutral agents`);
  assert(roster.agents.filter((agent) => sourceIds.has(agent.id))
    .every((agent) => agent.activeUntilStep === 36),
  `${cell.rosterId}: source exit step changed`);

  const dbPath = cell.summary.dbPath;
  assert(fs.existsSync(dbPath), `${cell.rosterId}: missing trace database`);
  const modelCalls = queryRows(dbPath, "SELECT COUNT(*) AS count FROM model_calls;")[0]?.count ?? 0;
  assert(modelCalls === 66, `${cell.rosterId} ${cell.conditionId}: expected 66 calls, found ${modelCalls}`);

  const events = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId
    FROM events WHERE event_type = 'agent_step'
    ORDER BY step_index, event_id;
  `);
  assert(events.length === 66, `${cell.rosterId}: expected 66 agent turns`);
  assert(events.every((event, index) => event.step === index + 1),
    `${cell.rosterId}: agent turns are not consecutive`);
  const sharedOrder = events.slice(0, 12).map((event) => event.agentId);
  const expectedSharedOrder = rotate(rosterAgentIds, cell.seed % rosterAgentIds.length);
  assert(equal(sharedOrder, expectedSharedOrder),
    `${cell.rosterId}: actual shared order differs from the frozen roster/seed`);
  assert(chunks(events.slice(0, 36).map((event) => event.agentId), 12)
    .every((round) => equal(round, sharedOrder)),
  `${cell.rosterId}: shared-memory rounds use different speaking orders`);
  const postEvents = events.slice(36);
  assert(postEvents.every((event) => !sourceIds.has(event.agentId)),
    `${cell.rosterId}: a source spoke after removal`);
  const expectedPostStart = (cell.seed % rosterNeutralIds.length + 36) % rosterNeutralIds.length;
  const expectedFollowupOrder = rotate(rosterNeutralIds, expectedPostStart);
  const followupEventRounds = chunks(postEvents.map((event) => event.agentId), 10);
  assert(followupEventRounds.length === 3
    && followupEventRounds.every((round) => equal(round, expectedFollowupOrder)),
  `${cell.rosterId}: follow-up does not give every neutral agent one turn per round`);

  const transitions = queryRows(dbPath, `
    SELECT step_index AS step, output_json AS outputJson
    FROM events WHERE event_type = 'memory_mode_transition';
  `);
  assert(transitions.length === 1 && transitions[0].step === 37,
    `${cell.rosterId}: expected one memory transition at step 37`);
  const transition = JSON.parse(transitions[0].outputJson);
  assert(transition.from === "shared", `${cell.rosterId}: transition did not start in shared memory`);
  assert(transition.to === transitionTargets[cell.conditionId],
    `${cell.rosterId}: wrong transition target ${transition.to}`);

  const fixedStatements = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId, output_json AS outputJson
    FROM events WHERE event_type = 'fixed_source_statement'
    ORDER BY step_index, event_id;
  `);
  assert(fixedStatements.length === 6, `${cell.rosterId}: expected six fixed-source messages`);
  assert(fixedStatements.every((row) => row.step <= 36 && sourceIds.has(row.agentId)),
    `${cell.rosterId}: fixed source spoke after removal or has the wrong author`);
  assert(fixedStatements.every((row) => {
    const output = JSON.parse(row.outputJson);
    return output.stance === "endorse" && output.text === expectedMessage;
  }), `${cell.rosterId}: fixed source message changed`);

  const entries = new Map(queryRows(dbPath, `
    SELECT memory_entry_id AS id, step_index AS step, agent_id AS agentId,
           visibility, source_type AS sourceType
    FROM memory_entries;
  `).map((entry) => [entry.id, entry]));
  const retrievals = queryRows(dbPath, `
    SELECT step_index AS step, agent_id AS agentId,
           retrieved_entry_ids_json AS idsJson, context_json AS contextJson
    FROM retrieval_traces
    ORDER BY step_index, retrieval_trace_id;
  `);
  assert(retrievals.length === 66, `${cell.rosterId}: expected 66 retrieval traces`);
  for (const row of retrievals) {
    const context = JSON.parse(row.contextJson);
    assert(context.responseParseValid !== false,
      `${cell.rosterId}: parser fallback at turn ${row.step}`);
  }

  const post = retrievals.filter((row) => row.step > 36);
  assert(post.length === 30, `${cell.rosterId}: expected 30 neutral follow-up turns`);
  assert(post.every((row) => !sourceIds.has(row.agentId)), `${cell.rosterId}: a source spoke after turn 36`);

  let postRetrievedEntries = 0;
  for (const row of post) {
    const ids = JSON.parse(row.idsJson);
    const context = JSON.parse(row.contextJson);
    const userPrompt = context.promptAudit?.userPrompt ?? "";
    assert((context.visibleEvidenceIds ?? []).length === 0,
      `${cell.rosterId}: hidden task evidence became visible after removal`);
    assert((context.interventionIds ?? []).length === 0,
      `${cell.rosterId}: unexpected intervention appeared after removal`);

    if (cell.conditionId === "shared_to_personal_after_three_rounds") {
      assert(context.priorStance !== null && context.priorConfidence !== null,
        `${cell.rosterId}: personal+prior omitted its prior judgment or confidence`);
      assert(userPrompt.includes("Your last recorded stance"),
        `${cell.rosterId}: personal+prior prompt lacks the prior-stance sentence`);
    } else if (cell.conditionId === "shared_to_personal_entries_only_after_three_rounds") {
      assert(context.priorStance === null && context.priorConfidence === null,
        `${cell.rosterId}: entries-only exposed the prior stance at turn ${row.step}`);
      assert(!userPrompt.includes("Your last recorded stance"),
        `${cell.rosterId}: entries-only prompt retained the prior-stance sentence`);
    } else if (cell.conditionId === "shared_to_reminder_only_after_three_rounds") {
      assert(context.priorStance !== null && context.priorConfidence !== null,
        `${cell.rosterId}: reminder-only omitted the prior judgment at turn ${row.step}`);
      assert(userPrompt.includes("Your last recorded stance"),
        `${cell.rosterId}: reminder-only prompt lacks the prior-stance sentence`);
      assert(ids.length === 0, `${cell.rosterId}: reminder-only retrieved a stored entry`);
    } else {
      assert(context.priorStance === null && context.priorConfidence === null,
        `${cell.rosterId}: no-history exposed the prior stance at turn ${row.step}`);
      assert(ids.length === 0, `${cell.rosterId}: no-history retrieved record entries`);
      assert(!userPrompt.includes("Your last recorded stance"),
        `${cell.rosterId}: no-history prompt retained the prior-stance sentence`);
    }

    if (cell.conditionId !== "shared_to_no_history_after_three_rounds"
      && cell.conditionId !== "shared_to_reminder_only_after_three_rounds") {
      for (const id of ids) {
        const entry = entries.get(id);
        assert(entry, `${cell.rosterId}: retrieved unknown entry ${id}`);
        assert(entry.agentId === row.agentId,
          `${cell.rosterId}: ${row.agentId} retrieved ${entry.agentId}'s entry in the personal phase`);
        assert(entry.step < row.step, `${cell.rosterId}: retrieved a future or same-turn entry`);
        assert(entry.sourceType === "agent", `${cell.rosterId}: personal phase retrieved non-agent content`);
      }
      postRetrievedEntries += ids.length;
    }
  }

  if (cell.conditionId === "shared_to_personal_after_three_rounds"
    || cell.conditionId === "shared_to_personal_entries_only_after_three_rounds") {
    const eligibleEntriesAtRemoval = [...entries.values()].filter((entry) =>
      entry.step <= 36 && !sourceIds.has(entry.agentId) && entry.sourceType === "agent");
    if (eligibleEntriesAtRemoval.length > 0) {
      assert(postRetrievedEntries > 0,
        `${cell.rosterId}: ${conditionKeys[cell.conditionId]} retrieved no self-authored entries despite having eligible entries`);
    }
  }

  const postEntries = [...entries.values()].filter((entry) => entry.step > 36);
  if (cell.conditionId === "shared_to_no_history_after_three_rounds"
    || cell.conditionId === "shared_to_reminder_only_after_three_rounds") {
    assert(postEntries.length === 0,
      `${cell.rosterId}: entry-free follow-up wrote memory entries`);
  } else {
    assert(postEntries.every((entry) => entry.visibility === "personal" && !sourceIds.has(entry.agentId)),
      `${cell.rosterId}: personal follow-up wrote a shared or source-authored entry`);
  }

  const stateRows = queryRows(dbPath, `
    SELECT state_id AS stateId, step_index AS step, agent_id AS agentId, stance, confidence
    FROM agent_claim_states
    WHERE claim_id = '${claimId}' AND agent_id NOT IN ('analyst_1', 'analyst_7')
    ORDER BY step_index, state_id;
  `);
  const neutralIds = [...new Set(stateRows.map((state) => state.agentId))];
  assert(neutralIds.length === 10, `${cell.rosterId}: expected ten neutral agents`);
  assert(neutralIds.every((agentId) => rosterNeutralIds.includes(agentId)),
    `${cell.rosterId}: claim states contain an agent outside the neutral roster`);

  const atRemovalByAgent = new Map();
  const postStatesByAgent = new Map(neutralIds.map((agentId) => [agentId, []]));
  for (const state of stateRows) {
    if (state.step <= 36) {
      atRemovalByAgent.set(state.agentId, state);
    } else {
      postStatesByAgent.get(state.agentId)?.push(state);
    }
  }
  assert(atRemovalByAgent.size === 10, `${cell.rosterId}: missing a neutral judgment at removal`);
  assert([...postStatesByAgent.values()].every((states) => states.length === 3),
    `${cell.rosterId}: each neutral agent must have three judgments after removal`);

  const followupRounds = [0, 1, 2].map((roundIndex) =>
    neutralIds.map((agentId) => postStatesByAgent.get(agentId)[roundIndex]));
  const preRemovalNeutralStates = stateRows
    .filter((state) => state.step <= 36)
    .map(({ step, agentId, stance, confidence }) => ({ step, agentId, stance, confidence }));

  const report = {
    condition: conditionKeys[cell.conditionId],
    conditionId: cell.conditionId,
    rosterId: cell.rosterId,
    runId: cell.summary.runId,
    dbPath,
    modelCalls,
    sharedOrder,
    followupOrder: expectedFollowupOrder,
    postRetrievedEntries,
    preRemovalNeutralStates,
    atRemoval: stanceCounts([...atRemovalByAgent.values()]),
    round1: stanceCounts(followupRounds[0]),
    round2: stanceCounts(followupRounds[1]),
    round3: stanceCounts(followupRounds[2]),
  };
  byCondition.get(cell.conditionId).push(report);
  runReports.push(report);
}

for (const [conditionId, runs] of byCondition) {
  assert(runs.length === 24, `${conditionId}: expected 24 matched orders, found ${runs.length}`);
  assert(new Set(runs.map((run) => run.rosterId)).size === 24,
    `${conditionId}: speaking-order identifiers are not unique`);
}

const rosterSets = [...byCondition.values()].map((runs) =>
  [...runs.map((run) => run.rosterId)].sort().join("\n"),
);
assert(rosterSets.every((set) => set === rosterSets[0]), "Conditions do not share the same 24 speaking orders");

const stageFields = {
  atRemoval: "atRemoval",
  followupTurn1: "round1",
  followupTurn2: "round2",
  followupTurn3: "round3",
};

function aggregateRuns(runs) {
  const stages = Object.fromEntries(Object.entries(stageFields).map(([label, field]) => [
    label,
    runs.reduce((total, run) => addCounts(total, run[field]), emptyCounts()),
  ]));
  const ordersWithAnyEndorsement = Object.fromEntries(
    Object.entries(stageFields).map(([label, field]) => [
      label,
      runs.filter((run) => run[field].endorse > 0).length,
    ]),
  );
  for (const [label, counts] of Object.entries(stages)) {
    assert(counts.endorse + counts.reject + counts.uncertain === 240,
      `${runs[0].condition}: ${label} does not contain 240 neutral judgments`);
  }
  return {
    runs: runs.length,
    neutralJudgmentsPerStage: 240,
    modelCalls: runs.reduce((sum, run) => sum + run.modelCalls, 0),
    postRetrievedEntries: runs.reduce((sum, run) => sum + run.postRetrievedEntries, 0),
    stages,
    ordersWithAnyEndorsement,
  };
}

const runsByRoster = new Map();
for (const run of runReports) {
  const matched = runsByRoster.get(run.rosterId) ?? {};
  assert(!matched[run.condition], `${run.rosterId}: duplicate ${run.condition} run`);
  matched[run.condition] = run;
  runsByRoster.set(run.rosterId, matched);
}
const armKeys = ["both", "entriesOnly", "reminderOnly", "neither"];
assert([...runsByRoster.values()].every((matched) => armKeys.every((arm) => matched[arm])),
  "Every speaking order must contain all four history versions");

const preRemovalDeviations = [];
for (const [rosterId, matched] of runsByRoster) {
  const reference = matched.both.preRemovalNeutralStates;
  const referenceJson = JSON.stringify(reference);
  for (const arm of armKeys.filter((key) => key !== "both")) {
    const candidate = matched[arm].preRemovalNeutralStates;
    if (JSON.stringify(candidate) === referenceJson) continue;
    const comparedLength = Math.max(reference.length, candidate.length);
    let firstDifference = null;
    for (let index = 0; index < comparedLength; index += 1) {
      if (JSON.stringify(reference[index]) !== JSON.stringify(candidate[index])) {
        firstDifference = {
          index,
          both: reference[index] ?? null,
          [arm]: candidate[index] ?? null,
        };
        break;
      }
    }
    preRemovalDeviations.push({
      rosterId,
      comparedArms: ["both", arm],
      bothStateCount: reference.length,
      comparedStateCount: candidate.length,
      firstDifference,
    });
  }
}

const pairedByRoster = [...runsByRoster.entries()]
  .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
  .map(([rosterId, matched]) => ({
    rosterId,
    stages: Object.fromEntries(Object.entries(stageFields).map(([label, field]) => [
      label,
      Object.fromEntries(armKeys.map((arm) => [arm, matched[arm][field]])),
    ])),
  }));

function comparePair(left, right) {
  return {
    left,
    right,
    stages: Object.fromEntries(Object.keys(stageFields).map((stage) => {
      const leftTotal = pairedByRoster.reduce(
        (sum, pair) => sum + pair.stages[stage][left].endorse, 0);
      const rightTotal = pairedByRoster.reduce(
        (sum, pair) => sum + pair.stages[stage][right].endorse, 0);
      const leftHigher = pairedByRoster.filter(
        (pair) => pair.stages[stage][left].endorse > pair.stages[stage][right].endorse,
      ).length;
      const rightHigher = pairedByRoster.filter(
        (pair) => pair.stages[stage][left].endorse < pair.stages[stage][right].endorse,
      ).length;
      const ties = pairedByRoster.length - leftHigher - rightHigher;
      return [stage, {
        leftEndorsements: leftTotal,
        rightEndorsements: rightTotal,
        leftMinusRight: leftTotal - rightTotal,
        leftHigherOrders: leftHigher,
        rightHigherOrders: rightHigher,
        tiedOrders: ties,
        nonTiedOrders: leftHigher + rightHigher,
        exactTwoSidedSignP: exactTwoSidedSignP(leftHigher, rightHigher),
      }];
    })),
  };
}

const pairwiseComparisons = {
  bothVsEntriesOnly: comparePair("both", "entriesOnly"),
  bothVsReminderOnly: comparePair("both", "reminderOnly"),
  bothVsNeither: comparePair("both", "neither"),
  entriesOnlyVsReminderOnly: comparePair("entriesOnly", "reminderOnly"),
  entriesOnlyVsNeither: comparePair("entriesOnly", "neither"),
  reminderOnlyVsNeither: comparePair("reminderOnly", "neither"),
};

const conditionSummaries = Object.fromEntries([...byCondition].map(([id, runs]) => [
  conditionKeys[id],
  { conditionId: id, ...aggregateRuns(runs) },
]));

const report = {
  generatedAt: new Date().toISOString(),
  passed: preRemovalDeviations.length === 0,
  gridPath,
  plannedRuns: 96,
  observedRuns: grid.cells.length,
  plannedModelCalls: 6336,
  observedModelCalls: runReports.reduce((sum, run) => sum + run.modelCalls, 0),
  checks: {
    matchedSpeakingOrders: true,
    bothRetrievedSelfAuthoredPastEntries: true,
    bothPriorJudgmentPresent: true,
    entriesOnlyRetrievedSelfAuthoredPastEntries: true,
    entriesOnlyPriorStanceNull: true,
    reminderOnlyRetrievedNothing: true,
    reminderOnlyPriorStancePresent: true,
    noHistoryRetrievedNothing: true,
    fourVersionsShareSpeakingOrders: true,
    preRemovalNeutralStatesMatchExactly: preRemovalDeviations.length === 0,
    neutralJudgmentCountsComplete: true,
  },
  conditions: conditionSummaries,
  preRemovalDeviations,
  pairwiseComparisons,
  pairedByRoster,
  runs: runReports,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  passed: report.passed,
  observedRuns: report.observedRuns,
  observedModelCalls: report.observedModelCalls,
  checks: report.checks,
  conditions: report.conditions,
  pairwiseComparisons: report.pairwiseComparisons,
  outputPath,
}, null, 2));
if (!report.passed) process.exitCode = 1;
