import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const gridPath = path.join(root, "experiments", "debate-visibility-ablation-ego-haiku-v1.json");
const grid = JSON.parse(fs.readFileSync(gridPath, "utf8"));
const studyDir = path.join(root, "experiments", grid.id);
const runConfigDir = path.join(studyDir, "run-configs");
fs.mkdirSync(runConfigDir, { recursive: true });

const cells = [];
for (const scenarioRelativePath of grid.scenarios) {
  const scenarioPath = path.join(root, scenarioRelativePath);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  for (const conditionRelativePath of grid.conditions) {
    const conditionPath = path.join(root, conditionRelativePath);
    const condition = JSON.parse(fs.readFileSync(conditionPath, "utf8"));
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
          title: `${grid.title}, ${condition.title}, ${roster.title}`,
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
          order,
          scenarioId: scenario.id,
          conditionId: condition.id,
          scenarioPath,
          conditionPath,
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
  sourceGridPath: gridPath,
  status: "follow-up",
  model: "claude-haiku-4-5-20251001",
  task: "ego depletion",
  sourceAgents: 2,
  neutralAgents: 10,
  rounds: 3,
  orders: 24,
  arms: grid.conditions.map((conditionPath) =>
    JSON.parse(fs.readFileSync(path.join(root, conditionPath), "utf8")).id),
  plannedRuns: cells.length,
  plannedModelCalls: cells.length * grid.budget.maxModelCalls,
  scheduleSeed: grid.cellOrderSeed,
  notes: grid.benchmarkMeta.notes,
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
}, null, 2));
