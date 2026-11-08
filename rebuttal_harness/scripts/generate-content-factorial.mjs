import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const conditionDir = path.join(root, "conditions", "content-factorial-v1");
const rosterDir = path.join(root, "rosters", "content-factorial-v1");
fs.mkdirSync(conditionDir, { recursive: true });
fs.mkdirSync(rosterDir, { recursive: true });

const messages = {
  bare: "I endorse the claim.",
  generic: "I continue to endorse this claim. I consider the underlying effect real, and the objections raised so far do not overturn it.",
  mechanism: "I endorse the claim. Performing self-control consumes a limited mental resource, so exerting self-control once impairs performance on the next task.",
  selective_evidence: "I endorse the claim. The original ego-depletion experiments reported worse performance on a second self-control task after participants first exerted self-control, which supports the limited-resource account.",
};

const baseMemory = {
  mode: "shared",
  record: "agent_judgment",
  maxRetrievedEntries: 6,
};
const baseInterventions = {
  correctionVisibility: "global",
  correctionTiming: "none",
};

const conditionPaths = [];
for (const [messageId, fixedSourceMessage] of Object.entries(messages)) {
  for (const method of ["shared_memory", "live_debate"]) {
    const id = `content_${messageId}_${method}`;
    const condition = {
      id,
      title: `${messageId.replaceAll("_", " ")} source message under ${method.replaceAll("_", " ")}`,
      memory: method === "shared_memory"
        ? baseMemory
        : { mode: "shared", record: "agent_judgment", maxRetrievedEntries: 6 },
      interaction: {
        mode: method === "shared_memory" ? "memory" : "chat",
        chatRounds: 3,
        adaptiveStopping: false,
        adversaryCommitment: "enforced",
        fixedSourceMessage,
        topology: "fully-connected",
      },
      interventions: baseInterventions,
    };
    const relativePath = `conditions/content-factorial-v1/${id}.yaml`;
    fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(condition, null, 2)}\n`);
    conditionPaths.push(relativePath);
  }
}

const templatePath = path.join(root, "rosters", "scale12-dose-a2-v1", "scale12_a2_r1_haiku.json");
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const agentById = new Map(template.agents.map((agent) => [agent.id, agent]));
const ascending = Array.from({ length: 12 }, (_, index) => `analyst_${index + 1}`);
const descending = [ascending[0], ...ascending.slice(1).reverse()];
const rosterPaths = [];

for (const [family, base] of [["forward", ascending], ["reverse", descending]]) {
  for (let rotation = 0; rotation < 12; rotation += 1) {
    const order = base.slice(rotation).concat(base.slice(0, rotation));
    const index = rosterPaths.length + 1;
    const id = `content_order_${String(index).padStart(2, "0")}`;
    const roster = {
      id,
      title: `Content factorial ${family} balanced order ${rotation + 1}`,
      description: "Two fixed persistent sources and ten neutral agents. Across 24 orders, every identity appears twice in every speaking position.",
      agents: order.map((agentId) => agentById.get(agentId)),
    };
    const relativePath = `rosters/content-factorial-v1/${id}.json`;
    fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(roster, null, 2)}\n`);
    rosterPaths.push(relativePath);
  }
}

const experiment = {
  id: "content_factorial_ego_haiku_v1",
  title: "Matched source-message content by communication method",
  benchmarkMeta: {
    status: "confirmatory",
    locked: true,
    notes: [
      "Message conditions were fixed before observing results.",
      "The same exact source statement is replayed under shared memory and live debate.",
      "Twenty-four position-balanced orders are repeated in three independently shuffled execution batches.",
      "The primary test is the message-content by communication-method interaction in neutral final judgments.",
    ],
  },
  scenarios: ["scenarios/blind_ego_depletion_scale12_a2_v1.yaml"],
  conditions: conditionPaths,
  seeds: [101, 202, 303],
  rosterPaths,
  cellOrderSeed: 20261021,
  maxSteps: 36,
  budget: {
    maxModelCalls: 36,
    maxOutputTokensPerCall: 384,
    temperature: 0,
  },
};
fs.writeFileSync(
  path.join(root, "experiments", "content-factorial-ego-haiku-v1.json"),
  `${JSON.stringify(experiment, null, 2)}\n`,
);

for (let shard = 0; shard < 6; shard += 1) {
  const shardExperiment = {
    ...experiment,
    id: `content_factorial_ego_haiku_v1_shard${shard + 1}`,
    title: `${experiment.title}, shard ${shard + 1} of 6`,
    rosterPaths: rosterPaths.slice(shard * 4, shard * 4 + 4),
    cellOrderSeed: experiment.cellOrderSeed + shard,
  };
  fs.writeFileSync(
    path.join(root, "experiments", `content-factorial-ego-haiku-v1-shard${shard + 1}.json`),
    `${JSON.stringify(shardExperiment, null, 2)}\n`,
  );
}

for (let shard = 0; shard < 24; shard += 1) {
  const shardExperiment = {
    ...experiment,
    id: `content_factorial_ego_haiku_v1_order${String(shard + 1).padStart(2, "0")}`,
    title: `${experiment.title}, balanced order ${shard + 1} of 24`,
    rosterPaths: [rosterPaths[shard]],
    cellOrderSeed: experiment.cellOrderSeed + 100 + shard,
  };
  fs.writeFileSync(
    path.join(root, "experiments", `content-factorial-ego-haiku-v1-order${String(shard + 1).padStart(2, "0")}.json`),
    `${JSON.stringify(shardExperiment, null, 2)}\n`,
  );
}

console.log(JSON.stringify({ conditions: conditionPaths.length, rosters: rosterPaths.length, cells: conditionPaths.length * rosterPaths.length * experiment.seeds.length }, null, 2));
