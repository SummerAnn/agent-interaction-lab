import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const studyId = "experiment_b_same_batch_v1";
const studyDir = path.join(root, "experiments", studyId);
const runConfigDir = path.join(studyDir, "run-configs");
const conditionDir = path.join(root, "conditions", studyId);
const rosterDir = path.join(root, "rosters", studyId);
const scenarioDir = path.join(root, "scenarios");

for (const dir of [studyDir, runConfigDir, conditionDir, rosterDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const sourceScenarioPath = path.join(root, "scenarios", "blind_ego_depletion_scale12_a2_v1.yaml");
const sourceScenario = JSON.parse(fs.readFileSync(sourceScenarioPath, "utf8"));
const zeroSourceScenario = {
  ...sourceScenario,
  id: "blind_ego_depletion_scale12_a0_same_batch_v1",
  title: "Ego depletion, twelve neutral agents in the same-batch rejection check",
  mechanismTags: sourceScenario.mechanismTags
    .filter((tag) => tag !== "persistent_source_count_2")
    .concat(["persistent_source_count_0", "same_batch_rejection_check"]),
  initialBeliefStates: [],
};
const zeroSourceScenarioPath = path.join(scenarioDir, `${zeroSourceScenario.id}.yaml`);
fs.writeFileSync(zeroSourceScenarioPath, `${JSON.stringify(zeroSourceScenario, null, 2)}\n`);

const messages = {
  statement_only: "I endorse the claim.",
  causal_explanation:
    "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.",
};

const conditionSpecs = [
  { id: "no_repeating_agents_shared_memory", method: "shared_memory", message: null },
  { id: "no_repeating_agents_live_debate", method: "live_debate", message: null },
  { id: "statement_only_shared_memory", method: "shared_memory", message: messages.statement_only },
  { id: "statement_only_live_debate", method: "live_debate", message: messages.statement_only },
  { id: "causal_explanation_shared_memory", method: "shared_memory", message: messages.causal_explanation },
  { id: "causal_explanation_live_debate", method: "live_debate", message: messages.causal_explanation },
];

const conditionPaths = new Map();
for (const spec of conditionSpecs) {
  const hasSources = spec.message !== null;
  const condition = {
    id: `experiment_b_${spec.id}`,
    title: spec.id.replaceAll("_", " "),
    memory: {
      mode: "shared",
      record: "agent_judgment",
      maxRetrievedEntries: 6,
      writeUncertainAnswers: false,
    },
    interaction: {
      mode: spec.method === "shared_memory" ? "memory" : "chat",
      chatRounds: 3,
      adaptiveStopping: false,
      adversaryCommitment: hasSources ? "enforced" : "prompted",
      ...(hasSources ? { fixedSourceMessage: spec.message } : {}),
      topology: "fully-connected",
    },
    interventions: {
      correctionVisibility: "global",
      correctionTiming: "none",
    },
  };
  const conditionPath = path.join(conditionDir, `${condition.id}.yaml`);
  fs.writeFileSync(conditionPath, `${JSON.stringify(condition, null, 2)}\n`);
  conditionPaths.set(spec.id, conditionPath);
}

const neutralTemplate = {
  role: "neutral_agent",
  positiveEvidenceWeight: 0.5,
  negativeEvidenceWeight: 0.5,
  socialWeight: 0.5,
  falseClaimBias: 0,
  correctionTrust: 0.5,
  writesMemoryThreshold: 0,
  activeFromStep: 1,
  canWriteMemory: true,
};

const cells = [];
for (let orderIndex = 1; orderIndex <= 24; orderIndex += 1) {
  const order = String(orderIndex).padStart(2, "0");
  const sourceRosterPath = path.join(root, "rosters", "content-factorial-v1", `content_order_${order}.json`);
  const sourceRoster = JSON.parse(fs.readFileSync(sourceRosterPath, "utf8"));
  const neutralRoster = {
    id: `experiment_b_no_sources_order_${order}`,
    title: `Experiment B no-source balanced order ${order}`,
    description: "Twelve neutral agents, using the same identity order as the matched two-source conditions.",
    agents: sourceRoster.agents.map((agent) => ({
      ...agent,
      ...neutralTemplate,
      id: agent.id,
      model: agent.model,
    })),
  };
  const neutralRosterPath = path.join(rosterDir, `${neutralRoster.id}.json`);
  fs.writeFileSync(neutralRosterPath, `${JSON.stringify(neutralRoster, null, 2)}\n`);

  for (const spec of conditionSpecs) {
    const hasSources = spec.message !== null;
    const conditionPath = conditionPaths.get(spec.id);
    const roster = hasSources ? sourceRoster : neutralRoster;
    const scenarioPath = hasSources ? sourceScenarioPath : zeroSourceScenarioPath;
    const cellId = `${studyId}_order${order}_${spec.id}`;
    const runConfig = {
      id: cellId,
      title: `Experiment B same-batch rejection check, order ${order}, ${spec.id.replaceAll("_", " ")}`,
      scenarioPath,
      conditionPath,
      seed: 404,
      maxSteps: 36,
      budget: {
        maxModelCalls: 36,
        maxOutputTokensPerCall: 384,
        temperature: 0,
      },
      agents: roster.agents,
      outputDir: path.join(root, "output"),
    };
    const runConfigPath = path.join(runConfigDir, `${cellId}.json`);
    fs.writeFileSync(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);
    cells.push({
      id: cellId,
      order: orderIndex,
      arm: spec.id,
      method: spec.method,
      hasSources,
      message: spec.message,
      scenarioPath,
      conditionPath,
      rosterPath: hasSources ? sourceRosterPath : neutralRosterPath,
      runConfigPath,
    });
  }
}

let state = 20261030;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};
for (let index = cells.length - 1; index > 0; index -= 1) {
  const target = Math.floor(random() * (index + 1));
  [cells[index], cells[target]] = [cells[target], cells[index]];
}

const manifest = {
  id: studyId,
  title: "Same-batch rejection check",
  frozenAt: new Date().toISOString(),
  status: "follow-up",
  model: "claude-haiku-4-5-20251001",
  task: "ego depletion",
  orders: 24,
  arms: conditionSpecs.map((spec) => spec.id),
  plannedRuns: cells.length,
  plannedModelCalls: cells.length * 36,
  scheduleSeed: 20261030,
  notes: [
    "The 144 runs are shuffled into one execution schedule.",
    "Each arm uses the same 24 position-balanced identity orders.",
    "The no-source arms use twelve neutral agents; source arms use two fixed-message sources and ten neutral agents.",
    "All final endorse, reject, and uncertain judgments are reported.",
  ],
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({ manifestPath, plannedRuns: manifest.plannedRuns, plannedModelCalls: manifest.plannedModelCalls }, null, 2));
