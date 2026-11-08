import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const studyId = "prompt_frame_crossover_scitat_a_sonnet_opus_v1";
const studyDir = path.join(root, "experiments", studyId);
const runConfigDir = path.join(studyDir, "run-configs");
const conditionDir = path.join(root, "conditions", studyId);
const manifestPath = path.join(studyDir, "study-manifest.json");
const outputDir = path.join(root, "output", studyId);

if (fs.existsSync(manifestPath)) {
  throw new Error(
    `Frozen manifest already exists at ${manifestPath}. Refusing to overwrite it.`,
  );
}

const scenarioPath = path.join(root, "scenarios", "blind_scitat_a_scale12_a2_v1.yaml");
const messageSourcePath = path.join(
  root,
  "conditions",
  "crossmodel-recording-rule-v1",
  "scitat_a_fixed_explanation_omit_uncertain.yaml",
);
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
const messageSource = JSON.parse(fs.readFileSync(messageSourcePath, "utf8"));
const fixedExplanation = messageSource.interaction?.fixedSourceMessage;

if (scenario.id !== "blind_scitat_a_scale12_a2_v1") {
  throw new Error(`Unexpected SciTaT-A scenario id: ${scenario.id}`);
}
if (scenario.claims?.length !== 1 || scenario.claims[0]?.truthLabel !== "false") {
  throw new Error("SciTaT-A crossover requires one false focal claim.");
}
if (typeof fixedExplanation !== "string" || fixedExplanation.length === 0) {
  throw new Error(`Missing fixed SciTaT-A explanation in ${messageSourcePath}.`);
}

const models = [
  {
    label: "sonnet",
    id: "claude-sonnet-4-6",
    rosterDir: path.join(root, "rosters", "content-factorial-v1-sonnet"),
    rosterSuffix: "sonnet",
  },
  {
    label: "opus",
    id: "claude-opus-4-6",
    rosterDir: path.join(root, "rosters", "content-factorial-v1-opus"),
    rosterSuffix: "opus",
  },
];
const protocols = [
  { id: "shared_memory", interactionMode: "memory" },
  { id: "live_debate", interactionMode: "chat" },
];
const promptFrames = ["memory_assessment", "live_discussion"];
const seed = 811;
const scheduleSeed = 20261103;
const rounds = 3;
const callsPerRun = 36;
const outputTokenCap = 1024;

const rosterRecords = [];
const positionCounts = new Map();
for (const model of models) {
  for (let orderIndex = 1; orderIndex <= 24; orderIndex += 1) {
    const order = String(orderIndex).padStart(2, "0");
    const rosterPath = path.join(
      model.rosterDir,
      `content_order_${order}_${model.rosterSuffix}.json`,
    );
    const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
    if (roster.agents?.length !== 12) {
      throw new Error(`Expected 12 agents in ${rosterPath}.`);
    }
    if (roster.agents.some((agent) => agent.model !== model.id)) {
      throw new Error(`Every agent in ${rosterPath} must use ${model.id}.`);
    }
    const sourceIds = roster.agents
      .filter((agent) => agent.role === "contamination_agent")
      .map((agent) => agent.id)
      .sort();
    if (JSON.stringify(sourceIds) !== JSON.stringify(["analyst_1", "analyst_7"])) {
      throw new Error(`Unexpected fixed-source identities in ${rosterPath}: ${sourceIds.join(", ")}`);
    }
    const turnOrder = roster.agents.map((agent) => agent.id);
    turnOrder.forEach((agentId, position) => {
      const key = `${model.label}:${agentId}:${position + 1}`;
      positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
    });
    rosterRecords.push({ model, orderIndex, order, rosterPath, roster, turnOrder });
  }
}

for (const model of models) {
  for (let agent = 1; agent <= 12; agent += 1) {
    for (let position = 1; position <= 12; position += 1) {
      const count = positionCounts.get(`${model.label}:analyst_${agent}:${position}`) ?? 0;
      if (count !== 2) {
        throw new Error(
          `${model.label} analyst_${agent} appears ${count} times in position ${position}; expected 2.`,
        );
      }
    }
  }
}

for (let orderIndex = 1; orderIndex <= 24; orderIndex += 1) {
  const paired = rosterRecords.filter((record) => record.orderIndex === orderIndex);
  if (paired.length !== models.length) {
    throw new Error(`Missing model roster for balanced order ${orderIndex}.`);
  }
  const orders = new Set(paired.map((record) => JSON.stringify(record.turnOrder)));
  if (orders.size !== 1) {
    throw new Error(`Sonnet and Opus do not share the same identity order at order ${orderIndex}.`);
  }
}

fs.mkdirSync(runConfigDir, { recursive: true });
fs.mkdirSync(conditionDir, { recursive: true });

const conditionSpecs = protocols.flatMap((protocol) =>
  promptFrames.map((promptFrame) => ({ protocol, promptFrame })),
);
const conditionPaths = new Map();
for (const spec of conditionSpecs) {
  const arm = `${spec.protocol.id}__${spec.promptFrame}`;
  const condition = {
    id: `${studyId}_${arm}`,
    title: `SciTaT-A fixed explanation, ${arm.replaceAll("__", ", ").replaceAll("_", " ")}`,
    memory: {
      mode: "shared",
      record: "agent_judgment",
      maxRetrievedEntries: 6,
      writeUncertainAnswers: false,
    },
    interaction: {
      mode: spec.protocol.interactionMode,
      promptFrame: spec.promptFrame,
      chatRounds: rounds,
      adaptiveStopping: false,
      adversaryCommitment: "enforced",
      fixedSourceStance: "endorse",
      fixedSourceMessage: fixedExplanation,
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

const cells = [];
for (const record of rosterRecords) {
  for (const spec of conditionSpecs) {
    const arm = `${spec.protocol.id}__${spec.promptFrame}`;
    const cellId = `${studyId}_${record.model.label}_order${record.order}_${arm}`;
    const conditionPath = conditionPaths.get(arm);
    const runConfig = {
      id: cellId,
      title: `SciTaT-A prompt-frame crossover, ${record.model.label}, order ${record.order}, ${arm.replaceAll("__", ", ").replaceAll("_", " ")}`,
      scenarioPath,
      conditionPath,
      seed,
      maxSteps: callsPerRun,
      budget: {
        maxModelCalls: callsPerRun,
        maxOutputTokensPerCall: outputTokenCap,
        temperature: 0,
      },
      agents: record.roster.agents,
      turnOrder: record.turnOrder,
      outputDir,
    };
    const runConfigPath = path.join(runConfigDir, `${cellId}.json`);
    fs.writeFileSync(runConfigPath, `${JSON.stringify(runConfig, null, 2)}\n`);
    cells.push({
      id: cellId,
      modelLabel: record.model.label,
      model: record.model.id,
      order: record.orderIndex,
      arm,
      protocolFlow: spec.protocol.id,
      interactionMode: spec.protocol.interactionMode,
      promptFrame: spec.promptFrame,
      sourceCondition: "fixed_two_source_scitat_a_explanation",
      message: fixedExplanation,
      configuredTurnOrder: record.turnOrder,
      expectedModelCallOrder: Array.from(
        { length: rounds },
        () => record.turnOrder,
      ).flat(),
      actualTurnOrderLog: "Written by the runner from trace.db model_calls ordered by model_call_id.",
      scenarioPath,
      conditionPath,
      rosterPath: record.rosterPath,
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
  title: "SciTaT-A prompt-frame by communication-protocol crossover in Sonnet and Opus",
  frozenAt: new Date().toISOString(),
  status: "frozen-follow-up",
  task: "SciTaT-A 1512.01642 q2",
  models: models.map(({ label, id }) => ({ label, id })),
  design: {
    protocols: protocols.map(({ id }) => id),
    promptFrames,
    sourceCondition: "fixed_two_source_scitat_a_explanation",
    orders: 24,
    rounds,
  },
  plannedRuns: cells.length,
  modelCallsPerRun: callsPerRun,
  plannedModelCalls: cells.length * callsPerRun,
  maxOutputTokensPerCall: outputTokenCap,
  temperature: 0,
  seed,
  scheduleSeed,
  fixedExplanation,
  scenarioPath,
  outputDir,
  reportingPlan: {
    cleanReplication: "Report one appendix table and one sentence in Section 4.2 or the rebuttal.",
    debateAlsoSpreadsUnderAssessment: "Scope the memory-versus-debate contrast in Section 4.2 to Haiku.",
    sharedMemorySpreadsUnderDiscussion: "Report that discussion instructions do not protect the stronger models and add a scoped Discussion sentence.",
    mixedModelResult: "Report each model separately without pooling away the difference.",
  },
  notes: [
    "All 192 cells are shuffled into one global frozen execution schedule.",
    "Every model and arm uses the same 24 position-balanced identity and speaking orders.",
    "The SciTaT-A scenario, exact fixed two-source explanation, and Sonnet/Opus rosters are reused without modification.",
    "Each run uses temperature zero, three rounds, exactly 36 planned model calls, and a 1,024-token output cap.",
    "The runner records actual model-call speaker order from each trace database and verifies it against three repetitions of the configured order.",
    "The paper remains frozen until all outputs pass a separate audit.",
  ],
  arms: conditionSpecs.map((spec) => `${spec.protocol.id}__${spec.promptFrame}`),
  cells,
};

if (manifest.plannedRuns !== 192 || manifest.plannedModelCalls !== 6912) {
  throw new Error(
    `Unexpected study size: ${manifest.plannedRuns} runs and ${manifest.plannedModelCalls} model calls.`,
  );
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  manifestPath,
  plannedRuns: manifest.plannedRuns,
  plannedModelCalls: manifest.plannedModelCalls,
  models: manifest.models,
  arms: manifest.arms,
  outputDir,
  preflight: {
    balancedOrders: true,
    modelPairing: true,
    exactFixedExplanation: true,
    globalScheduleFrozen: true,
  },
}, null, 2));
