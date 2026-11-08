import fs from "fs";
import os from "os";
import path from "path";

import { queryRows } from "../src/db/sqlite.ts";
import { runExperimentSync } from "../src/engine/run.ts";

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-depth-preflight-"));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function runConfig({ id, scenario, condition, roster, maxSteps, maxModelCalls }) {
  const config = {
    id,
    title: id,
    scenarioPath: path.join(root, scenario),
    conditionPath: path.join(root, condition),
    seed: 0,
    maxSteps,
    budget: { maxModelCalls, maxOutputTokensPerCall: 128, temperature: 0 },
    agents: readJson(roster).agents,
    outputDir: tempRoot,
  };
  const configPath = path.join(tempRoot, `${id}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return runExperimentSync(configPath, { outputRootOverride: tempRoot });
}

const correctionCondition = "conditions/lockin-depth-v1/shared-memory-fixed-mechanism-equal-correction-followup.yaml";
const baseRoster = "rosters/content-factorial-v1/content_order_01.json";
const exitRoster = "rosters/lockin-depth-v1/lockin_depth_order_01.json";

const early = runConfig({
  id: "preflight_early",
  scenario: "scenarios/lockin-depth-v1/ego-depletion-early-correction-step12.yaml",
  condition: correctionCondition,
  roster: baseRoster,
  maxSteps: 54,
  maxModelCalls: 54,
});
const late = runConfig({
  id: "preflight_late",
  scenario: "scenarios/lockin-depth-v1/ego-depletion-late-correction-step30.yaml",
  condition: correctionCondition,
  roster: baseRoster,
  maxSteps: 54,
  maxModelCalls: 54,
});

function correctionCheck(summary, expectedCorrectionStep, expectedFinalStep) {
  const steps = queryRows(summary.dbPath, "SELECT MAX(step_index) AS finalStep FROM agent_claim_states;");
  assert(steps[0].finalStep === expectedFinalStep, `expected final step ${expectedFinalStep}, got ${steps[0].finalStep}`);
  const interventions = queryRows(summary.dbPath, "SELECT step_index AS step FROM interventions;");
  assert(interventions.length === 1 && interventions[0].step === expectedCorrectionStep, "correction step mismatch");
  const exposed = queryRows(
    summary.dbPath,
    `SELECT COUNT(*) AS count FROM events WHERE event_type = 'agent_step' AND step_index >= ${expectedCorrectionStep};`,
  );
  assert(exposed[0].count === 24, `expected 24 correction-visible turns, got ${exposed[0].count}`);
}

correctionCheck(early, 12, 35);
correctionCheck(late, 30, 53);

const personal = runConfig({
  id: "preflight_personal",
  scenario: "scenarios/blind_ego_depletion_scale12_a2_v1.yaml",
  condition: "conditions/lockin-depth-v1/shared-to-personal-after-three-rounds.yaml",
  roster: exitRoster,
  maxSteps: 66,
  maxModelCalls: 66,
});
const noHistory = runConfig({
  id: "preflight_no_history",
  scenario: "scenarios/blind_ego_depletion_scale12_a2_v1.yaml",
  condition: "conditions/lockin-depth-v1/shared-to-no-history-after-three-rounds.yaml",
  roster: exitRoster,
  maxSteps: 66,
  maxModelCalls: 66,
});

function persistenceCheck(summary, expectedMode) {
  const transitions = queryRows(
    summary.dbPath,
    "SELECT step_index AS step, output_json AS outputJson FROM events WHERE event_type = 'memory_mode_transition';",
  );
  assert(transitions.length === 1 && transitions[0].step === 37, "missing turn-37 memory transition");
  assert(JSON.parse(transitions[0].outputJson).to === expectedMode, "wrong transition mode");
  const postSourceTurns = queryRows(
    summary.dbPath,
    "SELECT COUNT(*) AS count FROM events WHERE event_type = 'agent_step' AND step_index > 36 AND agent_id IN ('analyst_1','analyst_7');",
  );
  assert(postSourceTurns[0].count === 0, "a fixed-message source spoke after turn 36");
  const neutralCounts = queryRows(
    summary.dbPath,
    "SELECT agent_id AS agentId, COUNT(*) AS count FROM events WHERE event_type = 'agent_step' AND step_index > 36 GROUP BY agent_id;",
  );
  assert(neutralCounts.length === 10 && neutralCounts.every((row) => row.count === 3), "neutral follow-up is not three turns each");
}

persistenceCheck(personal, "personal");
persistenceCheck(noHistory, "none");

const personalRetrievals = queryRows(
  personal.dbPath,
  "SELECT agent_id AS agentId, retrieved_entry_ids_json AS ids FROM retrieval_traces WHERE step_index > 36;",
);
const personalEntries = new Map(queryRows(
  personal.dbPath,
  "SELECT memory_entry_id AS id, agent_id AS agentId FROM memory_entries;",
).map((row) => [row.id, row.agentId]));
assert(personalRetrievals.every((row) => JSON.parse(row.ids).every((id) => personalEntries.get(id) === row.agentId)),
  "personal phase exposed another agent's entry");

const noHistoryRetrievals = queryRows(
  noHistory.dbPath,
  "SELECT retrieved_entry_ids_json AS ids FROM retrieval_traces WHERE step_index > 36;",
);
assert(noHistoryRetrievals.every((row) => JSON.parse(row.ids).length === 0), "no-history phase retrieved a record entry");

const report = {
  passed: true,
  correction: {
    early: { correctionStep: 12, finalStep: 35, correctionVisibleTurns: 24 },
    late: { correctionStep: 30, finalStep: 53, correctionVisibleTurns: 24 },
  },
  persistence: {
    transitionStep: 37,
    neutralAgents: 10,
    followupTurnsPerNeutral: 3,
    personalRetrievalsOwnEntriesOnly: true,
    noHistoryRetrievalsEmpty: true,
  },
};
const reportPath = path.join(root, "analysis", "lockin-depth-v1-preflight.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
fs.rmSync(tempRoot, { recursive: true, force: true });
