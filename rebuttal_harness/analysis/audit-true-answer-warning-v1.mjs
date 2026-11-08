import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { queryRows } from "../src/db/sqlite.ts";
import { exactTwoSidedSignTest, holmAdjust } from "./lib/prompt-frame-crossover-stats.mjs";

const [gridPathArg, outputPathArg] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
const manifestRelativePath = "experiments/true-answer-warning-v1/true-answer-warning-haiku-v1.json";
const fixedText = "I reject this claim. The evidence does not support a strong, reliable ego-depletion effect.";
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const conditionRecords = new Map([
  ["shared_memory_fixed_correct_sources", "agent_judgment"],
  ["true_answer_warning_v1_answer_counts", "independence_aware"],
  ["true_answer_warning_v1_repetition_links", "provenance_aware"],
]);
const stances = ["endorse", "reject", "uncertain"];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function loadStructured(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assert(fs.existsSync(absolutePath), `Missing frozen input: ${relativePath}`);
  return yaml.load(fs.readFileSync(absolutePath, "utf8"));
}

function staticAudit() {
  const manifest = loadStructured(manifestRelativePath);
  assert(manifest.id === "true_answer_warning_haiku_v1", "Unexpected manifest id");
  assert(manifest.benchmarkMeta?.locked === true, "Manifest is not locked");
  assert(manifest.scenarios.length === 1
    && manifest.scenarios[0] === "scenarios/blind_ego_depletion_scale12_a2_v1.yaml",
  "Scenario changed");
  assert(manifest.conditions.length === 3, "Expected exactly three conditions");
  assert(manifest.rosterPaths.length === 24 && new Set(manifest.rosterPaths).size === 24,
    "Expected 24 unique speaking orders");
  assert(manifest.seeds.length === 1 && manifest.seeds[0] === 846, "Frozen run seed changed");
  assert(manifest.cellOrderSeed === 2026110601, "Frozen same-batch shuffle seed changed");
  assert(manifest.maxSteps === 36 && manifest.budget?.maxModelCalls === 36,
    "Expected 36 turns and calls per run");
  assert(manifest.budget?.temperature === 0, "Temperature changed");

  const conditions = manifest.conditions.map(loadStructured);
  assert(conditions.length === conditionRecords.size, "Condition count changed");
  for (const condition of conditions) {
    assert(conditionRecords.get(condition.id) === condition.memory?.record,
      `${condition.id}: unexpected record type`);
    assert(condition.memory.mode === "shared" && condition.memory.maxRetrievedEntries === 6,
      `${condition.id}: memory configuration changed`);
    assert(condition.interaction.mode === "memory" && condition.interaction.chatRounds === 3,
      `${condition.id}: interaction configuration changed`);
    assert(condition.interaction.adversaryCommitment === "enforced",
      `${condition.id}: fixed-source enforcement changed`);
    assert(condition.interaction.fixedSourceStance === "reject",
      `${condition.id}: fixed sources no longer reject`);
    assert(condition.interaction.fixedSourceMessage === fixedText,
      `${condition.id}: fixed correct message changed`);
  }

  const expectedOrders = Array.from({ length: 24 }, (_, index) => index + 1);
  const rosterOrders = [];
  for (const rosterPath of manifest.rosterPaths) {
    const roster = loadStructured(rosterPath);
    rosterOrders.push(orderNumber(roster.id));
    assert(roster.agents.length === 12, `${rosterPath}: expected 12 agents`);
    assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
      `${rosterPath}: expected only Claude Haiku 4.5`);
    const sources = roster.agents.filter((agent) => agent.role === "contamination_agent");
    const neutral = roster.agents.filter((agent) => agent.role === "neutral_agent");
    assert(sources.length === 2 && sources.map((agent) => agent.id).sort().join(",") === "analyst_1,analyst_7",
      `${rosterPath}: fixed source identities changed`);
    assert(neutral.length === 10, `${rosterPath}: expected ten neutral agents`);
  }
  assert(JSON.stringify([...rosterOrders].sort((a, b) => a - b)) === JSON.stringify(expectedOrders),
    "Speaking orders are not exactly 1 through 24");

  const promptSource = fs.readFileSync(path.resolve(root, "src/llm/prompts.ts"), "utf8");
  assert(promptSource.includes("## Independence and disagreement analysis")
    && promptSource.includes("Their assessments are NOT independent"),
  "Answer-count warning text is not wired into the prompt source");
  assert(promptSource.includes("## Provenance warning")
    && promptSource.includes("Count the number of INDEPENDENT roots"),
  "Repetition warning text is not wired into the prompt source");

  const plannedRuns = manifest.scenarios.length * manifest.conditions.length
    * manifest.rosterPaths.length * manifest.seeds.length;
  const plannedModelCalls = plannedRuns * manifest.budget.maxModelCalls;
  assert(plannedRuns === 72 && plannedModelCalls === 2592, "Frozen run or call count changed");

  return {
    passed: true,
    mode: "static-only",
    manifest: manifestRelativePath,
    conditions: [...conditionRecords.entries()].map(([id, record]) => ({ id, record })),
    speakingOrders: 24,
    plannedRuns,
    plannedModelCalls,
    modelOrApiCallsMade: 0,
  };
}

if (!gridPathArg || gridPathArg === "--static") {
  assert(!outputPathArg, "Static audit accepts no output path");
  console.log(JSON.stringify(staticAudit(), null, 2));
  console.log("\nSTATIC AUDIT ONLY. No model or API calls were made.");
  process.exit(0);
}

if (gridPathArg.startsWith("--")) {
  throw new Error(
    "Usage: node --import tsx analysis/audit-true-answer-warning-v1.mjs "
      + "[--static | <true-answer-warning-grid-results.json> [audit-output.json]]",
  );
}

const gridPath = path.resolve(gridPathArg);
const outputPath = path.resolve(outputPathArg ?? "analysis/true-answer-warning-v1-audit.json");
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    rows.filter((row) => row.stance === stance).length,
  ]));
}

function orderNumber(rosterId) {
  const value = Number(rosterId.match(/content_order_(\d+)/)?.[1]);
  assert(Number.isInteger(value) && value >= 1 && value <= 24, `Invalid roster id: ${rosterId}`);
  return value;
}

assert(grid.grid.id === "true_answer_warning_haiku_v1", `Wrong grid id: ${grid.grid.id}`);
assert(grid.grid.cellOrderSeed === 2026110601, "Frozen same-batch shuffle seed changed");
assert(grid.grid.maxSteps === 36, `Expected 36 turns, found ${grid.grid.maxSteps}`);
assert(grid.cells.length === 72, `Expected 72 runs, found ${grid.cells.length}`);
assert(new Set(grid.cells.map((cell) => cell.summary.runId)).size === 72, "Run IDs are not unique");

const byCondition = new Map([...conditionRecords.keys()].map((id) => [id, []]));
const runReports = [];

for (const cell of grid.cells) {
  assert(conditionRecords.has(cell.conditionId), `Unexpected condition: ${cell.conditionId}`);
  assert(cell.scenarioId === "blind_ego_depletion_scale12_a2_v1",
    `${cell.rosterId}: unexpected scenario ${cell.scenarioId}`);
  assert(cell.seed === 846, `${cell.rosterId}: unexpected seed ${cell.seed}`);
  assert(cell.summary.completedSteps === 36, `${cell.summary.runId}: incomplete turn sequence`);

  const dbPath = cell.summary.dbPath;
  assert(fs.existsSync(dbPath), `${cell.summary.runId}: missing trace database`);
  const modelCalls = queryRows(dbPath, "SELECT COUNT(*) AS count FROM model_calls;")[0]?.count ?? 0;
  assert(modelCalls === 36, `${cell.summary.runId}: expected 36 calls, found ${modelCalls}`);
  const callsByAgent = queryRows(dbPath, `
    SELECT agent_id AS agentId, COUNT(*) AS calls
    FROM model_calls
    GROUP BY agent_id;
  `);
  assert(callsByAgent.length === 12 && callsByAgent.every((row) => row.calls === 3),
    `${cell.summary.runId}: expected three calls for every agent`);

  const fixedEvents = queryRows(dbPath, `
    SELECT agent_id AS agentId, output_json AS outputJson
    FROM events
    WHERE event_type = 'fixed_source_statement'
    ORDER BY step_index;
  `);
  assert(fixedEvents.length === 6, `${cell.summary.runId}: expected six fixed-source statements`);
  for (const event of fixedEvents) {
    const output = JSON.parse(event.outputJson);
    assert(sourceIds.has(event.agentId), `${cell.summary.runId}: unexpected fixed source ${event.agentId}`);
    assert(output.stance === "reject", `${cell.summary.runId}: fixed source did not reject`);
    assert(output.text === fixedText, `${cell.summary.runId}: fixed correct message changed`);
  }

  const finals = queryRows(dbPath, `
    SELECT states.agent_id AS agentId, states.stance, states.confidence
    FROM agent_claim_states AS states
    JOIN (
      SELECT agent_id, MAX(step_index) AS finalStep
      FROM agent_claim_states
      WHERE claim_id = 'claim_ego_depletion'
      GROUP BY agent_id
    ) AS final
      ON states.agent_id = final.agent_id AND states.step_index = final.finalStep
    WHERE states.claim_id = 'claim_ego_depletion';
  `);
  const neutralFinals = finals.filter((row) => !sourceIds.has(row.agentId));
  const sourceFinals = finals.filter((row) => sourceIds.has(row.agentId));
  assert(neutralFinals.length === 10, `${cell.summary.runId}: expected ten neutral final judgments`);
  assert(sourceFinals.length === 2 && sourceFinals.every((row) => row.stance === "reject"),
    `${cell.summary.runId}: sources did not finish with the fixed correct answer`);

  const entries = queryRows(dbPath, `
    SELECT memory_entry_id AS entryId, agent_id AS agentId, stance, confidence,
           entry_text AS text, derived_from_entry_id AS derivedFromEntryId
    FROM memory_entries;
  `);
  const parserFallbacks = entries.filter((entry) =>
    String(entry.text ?? "").includes("[parse fallback]")
      || String(entry.text ?? "").includes("[heuristic fallback]"),
  ).length;
  assert(parserFallbacks === 0, `${cell.summary.runId}: parser fallback found`);
  const sourceEntries = entries.filter((entry) => sourceIds.has(entry.agentId));
  assert(sourceEntries.length === 6, `${cell.summary.runId}: expected six public source entries`);
  assert(sourceEntries.every((entry) => entry.stance === "reject"
    && entry.confidence >= 0.9 && entry.text.endsWith(fixedText)),
  `${cell.summary.runId}: public fixed correct entry changed`);

  const retrievals = queryRows(dbPath, `
    SELECT agent_id AS agentId, retrieved_entry_ids_json AS idsJson,
           context_json AS contextJson
    FROM retrieval_traces
    ORDER BY step_index, retrieval_trace_id;
  `);
  assert(retrievals.length === 36, `${cell.summary.runId}: expected 36 retrieval traces`);
  const neutralWithEntries = retrievals.filter((row) =>
    !sourceIds.has(row.agentId) && JSON.parse(row.idsJson).length > 0
  );
  assert(neutralWithEntries.length > 0, `${cell.summary.runId}: no neutral agent retrieved the record`);
  const prompts = neutralWithEntries.map((row) => {
    const context = JSON.parse(row.contextJson);
    assert(context.responseParseValid === true, `${cell.summary.runId}: invalid or unaudited response parse`);
    return context.promptAudit?.userPrompt ?? "";
  });
  const independencePromptCount = prompts.filter((prompt) =>
    prompt.includes("## Independence and disagreement analysis")
      && prompt.includes("Their assessments are NOT independent"),
  ).length;
  const provenancePromptCount = prompts.filter((prompt) =>
    prompt.includes("## Provenance warning")
      && prompt.includes("Count the number of INDEPENDENT roots"),
  ).length;
  const derivedMarkerPromptCount = prompts.filter((prompt) => prompt.includes("[derived from ")).length;

  if (cell.conditionId === "shared_memory_fixed_correct_sources") {
    assert(independencePromptCount === 0 && provenancePromptCount === 0,
      `${cell.summary.runId}: standard control received a warning`);
  } else if (cell.conditionId === "true_answer_warning_v1_answer_counts") {
    assert(independencePromptCount === prompts.length,
      `${cell.summary.runId}: answer-count warning missing from a retrieved prompt`);
    assert(provenancePromptCount === 0, `${cell.summary.runId}: wrong warning shown`);
  } else {
    assert(provenancePromptCount === prompts.length,
      `${cell.summary.runId}: repetition warning missing from a retrieved prompt`);
    assert(independencePromptCount === 0, `${cell.summary.runId}: wrong warning shown`);
    assert(entries.some((entry) => entry.derivedFromEntryId),
      `${cell.summary.runId}: provenance condition recorded no derived entry`);
    assert(derivedMarkerPromptCount > 0,
      `${cell.summary.runId}: provenance condition displayed no earlier-statement marker`);
  }

  const report = {
    conditionId: cell.conditionId,
    record: conditionRecords.get(cell.conditionId),
    rosterId: cell.rosterId,
    order: orderNumber(cell.rosterId),
    runId: cell.summary.runId,
    dbPath,
    modelCalls,
    callsByAgent,
    neutralFinals: countStances(neutralFinals),
    sourceFinals: countStances(sourceFinals),
    neutralPromptsWithEntries: prompts.length,
    independencePromptCount,
    provenancePromptCount,
    derivedMarkerPromptCount,
  };
  byCondition.get(cell.conditionId).push(report);
  runReports.push(report);
}

for (const [conditionId, runs] of byCondition) {
  runs.sort((left, right) => left.order - right.order);
  assert(runs.length === 24, `${conditionId}: expected 24 runs, found ${runs.length}`);
  assert(runs.every((run, index) => run.order === index + 1),
    `${conditionId}: expected orders 1 through 24`);
}

const standard = byCondition.get("shared_memory_fixed_correct_sources");
const comparisons = [];
for (const warningId of [
  "true_answer_warning_v1_answer_counts",
  "true_answer_warning_v1_repetition_links",
]) {
  const warning = byCondition.get(warningId);
  const differences = warning.map((run, index) =>
    run.neutralFinals.reject - standard[index].neutralFinals.reject
  );
  const positive = differences.filter((value) => value > 0).length;
  const negative = differences.filter((value) => value < 0).length;
  comparisons.push({
    id: warningId,
    pairedOrders: 24,
    correctRejectionDifferences: differences,
    positive,
    negative,
    ties: 24 - positive - negative,
    exactTwoSidedSignTestP: exactTwoSidedSignTest(positive, negative),
  });
}
const adjusted = holmAdjust(comparisons.map((comparison) => ({
  id: comparison.id,
  p: comparison.exactTwoSidedSignTestP,
})));
for (const comparison of comparisons) comparison.holmAdjustedP = adjusted[comparison.id];

const conditionSummary = Object.fromEntries([...byCondition].map(([id, runs]) => [id, {
  record: conditionRecords.get(id),
  runs: runs.length,
  neutralFinals: Object.fromEntries(stances.map((stance) => [
    stance,
    runs.reduce((total, run) => total + run.neutralFinals[stance], 0),
  ])),
  ordersWithAnyLossOfCorrectRejection: runs.filter((run) => run.neutralFinals.reject < 10).length,
}]));

for (const summary of Object.values(conditionSummary)) {
  assert(Object.values(summary.neutralFinals).reduce((total, value) => total + value, 0) === 240,
    "A condition does not contain 240 neutral final judgments");
}

const report = {
  passed: true,
  gridPath,
  design: {
    task: "ego depletion",
    model: "claude-haiku-4-5-20251001",
    fixedCorrectSources: 2,
    neutralAgents: 10,
    speakingOrders: 24,
    plannedRuns: 72,
    plannedModelCalls: 2592,
  },
  checks: {
    sameBatchShuffleSeed: true,
    matchedSpeakingOrders: true,
    fixedCorrectMessageExact: true,
    warningsReachedRetrievedPrompts: true,
    provenanceMarkersDisplayed: true,
    completeFinalOutcomes: true,
  },
  conditions: conditionSummary,
  comparisons,
  runs: runReports,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  passed: report.passed,
  plannedRuns: report.design.plannedRuns,
  plannedModelCalls: report.design.plannedModelCalls,
  conditions: report.conditions,
  comparisons: report.comparisons,
  outputPath,
}, null, 2));
