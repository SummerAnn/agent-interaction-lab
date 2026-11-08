import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fullStudyId = "prompt_frame_crossover_v2";
const smokeStudyId = "prompt_frame_crossover_smoke_v2";
const fullManifestPath = path.join(root, "experiments", fullStudyId, "study-manifest.json");
const fullManifest = JSON.parse(fs.readFileSync(fullManifestPath, "utf8"));
const studyDir = path.join(root, "experiments", smokeStudyId);
const runConfigDir = path.join(studyDir, "run-configs");
const outputDir = path.join(root, "output", smokeStudyId);
fs.mkdirSync(runConfigDir, { recursive: true });

const selected = fullManifest.cells
  .filter((cell) => cell.order === 1 || ([13, 18].includes(cell.order) && cell.promptFrame === "live_discussion"))
  .sort((left, right) => left.order - right.order || left.arm.localeCompare(right.arm));
if (selected.length !== 16) {
  throw new Error(`Expected 16 v2 smoke cells, found ${selected.length}.`);
}

const cells = selected.map((sourceCell, index) => {
  const sourceConfig = JSON.parse(fs.readFileSync(sourceCell.runConfigPath, "utf8"));
  const smokeId = sourceConfig.id.replace(fullStudyId, smokeStudyId);
  const runConfig = {
    ...sourceConfig,
    id: smokeId,
    title: `SMOKE ONLY: ${sourceConfig.title}`,
    outputDir,
  };
  const runConfigPath = path.join(runConfigDir, `${smokeId}.json`);
  fs.writeFileSync(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);
  return {
    ...sourceCell,
    id: smokeId,
    sourceFullBatchCellId: sourceCell.id,
    runConfigPath,
    schedulePosition: index + 1,
  };
});

const manifest = {
  id: smokeStudyId,
  title: "SMOKE ONLY: full order-01 factorial plus live-discussion stress orders 13 and 18",
  generatedAt: new Date().toISOString(),
  sourceManifestPath: fullManifestPath,
  sourceStudyId: fullManifest.id,
  status: "smoke",
  model: fullManifest.model,
  task: fullManifest.task,
  arms: fullManifest.arms,
  design: {
    ...fullManifest.design,
    completeFactorialOrders: [1],
    liveDiscussionStressOrders: [13, 18],
  },
  plannedRuns: cells.length,
  modelCallsPerRun: 36,
  plannedModelCalls: cells.length * 36,
  maxOutputTokensPerCall: fullManifest.maxOutputTokensPerCall,
  fixedCausalMessage: fullManifest.fixedCausalMessage,
  outputDir,
  isolation: {
    separateStudyId: smokeStudyId !== fullManifest.id,
    separateRunConfigIds: cells.every((cell) => !cell.id.startsWith(`${fullManifest.id}_`)),
    separateOutputDir: outputDir !== fullManifest.outputDir,
  },
  notes: [
    "Order 01 contains all eight arms.",
    "Orders 13 and 18 contain all four live-discussion cells and exercise every late-round long-history call.",
    "The smoke has separate ids, run configs, manifest, and output directory and is never counted in the frozen 192-run study.",
  ],
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  maxOutputTokensPerCall: manifest.maxOutputTokensPerCall,
  isolation: manifest.isolation,
  outputDir,
}, null, 2));
