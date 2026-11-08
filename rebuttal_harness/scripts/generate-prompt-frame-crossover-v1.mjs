import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const studyId = process.env.PROMPT_FRAME_STUDY_ID?.trim() || "prompt_frame_crossover_v1";
const outputTokenCap = Number.parseInt(process.env.PROMPT_FRAME_OUTPUT_TOKEN_CAP ?? "384", 10);
if (!Number.isInteger(outputTokenCap) || outputTokenCap <= 0) {
  throw new Error(`Invalid PROMPT_FRAME_OUTPUT_TOKEN_CAP: ${process.env.PROMPT_FRAME_OUTPUT_TOKEN_CAP}`);
}
const studyDir = path.join(root, "experiments", studyId);
const runConfigDir = path.join(studyDir, "run-configs");
const conditionDir = path.join(root, "conditions", studyId);
const rosterDir = path.join(root, "rosters", studyId);
const scenarioDir = path.join(root, "scenarios");
const outputDir = path.join(root, "output", studyId);

for (const dir of [studyDir, runConfigDir, conditionDir, rosterDir, scenarioDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const model = "claude-haiku-4-5-20251001";
const seed = 404;
const scheduleSeed = 20261031;
const fixedCausalMessage =
  "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.";

const sourceScenarioPath = path.join(root, "scenarios", "blind_ego_depletion_scale12_a2_v1.yaml");
const sourceScenario = JSON.parse(fs.readFileSync(sourceScenarioPath, "utf8"));
const zeroSourceScenario = {
  ...sourceScenario,
  id: `blind_ego_depletion_scale12_a0_${studyId}`,
  title: "Ego depletion, twelve neutral agents in the prompt-frame crossover",
  mechanismTags: sourceScenario.mechanismTags
    .filter((tag) => tag !== "persistent_source_count_2")
    .concat(["persistent_source_count_0", "prompt_frame_crossover"]),
  initialBeliefStates: [],
};
const zeroSourceScenarioPath = path.join(scenarioDir, `${zeroSourceScenario.id}.yaml`);
fs.writeFileSync(zeroSourceScenarioPath, `${JSON.stringify(zeroSourceScenario, null, 2)}\n`);

const protocolFlows = [
  { id: "shared_memory", interactionMode: "memory" },
  { id: "live_debate", interactionMode: "chat" },
];
const promptFrames = ["memory_assessment", "live_discussion"];
const sourceConditions = [
  { id: "no_repeating_agents", hasSources: false },
  { id: "causal_explanation", hasSources: true },
];

const conditionSpecs = protocolFlows.flatMap((protocol) =>
  promptFrames.flatMap((promptFrame) =>
    sourceConditions.map((source) => ({ protocol, promptFrame, source })),
  ),
);

const conditionPaths = new Map();
for (const spec of conditionSpecs) {
  const arm = `${spec.source.id}__${spec.protocol.id}__${spec.promptFrame}`;
  const condition = {
    id: `${studyId}_${arm}`,
    title: arm.replaceAll("__", ", ").replaceAll("_", " "),
    memory: {
      mode: "shared",
      record: "agent_judgment",
      maxRetrievedEntries: 6,
      writeUncertainAnswers: false,
    },
    interaction: {
      mode: spec.protocol.interactionMode,
      promptFrame: spec.promptFrame,
      chatRounds: 3,
      adaptiveStopping: false,
      adversaryCommitment: spec.source.hasSources ? "enforced" : "prompted",
      ...(spec.source.hasSources ? { fixedSourceMessage: fixedCausalMessage } : {}),
      topology: "fully-connected",
    },
    interventions: {
      correctionVisibility: "global",
      correctionTiming: "none",
    },
  };
  const conditionPath = path.join(conditionDir, `${condition.id}.yaml`);
  fs.writeFileSync(conditionPath, `${JSON.stringify(condition, null, 2)}\n`);
  conditionPaths.set(arm, conditionPath);
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
  if (sourceRoster.agents.length !== 12) {
    throw new Error(`Expected 12 agents in ${sourceRosterPath}.`);
  }
  if (sourceRoster.agents.some((agent) => agent.model !== model)) {
    throw new Error(`Unexpected model in ${sourceRosterPath}; every agent must use ${model}.`);
  }

  const neutralRoster = {
    id: `${studyId}_no_sources_order_${order}`,
    title: `Prompt-frame crossover no-source balanced order ${order}`,
    description: "Twelve neutral agents in the same identity order as the matched two-source conditions.",
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
    const arm = `${spec.source.id}__${spec.protocol.id}__${spec.promptFrame}`;
    const conditionPath = conditionPaths.get(arm);
    const roster = spec.source.hasSources ? sourceRoster : neutralRoster;
    const rosterPath = spec.source.hasSources ? sourceRosterPath : neutralRosterPath;
    const scenarioPath = spec.source.hasSources ? sourceScenarioPath : zeroSourceScenarioPath;
    const turnOrder = roster.agents.map((agent) => agent.id);
    const cellId = `${studyId}_order${order}_${arm}`;
    const runConfig = {
      id: cellId,
      title: `Prompt-frame crossover, order ${order}, ${arm.replaceAll("__", ", ").replaceAll("_", " ")}`,
      scenarioPath,
      conditionPath,
      seed,
      maxSteps: 36,
      budget: {
        maxModelCalls: 36,
        maxOutputTokensPerCall: outputTokenCap,
        temperature: 0,
      },
      agents: roster.agents,
      turnOrder,
      outputDir,
    };
    const runConfigPath = path.join(runConfigDir, `${cellId}.json`);
    fs.writeFileSync(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);
    cells.push({
      id: cellId,
      order: orderIndex,
      arm,
      protocolFlow: spec.protocol.id,
      interactionMode: spec.protocol.interactionMode,
      promptFrame: spec.promptFrame,
      sourceCondition: spec.source.id,
      hasSources: spec.source.hasSources,
      message: spec.source.hasSources ? fixedCausalMessage : null,
      turnOrder,
      scenarioPath,
      conditionPath,
      rosterPath,
      runConfigPath,
    });
  }
}

let state = scheduleSeed;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};
for (let index = cells.length - 1; index > 0; index -= 1) {
  const target = Math.floor(random() * (index + 1));
  [cells[index], cells[target]] = [cells[target], cells[index]];
}
cells.forEach((cell, index) => {
  cell.schedulePosition = index + 1;
});

const manifest = {
  id: studyId,
  title: "Prompt-frame by communication-protocol crossover",
  frozenAt: new Date().toISOString(),
  status: "follow-up",
  model,
  task: "ego depletion",
  design: {
    protocolFlows: protocolFlows.map((item) => item.id),
    promptFrames,
    sourceConditions: sourceConditions.map((item) => item.id),
    orders: 24,
    rounds: 3,
  },
  arms: conditionSpecs.map((spec) => `${spec.source.id}__${spec.protocol.id}__${spec.promptFrame}`),
  plannedRuns: cells.length,
  modelCallsPerRun: 36,
  plannedModelCalls: cells.length * 36,
  maxOutputTokensPerCall: outputTokenCap,
  seed,
  scheduleSeed,
  fixedCausalMessage,
  outputDir,
  notes: [
    "All 192 runs are shuffled into one frozen execution schedule.",
    "Every arm uses the same 24 position-balanced identity and speaker orders.",
    "The communication protocol controls visible history; promptFrame controls instructions and response format.",
    "No-source arms contain twelve neutral agents. Source arms contain two fixed-message sources and ten neutral agents.",
    `Every run uses Claude Haiku, temperature zero, three rounds, exactly 36 planned model calls, and the same ${outputTokenCap}-token output cap.`,
  ],
  cells,
};
const manifestPath = path.join(studyDir, "study-manifest.json");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  arms: manifest.arms.length,
  outputDir,
}, null, 2));
