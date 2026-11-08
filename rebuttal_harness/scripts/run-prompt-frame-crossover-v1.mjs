import fs from "node:fs";
import path from "node:path";

import { runExperimentAsync } from "../src/engine/run.ts";

const root = process.cwd();
const studyId = process.env.PROMPT_FRAME_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const manifestPath = path.join(root, "experiments", studyId, "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const concurrency = Math.max(1, Number.parseInt(process.env.EXPERIMENT_CONCURRENCY ?? "4", 10));

if (manifest.id !== studyId) {
  throw new Error(`Manifest id ${manifest.id} does not match requested study ${studyId}.`);
}

function summaryPathFor(cell) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  return path.join(runConfig.outputDir, runId, "summary.json");
}

const pending = manifest.cells.filter((cell) => !fs.existsSync(summaryPathFor(cell)));
console.log(JSON.stringify({
  study: manifest.id,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  alreadyComplete: manifest.plannedRuns - pending.length,
  pendingRuns: pending.length,
  concurrency,
}, null, 2));

let next = 0;
let completed = manifest.plannedRuns - pending.length;

async function worker(workerId) {
  while (true) {
    const index = next;
    next += 1;
    if (index >= pending.length) return;
    const cell = pending[index];
    console.log(`[worker ${workerId}] start ${cell.schedulePosition}/${manifest.plannedRuns} ${cell.id}`);
    const summary = await runExperimentAsync(cell.runConfigPath, { projectRoot: root });
    completed += 1;
    console.log(`[${completed}/${manifest.plannedRuns}] done ${cell.id} -> ${summary.runId}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
console.log(`Completed ${manifest.plannedRuns}/${manifest.plannedRuns} runs.`);
