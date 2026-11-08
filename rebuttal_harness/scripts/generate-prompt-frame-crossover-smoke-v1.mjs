import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fullStudyId = process.env.PROMPT_FRAME_FULL_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const smokeStudyId = process.env.PROMPT_FRAME_SMOKE_STUDY_ID?.trim() || "prompt_frame_crossover_smoke_v1";
const selectedOrders = (process.env.PROMPT_FRAME_SMOKE_ORDERS ?? "1")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10));
if (selectedOrders.length === 0 || selectedOrders.some((value) => !Number.isInteger(value) || value < 1 || value > 24)) {
  throw new Error(`Invalid PROMPT_FRAME_SMOKE_ORDERS: ${process.env.PROMPT_FRAME_SMOKE_ORDERS}`);
}
const selectAllArms = process.env.PROMPT_FRAME_SMOKE_ALL_ARMS !== "false";
const targetedPromptFrame = process.env.PROMPT_FRAME_SMOKE_TARGET_FRAME?.trim() || null;
const fullManifestPath = path.join(root, "experiments", fullStudyId, "study-manifest.json");
const fullManifest = JSON.parse(fs.readFileSync(fullManifestPath, "utf8"));
const studyDir = path.join(root, "experiments", smokeStudyId);
const runConfigDir = path.join(studyDir, "run-configs");
const outputDir = path.join(root, "output", smokeStudyId);
fs.mkdirSync(runConfigDir, { recursive: true });

const selected = fullManifest.cells
  .filter((cell) => selectedOrders.includes(cell.order))
  .filter((cell) => selectAllArms || cell.promptFrame === targetedPromptFrame)
  .sort((left, right) => left.order - right.order || left.arm.localeCompare(right.arm));
const expectedPerOrder = selectAllArms ? 8 : 4;
if (
  selected.length !== selectedOrders.length * expectedPerOrder ||
  selectedOrders.some((order) => new Set(selected.filter((cell) => cell.order === order).map((cell) => cell.arm)).size !== expectedPerOrder)
) {
  throw new Error(`Expected ${expectedPerOrder} cells for each selected order, found ${selected.length} total.`);
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
  title: `SMOKE ONLY: prompt-frame crossover, orders ${selectedOrders.join(", ")}`,
  generatedAt: new Date().toISOString(),
  sourceManifestPath: fullManifestPath,
  sourceStudyId: fullStudyId,
  status: "smoke",
  model: fullManifest.model,
  task: fullManifest.task,
  arms: fullManifest.arms,
  design: {
    ...fullManifest.design,
    smokeOrders: selectedOrders,
    smokeArmSelection: selectAllArms ? "all" : `promptFrame=${targetedPromptFrame}`,
  },
  plannedRuns: cells.length,
  modelCallsPerRun: 36,
  plannedModelCalls: cells.length * 36,
  maxOutputTokensPerCall: fullManifest.maxOutputTokensPerCall,
  fixedCausalMessage: fullManifest.fixedCausalMessage,
  outputDir,
  isolation: {
    separateStudyId: smokeStudyId !== fullStudyId,
    separateRunConfigIds: cells.every((cell) => !cell.id.startsWith(`${fullStudyId}_`)),
    separateOutputDir: outputDir !== fullManifest.outputDir,
  },
  notes: [
    `This package contains smoke orders ${selectedOrders.join(", ")} only and must never be counted as part of the frozen 192-run study.`,
    "Run ids, run-config paths, manifest, and output directory are separate from the frozen study.",
  ],
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  isolation: manifest.isolation,
  outputDir,
}, null, 2));
