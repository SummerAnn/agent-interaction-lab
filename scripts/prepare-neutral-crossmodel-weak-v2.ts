import fs from "fs";
import path from "path";

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function experiment(
  id: string,
  title: string,
  scenarios: string[],
  conditions: string[],
  rosterPaths: string[],
  maxSteps: number,
) {
  return {
    id,
    title,
    benchmarkMeta: {
      status: "paper-facing",
      locked: true,
      notes: [
        "Corrected neutral-prompt replication on two no-context SciTaT pilot items.",
        "The prompts ask agents to evaluate a proposed numeric answer and do not refer to missing paper material.",
        "Claude Sonnet 4.6 and Opus 4.6 each use twelve explicit orders, balancing every agent twice in every position.",
        "Every cell has 18 focal-claim calls, three per agent, no evidence card, no correction intervention, and temperature 0.",
      ],
    },
    scenarios,
    conditions,
    seeds: [0],
    rosterPaths,
    maxSteps,
    budget: { maxModelCalls: 18, maxOutputTokensPerCall: 512, temperature: 0 },
  };
}

const root = path.resolve(process.argv[2] ?? process.cwd());
const rosterPaths = fs.readdirSync(path.join(root, "rosters/neutral-confounds-v1/cross-model"))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => `rosters/neutral-confounds-v1/cross-model/${name}`);
if (rosterPaths.length !== 24) throw new Error(`Expected 24 cross-model rosters, found ${rosterPaths.length}`);

const scenarios = [
  "scenarios/neutral-scitat-expanded-v2/neutral_scitat_expanded_v2_blind_scitat_1512_01642v1_q2_contagion.yaml",
  "scenarios/neutral-scitat-expanded-v2/neutral_scitat_expanded_v2_blind_scitat_math_0012242v1_q2_contagion.yaml",
];
const out = path.join(root, "experiments");
writeJson(
  path.join(out, "part2-neutral-crossmodel-weak-memory-v2.json"),
  experiment(
    "part2_neutral_crossmodel_weak_memory_v2",
    "Corrected neutral prompt across larger Anthropic models on SciTaT pilots: memory",
    scenarios,
    ["conditions/shared-memory-no-correction.yaml", "conditions/personal-memory-no-correction.yaml"],
    rosterPaths,
    18,
  ),
);
writeJson(
  path.join(out, "part2-neutral-crossmodel-weak-chat-v2.json"),
  experiment(
    "part2_neutral_crossmodel_weak_chat_v2",
    "Corrected neutral prompt across larger Anthropic models on SciTaT pilots: debate",
    scenarios,
    ["conditions/chat-fully-connected-no-early-stop.yaml"],
    rosterPaths,
    1,
  ),
);
console.log(JSON.stringify({ models: 2, tasks: 2, cells: 144, calls: 2592 }, null, 2));
