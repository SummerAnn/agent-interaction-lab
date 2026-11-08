import fs from "node:fs";
import path from "node:path";

import { queryRows } from "../src/db/sqlite.ts";
import { runExperimentAsync } from "../src/engine/run.ts";

const root = process.cwd();
const studyId = "prompt_frame_crossover_scitat_a_sonnet_opus_v1";
const manifestPath = path.join(root, "experiments", studyId, "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const requestedConcurrency = Number.parseInt(process.env.EXPERIMENT_CONCURRENCY ?? "4", 10);
if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1) {
  throw new Error(`Invalid EXPERIMENT_CONCURRENCY: ${process.env.EXPERIMENT_CONCURRENCY}`);
}
const concurrency = requestedConcurrency;
const executionLogPath = path.join(manifest.outputDir, "execution-log.jsonl");

if (manifest.id !== studyId) {
  throw new Error(`Manifest id ${manifest.id} does not match ${studyId}.`);
}
if (manifest.status !== "frozen-follow-up") {
  throw new Error(`Manifest is not frozen: status=${manifest.status}.`);
}
if (
  manifest.plannedRuns !== 192 ||
  manifest.modelCallsPerRun !== 36 ||
  manifest.plannedModelCalls !== 6912 ||
  manifest.maxOutputTokensPerCall !== 1024 ||
  manifest.temperature !== 0
) {
  throw new Error("Frozen manifest does not match the prespecified 192-run budget.");
}

function runPathsFor(cell) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  const runDir = path.join(runConfig.outputDir, runId);
  return {
    runConfig,
    runId,
    runDir,
    summaryPath: path.join(runDir, "summary.json"),
  };
}

function recordActualTurnOrder(cell, summary, startedAt, startOrdinal, reconstructed = false) {
  const rows = queryRows(
    summary.dbPath,
    "SELECT model_call_id AS modelCallId, step_index AS stepIndex, agent_id AS agentId " +
      "FROM model_calls ORDER BY model_call_id;",
  );
  const actualModelCallOrder = rows.map((row) => row.agentId);
  const expectedModelCallOrder = cell.expectedModelCallOrder;
  const matchesFrozenOrder =
    JSON.stringify(actualModelCallOrder) === JSON.stringify(expectedModelCallOrder);
  const record = {
    studyId,
    cellId: cell.id,
    runId: summary.runId,
    schedulePosition: cell.schedulePosition,
    actualStartOrdinal: startOrdinal,
    startedAt,
    completedAt: new Date().toISOString(),
    reconstructed,
    model: cell.model,
    order: cell.order,
    protocolFlow: cell.protocolFlow,
    promptFrame: cell.promptFrame,
    configuredTurnOrder: cell.configuredTurnOrder,
    expectedModelCallOrder,
    actualModelCallOrder,
    actualCalls: actualModelCallOrder.length,
    matchesFrozenOrder,
  };
  const { runDir } = runPathsFor(cell);
  fs.writeFileSync(
    path.join(runDir, "actual-turn-order.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  fs.appendFileSync(executionLogPath, `${JSON.stringify(record)}\n`);
  if (!matchesFrozenOrder) {
    throw new Error(
      `${cell.id} actual model-call speaker order does not match the frozen three-round order.`,
    );
  }
}

const pending = manifest.cells.filter((cell) => !fs.existsSync(runPathsFor(cell).summaryPath));
fs.mkdirSync(manifest.outputDir, { recursive: true });

for (const cell of manifest.cells) {
  const paths = runPathsFor(cell);
  const turnOrderPath = path.join(paths.runDir, "actual-turn-order.json");
  if (fs.existsSync(paths.summaryPath) && !fs.existsSync(turnOrderPath)) {
    const summary = JSON.parse(fs.readFileSync(paths.summaryPath, "utf8"));
    recordActualTurnOrder(cell, summary, null, null, true);
  }
}

console.log(JSON.stringify({
  study: manifest.id,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  alreadyComplete: manifest.plannedRuns - pending.length,
  pendingRuns: pending.length,
  concurrency,
  executionLogPath,
}, null, 2));

if (process.env.DRY_RUN === "1") {
  console.log("Dry run complete. No model calls were made.");
  process.exit(0);
}

let next = 0;
let started = manifest.plannedRuns - pending.length;
let completed = manifest.plannedRuns - pending.length;

async function worker(workerId) {
  while (true) {
    const index = next;
    next += 1;
    if (index >= pending.length) return;
    const cell = pending[index];
    started += 1;
    const startOrdinal = started;
    const startedAt = new Date().toISOString();
    console.log(
      `[worker ${workerId}] start ${cell.schedulePosition}/${manifest.plannedRuns} ` +
      `actual_start=${startOrdinal} ${cell.id}`,
    );
    const summary = await runExperimentAsync(cell.runConfigPath, { projectRoot: root });
    recordActualTurnOrder(cell, summary, startedAt, startOrdinal);
    completed += 1;
    console.log(`[${completed}/${manifest.plannedRuns}] done ${cell.id} -> ${summary.runId}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
console.log(`Completed ${manifest.plannedRuns}/${manifest.plannedRuns} runs.`);
