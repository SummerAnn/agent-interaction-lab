import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { queryRows } from "../src/db/sqlite.ts";
import {
  bootstrapIndexMatrix,
  clusterBootstrapMeanInterval,
  exactTwoSidedSignTest,
  mean,
  median,
} from "./lib/prompt-frame-crossover-stats.mjs";

const [gridPathArg, outputPathArg] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
const manifestRelativePath = "experiments/confidence-display-ablation-haiku-scale12-v1.json";
const standardId = "content_mechanism_shared_memory";
const hiddenId = "content_mechanism_shared_memory_confidence_hidden";
const conditionIds = [standardId, hiddenId];
const sourceIds = new Set(["analyst_1", "analyst_7"]);
const fixedText = "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";
const stances = ["endorse", "reject", "uncertain"];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function loadStructured(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assert(fs.existsSync(absolutePath), `Missing frozen input: ${relativePath}`);
  return yaml.load(fs.readFileSync(absolutePath, "utf8"));
}

function orderNumber(rosterId) {
  const value = Number(rosterId.match(/content_order_(\d+)/)?.[1]);
  assert(Number.isInteger(value) && value >= 1 && value <= 24, `Invalid roster id: ${rosterId}`);
  return value;
}

function countStances(rows) {
  return Object.fromEntries(stances.map((stance) => [
    stance,
    rows.filter((row) => row.stance === stance).length,
  ]));
}

function retrievedRecordSection(prompt) {
  const marker = "## Retrieved record\n\n";
  const start = prompt.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const end = prompt.indexOf("\n\n## ", contentStart);
  return prompt.slice(contentStart, end < 0 ? prompt.length : end);
}

function shuffledCellKeys(manifest) {
  const raw = [];
  for (const conditionPath of manifest.conditions) {
    const condition = loadStructured(conditionPath);
    for (const rosterPath of manifest.rosterPaths) {
      const roster = loadStructured(rosterPath);
      for (const seed of manifest.seeds) raw.push(`${condition.id}:${roster.id}:${seed}`);
    }
  }
  let state = (manifest.cellOrderSeed >>> 0) || 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = raw.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [raw[index], raw[target]] = [raw[target], raw[index]];
  }
  return raw;
}

function staticAudit() {
  const manifest = loadStructured(manifestRelativePath);
  assert(manifest.id === "confidence_display_ablation_haiku_scale12_v1", "Unexpected manifest id");
  assert(manifest.benchmarkMeta?.status === "supporting" && manifest.benchmarkMeta?.locked === true,
    "Manifest must be a locked supporting study");
  assert(manifest.scenarios.length === 1
    && manifest.scenarios[0] === "scenarios/blind_ego_depletion_scale12_a2_v1.yaml",
  "Scenario changed");
  assert(JSON.stringify(manifest.conditions) === JSON.stringify([
    "conditions/content-factorial-v1/content_mechanism_shared_memory.yaml",
    "conditions/content-factorial-v1/content_mechanism_shared_memory_confidence_hidden.yaml",
  ]), "Condition paths or order changed");
  assert(manifest.rosterPaths.length === 24 && new Set(manifest.rosterPaths).size === 24,
    "Expected 24 unique speaking orders");
  assert(manifest.seeds.length === 1 && manifest.seeds[0] === 61106, "Frozen run seed changed");
  assert(manifest.cellOrderSeed === 20261106, "Frozen cell-order seed changed");
  assert(manifest.maxSteps === 36 && manifest.budget?.maxModelCalls === 36,
    "Expected 36 turns and calls per execution");
  assert(manifest.budget?.temperature === 0, "Temperature changed");

  const [standard, hidden] = manifest.conditions.map(loadStructured);
  assert(standard.id === standardId && hidden.id === hiddenId, "Unexpected condition ids");
  assert(standard.memory?.showConfidenceScores === undefined,
    "Standard arm must retain the legacy default rather than override it");
  assert(hidden.memory?.showConfidenceScores === false,
    "Hidden arm does not hide saved confidence scores");
  const normalize = (value) => {
    const copy = structuredClone(value);
    delete copy.id;
    delete copy.title;
    delete copy.memory.showConfidenceScores;
    return copy;
  };
  assert(JSON.stringify(normalize(standard)) === JSON.stringify(normalize(hidden)),
    "Conditions differ in more than id, title, and confidence display");
  for (const condition of [standard, hidden]) {
    assert(condition.memory.mode === "shared"
      && condition.memory.record === "agent_judgment"
      && condition.memory.maxRetrievedEntries === 6,
    `${condition.id}: shared-memory configuration changed`);
    assert(condition.interaction.mode === "memory"
      && condition.interaction.chatRounds === 3
      && condition.interaction.adversaryCommitment === "enforced",
    `${condition.id}: interaction configuration changed`);
    assert(condition.interaction.fixedSourceMessage === fixedText,
      `${condition.id}: fixed source message changed`);
  }

  const rosterOrders = [];
  for (const rosterPath of manifest.rosterPaths) {
    const roster = loadStructured(rosterPath);
    rosterOrders.push(orderNumber(roster.id));
    assert(roster.agents.length === 12, `${rosterPath}: expected 12 agents`);
    assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
      `${rosterPath}: expected only Claude Haiku 4.5`);
    assert(roster.agents.filter((agent) => agent.role === "contamination_agent").length === 2,
      `${rosterPath}: expected two liar agents`);
    assert(roster.agents.filter((agent) => agent.role === "neutral_agent").length === 10,
      `${rosterPath}: expected ten neutral agents`);
  }
  assert(JSON.stringify(rosterOrders.sort((a, b) => a - b))
    === JSON.stringify(Array.from({ length: 24 }, (_, index) => index + 1)),
  "Speaking orders are not exactly 1 through 24");

  const promptSource = fs.readFileSync(path.resolve(root, "src/llm/prompts.ts"), "utf8");
  assert(promptSource.includes("showConfidenceScores")
    && promptSource.includes("redactStoredConfidence")
    && promptSource.includes("if (showConfidenceScores)"),
  "Confidence-display ablation is not wired into prompt rendering");

  const plannedRuns = manifest.scenarios.length * manifest.conditions.length
    * manifest.rosterPaths.length * manifest.seeds.length;
  const plannedModelCalls = plannedRuns * manifest.budget.maxModelCalls;
  assert(plannedRuns === 48 && plannedModelCalls === 1728, "Frozen run or call count changed");

  return {
    passed: true,
    mode: "static-only",
    manifest: manifestRelativePath,
    plannedRuns,
    plannedModelCalls,
    speakingOrders: 24,
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
    "Usage: node --import tsx analysis/audit-confidence-display-ablation-v1.mjs "
      + "[--static | <grid-results.json> [audit-output.json]]",
  );
}

staticAudit();
const gridPath = path.resolve(gridPathArg);
const outputPath = path.resolve(outputPathArg ?? "analysis/confidence-display-ablation-v1-audit.json");
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
const frozenManifest = loadStructured(manifestRelativePath);

assert(grid.grid.id === "confidence_display_ablation_haiku_scale12_v1", `Wrong grid id: ${grid.grid.id}`);
assert(grid.grid.cellOrderSeed === 20261106, "Frozen cell-order seed changed");
assert(grid.grid.maxSteps === 36, `Expected 36 turns, found ${grid.grid.maxSteps}`);
assert(grid.cells.length === 48, `Expected 48 executions, found ${grid.cells.length}`);
assert(new Set(grid.cells.map((cell) => cell.summary.runId)).size === 48, "Run IDs are not unique");
assert(JSON.stringify(grid.inputCatalog?.conditions?.map((condition) => condition.id))
  === JSON.stringify(conditionIds), "Grid condition catalog does not contain exactly the frozen two arms");
const expectedCellSequence = shuffledCellKeys(frozenManifest);
const actualCellSequence = grid.cells.map((cell) => `${cell.conditionId}:${cell.rosterId}:${cell.seed}`);
assert(JSON.stringify(actualCellSequence) === JSON.stringify(expectedCellSequence),
  "Executed cell sequence does not match the frozen randomized schedule");

const runs = [];
for (const cell of grid.cells) {
  assert(conditionIds.includes(cell.conditionId), `Unexpected condition: ${cell.conditionId}`);
  assert(cell.scenarioId === "blind_ego_depletion_scale12_a2_v1",
    `${cell.rosterId}: unexpected scenario ${cell.scenarioId}`);
  assert(cell.seed === 61106, `${cell.rosterId}: unexpected seed ${cell.seed}`);
  assert(cell.summary.completedSteps === 36, `${cell.summary.runId}: incomplete turn sequence`);
  assert(fs.existsSync(cell.summary.dbPath), `${cell.summary.runId}: missing trace database`);

  const calls = queryRows(cell.summary.dbPath, `
    SELECT step_index AS stepIndex, agent_id AS agentId, model_name AS model
    FROM model_calls
    ORDER BY step_index, model_call_id;
  `);
  assert(calls.length === 36, `${cell.summary.runId}: expected 36 model calls`);
  assert(calls.every((row) => row.model === "claude-haiku-4-5-20251001"),
    `${cell.summary.runId}: unexpected model`);
  const rosterPath = grid.inputCatalog.rosters.find((roster) => roster.id === cell.rosterId)?.path;
  assert(rosterPath && fs.existsSync(rosterPath), `${cell.summary.runId}: roster path missing`);
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const offset = cell.seed % roster.agents.length;
  const expectedCallOrder = Array.from({ length: 36 }, (_, index) =>
    roster.agents[(offset + index) % roster.agents.length].id
  );
  assert(JSON.stringify(calls.map((row) => row.agentId)) === JSON.stringify(expectedCallOrder),
    `${cell.summary.runId}: actual call order does not match the seeded roster rotation`);

  const fixedEvents = queryRows(cell.summary.dbPath, `
    SELECT agent_id AS agentId, output_json AS outputJson
    FROM events
    WHERE event_type = 'fixed_source_statement'
    ORDER BY step_index;
  `);
  assert(fixedEvents.length === 6, `${cell.summary.runId}: expected six fixed-source statements`);
  for (const event of fixedEvents) {
    const output = JSON.parse(event.outputJson);
    assert(sourceIds.has(event.agentId), `${cell.summary.runId}: unexpected fixed source ${event.agentId}`);
    assert(output.stance === "endorse" && output.text === fixedText,
      `${cell.summary.runId}: fixed source message or stance changed`);
  }

  const finals = queryRows(cell.summary.dbPath, `
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
  assert(sourceFinals.length === 2 && sourceFinals.every((row) => row.stance === "endorse"),
    `${cell.summary.runId}: liar agents did not finish by endorsing`);

  const entries = queryRows(cell.summary.dbPath, `
    SELECT agent_id AS agentId, stance, confidence, entry_text AS text
    FROM memory_entries;
  `);
  assert(entries.every((entry) => !String(entry.text ?? "").includes("[parse fallback]")
    && !String(entry.text ?? "").includes("[heuristic fallback]")),
  `${cell.summary.runId}: parser or heuristic fallback found`);

  const retrievals = queryRows(cell.summary.dbPath, `
    SELECT agent_id AS agentId, retrieved_entry_ids_json AS idsJson, context_json AS contextJson
    FROM retrieval_traces
    ORDER BY step_index, retrieval_trace_id;
  `);
  assert(retrievals.length === 36, `${cell.summary.runId}: expected 36 retrieval traces`);
  const promptsWithRecord = [];
  for (const retrieval of retrievals) {
    const context = JSON.parse(retrieval.contextJson);
    assert(context.responseParseValid === true, `${cell.summary.runId}: invalid response parse`);
    const ids = JSON.parse(retrieval.idsJson);
    if (ids.length === 0) continue;
    const prompt = context.promptAudit?.userPrompt;
    assert(typeof prompt === "string", `${cell.summary.runId}: prompt audit missing`);
    const section = retrievedRecordSection(prompt);
    assert(section.length > 0, `${cell.summary.runId}: retrieved-record section missing`);
    promptsWithRecord.push(section);
  }
  assert(promptsWithRecord.length > 0, `${cell.summary.runId}: no prompts retrieved a saved judgment`);
  const hasOuterScore = (section) => /\(confidence:\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\)/i.test(section);
  const hasEmbeddedScore = (section) => /\(conf:\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\)/i.test(section);
  if (cell.conditionId === hiddenId) {
    assert(promptsWithRecord.every((section) => !hasOuterScore(section) && !hasEmbeddedScore(section)),
      `${cell.summary.runId}: retrieved confidence leaked into the hidden arm`);
  } else {
    assert(promptsWithRecord.every((section) => hasOuterScore(section) && hasEmbeddedScore(section)),
      `${cell.summary.runId}: standard arm did not display retrieved confidence`);
  }

  const counts = countStances(neutralFinals);
  runs.push({
    conditionId: cell.conditionId,
    rosterId: cell.rosterId,
    order: orderNumber(cell.rosterId),
    runId: cell.summary.runId,
    neutralFinals: counts,
    anyFalseEndorsement: counts.endorse > 0,
    completeSpread: counts.endorse === 10,
    meanNeutralConfidence: mean(neutralFinals.map((row) => row.confidence)),
    retrievedPrompts: promptsWithRecord.length,
    dbPath: cell.summary.dbPath,
  });
}

const byCondition = Object.fromEntries(conditionIds.map((conditionId) => {
  const subset = runs.filter((run) => run.conditionId === conditionId).sort((a, b) => a.order - b.order);
  assert(subset.length === 24, `${conditionId}: expected 24 executions`);
  assert(subset.every((run, index) => run.order === index + 1), `${conditionId}: orders are not 1 through 24`);
  const pooled = Object.fromEntries(stances.map((stance) => [
    stance,
    subset.reduce((sum, run) => sum + run.neutralFinals[stance], 0),
  ]));
  assert(Object.values(pooled).reduce((sum, value) => sum + value, 0) === 240,
    `${conditionId}: neutral final totals do not sum to 240`);
  return [conditionId, {
    runs: 24,
    neutralFinalJudgments: pooled,
    falseEndorsementRate: pooled.endorse / 240,
    ordersWithAnyFalseEndorsement: subset.filter((run) => run.anyFalseEndorsement).length,
    ordersWithCompleteSpread: subset.filter((run) => run.completeSpread).length,
    meanNeutralConfidence: mean(subset.map((run) => run.meanNeutralConfidence)),
  }];
}));

const byKey = new Map(runs.map((run) => [`${run.conditionId}:${run.order}`, run]));
const pairedDifferences = Array.from({ length: 24 }, (_, index) => {
  const order = index + 1;
  const standard = byKey.get(`${standardId}:${order}`);
  const hidden = byKey.get(`${hiddenId}:${order}`);
  assert(standard && hidden, `Order ${order}: incomplete pair`);
  return (hidden.neutralFinals.endorse - standard.neutralFinals.endorse) / 10;
});
const positive = pairedDifferences.filter((value) => value > 0).length;
const negative = pairedDifferences.filter((value) => value < 0).length;
const ties = pairedDifferences.length - positive - negative;
const bootstrap = clusterBootstrapMeanInterval(
  pairedDifferences,
  bootstrapIndexMatrix({ seed: 20261106, draws: 10_000, clusters: 24 }),
);

const report = {
  generatedAt: new Date().toISOString(),
  status: "complete",
  design: {
    model: "claude-haiku-4-5-20251001",
    task: "ego depletion",
    agentsPerExecution: 12,
    liarAgentsPerExecution: 2,
    neutralAgentsPerExecution: 10,
    speakingOrders: 24,
    executions: 48,
    modelCalls: 1728,
    estimand: "confidence-hidden minus standard neutral final false-endorsement rate",
    statisticalUnit: "speaking order",
  },
  checks: {
    staticPlanPassed: true,
    uniqueCompleteExecutions: runs.length === 48,
    threeCallsPerAgent: true,
    exactFixedMessages: true,
    noParserFallbacks: true,
    confidenceDisplayApplied: true,
    executionSequenceMatchesFrozenShuffle: true,
    actualCallOrdersMatchSeededRosters: true,
    completePairedOrderCoverage: pairedDifferences.length === 24,
  },
  byCondition,
  pairedOrderAnalysis: {
    differences: pairedDifferences,
    mean: mean(pairedDifferences),
    median: median(pairedDifferences),
    positive,
    negative,
    ties,
    exactTwoSidedSignTestP: exactTwoSidedSignTest(positive, negative),
    bootstrap95: bootstrap,
  },
  interpretationScope: "The intervention hides numeric confidence on retrieved judgments only. Agents still report confidence, retain their private prior-confidence reminder, and may express certainty in words.",
  runs: runs.sort((a, b) => a.conditionId.localeCompare(b.conditionId) || a.order - b.order),
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, byCondition, pairedOrderAnalysis: report.pairedOrderAnalysis }, null, 2));
