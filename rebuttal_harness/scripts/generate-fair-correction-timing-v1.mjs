import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceGridPath = path.join(
  root,
  "experiments",
  "lockin-depth-v1",
  "fair-correction-timing-haiku-v1.json",
);
const grid = JSON.parse(fs.readFileSync(sourceGridPath, "utf8"));
if (grid.id !== "fair_correction_timing_haiku_v1") {
  throw new Error(`Unexpected grid id: ${grid.id}`);
}

const studyDir = path.join(root, "experiments", grid.id);
const runConfigDir = path.join(studyDir, "run-configs");
fs.mkdirSync(runConfigDir, { recursive: true });

const cells = [];
for (const scenarioRelativePath of grid.scenarios) {
  const scenarioPath = path.join(root, scenarioRelativePath);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  const correction = scenario.scheduledInterventions?.[0];
  if (!correction || correction.type !== "correction") {
    throw new Error(`Scenario ${scenario.id} does not contain the expected correction.`);
  }
  const correctionStep = correction.step;
  const finalStep = correctionStep + 24 - 1;
  const timing = correctionStep === 12 ? "early" : correctionStep === 30 ? "late" : null;
  if (!timing) throw new Error(`Unexpected correction step ${correctionStep} in ${scenario.id}`);

  for (const conditionRelativePath of grid.conditions) {
    const conditionPath = path.join(root, conditionRelativePath);
    const condition = JSON.parse(fs.readFileSync(conditionPath, "utf8"));
    if (condition.interventions?.stopAfterCorrectionTurns !== 24) {
      throw new Error(`Condition ${condition.id} does not preserve 24 post-correction response turns.`);
    }

    for (const rosterRelativePath of grid.rosterPaths) {
      const rosterPath = path.join(root, rosterRelativePath);
      const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
      const orderMatch = roster.id.match(/(\d{2})$/);
      if (!orderMatch) throw new Error(`Could not identify order from roster ${roster.id}`);
      const order = Number.parseInt(orderMatch[1], 10);

      for (const seed of grid.seeds) {
        const runConfigId = `${grid.id}_${scenario.id}_${condition.id}_${roster.id}`;
        const runConfig = {
          id: runConfigId,
          title: `${grid.title}: ${scenario.id} / ${condition.id} / ${roster.id} / seed ${seed}`,
          scenarioPath,
          conditionPath,
          seed,
          maxSteps: grid.maxSteps,
          budget: grid.budget,
          agents: roster.agents,
          outputDir: path.join(root, "output"),
        };
        const runConfigPath = path.join(runConfigDir, `${runConfigId}.json`);
        fs.writeFileSync(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);
        cells.push({
          id: runConfigId,
          timing,
          order,
          correctionStep,
          finalStep,
          correctionVisibleTurns: 24,
          scenarioId: scenario.id,
          conditionId: condition.id,
          scenarioPath,
          conditionPath,
          rosterId: roster.id,
          rosterPath,
          runConfigPath,
          seed,
        });
      }
    }
  }
}

let state = (grid.cellOrderSeed >>> 0) || 0x9e3779b9;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};
for (let index = cells.length - 1; index > 0; index -= 1) {
  const target = Math.floor(random() * (index + 1));
  [cells[index], cells[target]] = [cells[target], cells[index]];
}

const manifest = {
  id: grid.id,
  title: grid.title,
  sourceGridPath,
  status: grid.benchmarkMeta?.status ?? "follow-up",
  locked: grid.benchmarkMeta?.locked ?? false,
  model: "claude-haiku-4-5-20251001",
  task: "ego depletion",
  sourceAgents: 2,
  neutralAgents: 10,
  orders: 24,
  timings: ["early", "late"],
  correctionSteps: { early: 12, late: 30 },
  finalSteps: { early: 35, late: 53 },
  correctionVisibleTurnsPerRun: 24,
  plannedRuns: cells.length,
  plannedModelCalls: cells.reduce((sum, cell) => sum + cell.finalStep, 0),
  scheduleSeed: grid.cellOrderSeed,
  notes: grid.benchmarkMeta?.notes ?? [],
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  earlyRuns: cells.filter((cell) => cell.timing === "early").length,
  lateRuns: cells.filter((cell) => cell.timing === "late").length,
}, null, 2));
