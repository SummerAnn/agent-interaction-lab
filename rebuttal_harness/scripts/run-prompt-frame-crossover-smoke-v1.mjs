import fs from "node:fs";
import path from "node:path";

import { runExperimentAsync } from "../src/engine/run.ts";

const root = process.cwd();
const smokeStudyId = process.env.PROMPT_FRAME_SMOKE_STUDY_ID?.trim() || "prompt_frame_crossover_smoke_v1";
const fullStudyId = process.env.PROMPT_FRAME_FULL_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const manifestPath = path.join(root, "experiments", smokeStudyId, "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const concurrency = Math.max(1, Number.parseInt(process.env.EXPERIMENT_CONCURRENCY ?? "4", 10));

if (
  manifest.id !== smokeStudyId ||
  manifest.sourceStudyId !== fullStudyId ||
  manifest.plannedRuns !== manifest.cells.length ||
  manifest.plannedModelCalls !== manifest.plannedRuns * 36 ||
  !manifest.isolation?.separateStudyId ||
  !manifest.isolation?.separateRunConfigIds ||
  !manifest.isolation?.separateOutputDir
) {
  throw new Error("Smoke manifest failed its isolation guard; refusing to run.");
}
if (manifest.outputDir.includes(`/output/${fullStudyId}`)) {
  throw new Error("Smoke output points at the frozen batch; refusing to run.");
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
  outputDir: manifest.outputDir,
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
    console.log(`[smoke worker ${workerId}] start ${cell.schedulePosition}/${manifest.plannedRuns} ${cell.id}`);
    const summary = await runExperimentAsync(cell.runConfigPath, { projectRoot: root });
    completed += 1;
    console.log(`[smoke ${completed}/${manifest.plannedRuns}] done ${cell.id} -> ${summary.runId}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
console.log(`Completed smoke ${manifest.plannedRuns}/${manifest.plannedRuns} runs.`);
