import fs from "fs";
import path from "path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const out = path.join(root, "experiments");
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
const make = (id: string, title: string, scenarios: string[], conditions: string[], rosterPaths: string[], maxSteps: number, notes: string[]) => ({
  id, title, benchmarkMeta: { status: "paper-facing", locked: true, notes },
  scenarios, conditions, seeds: [0], rosterPaths, maxSteps,
  budget: { maxModelCalls: 18, maxOutputTokensPerCall: 512, temperature: 0 },
});

const modelKeys = ["gpt4mini", "llama8b", "mistral8b"];
const modelRosters = modelKeys.flatMap((model) => {
  const dir = path.join(root, `rosters/neutral-fairness-v1-${model}`);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  if (files.length !== 12) throw new Error(`Expected 12 ${model} rosters, found ${files.length}`);
  return files.map((name) => `rosters/neutral-fairness-v1-${model}/${name}`);
});
const haikuFiles = fs.readdirSync(path.join(root, "rosters/neutral-fairness-v1")).filter((name) => name.endsWith(".json")).sort();
if (haikuFiles.length !== 12) throw new Error(`Expected 12 Haiku rosters, found ${haikuFiles.length}`);
const haikuRosters = haikuFiles.map((name) => `rosters/neutral-fairness-v1/${name}`);

const ego = ["scenarios/familiar-blind/blind_ego_depletion_focus_only_no_intervention_v2.yaml"];
const tasks = [
  "scenarios/familiar-blind/neutral-confounds-v1/neutral_confounds_v1_mmr_focus_only.yaml",
  "scenarios/neutral-scitat-expanded-v2/neutral_scitat_expanded_v2_blind_scitat_1512_01642v1_q2_contagion.yaml",
  "scenarios/neutral-scitat-expanded-v2/neutral_scitat_expanded_v2_blind_scitat_math_0012242v1_q2_contagion.yaml",
  "scenarios/neutral-core-v1/neutral_core_v1_gsm8k_01.yaml",
  "scenarios/neutral-core-v1/neutral_core_v1_gsm8k_02.yaml",
  "scenarios/neutral-core-v1/neutral_core_v1_gsm8k_03.yaml",
];
const notes = [
  "Every scenario contains one focal claim, no visible evidence, and no scheduled intervention.",
  "Both targets have identical neutral prompts and the twelve orders balance every speaking position.",
  "Memory and fixed-round debate use seed 0, eighteen calls, and three calls per agent.",
];
write("part2-neutral-fairness-crossmodel-memory-v2.json", make("part2_neutral_fairness_crossmodel_memory_v2", "Corrected neutral fairness across GPT-4o-mini, Llama 8B, and Ministral 8B: memory", ego, ["conditions/shared-memory-no-correction.yaml", "conditions/personal-memory-no-correction.yaml"], modelRosters, 18, notes));
write("part2-neutral-fairness-crossmodel-chat-v2.json", make("part2_neutral_fairness_crossmodel_chat_v2", "Corrected neutral fairness across GPT-4o-mini, Llama 8B, and Ministral 8B: debate", ego, ["conditions/chat-fully-connected-no-early-stop.yaml"], modelRosters, 1, notes));
write("part2-neutral-fairness-crossmodel-multitask-memory-v2.json", make("part2_neutral_fairness_crossmodel_multitask_memory_v2", "Corrected neutral fairness across three models and six tasks: memory", tasks, ["conditions/shared-memory-no-correction.yaml", "conditions/personal-memory-no-correction.yaml"], modelRosters, 18, notes));
write("part2-neutral-fairness-crossmodel-multitask-chat-v2.json", make("part2_neutral_fairness_crossmodel_multitask_chat_v2", "Corrected neutral fairness across three models and six tasks: debate", tasks, ["conditions/chat-fully-connected-no-early-stop.yaml"], modelRosters, 1, notes));

const defenses = [
  "conditions/shared-memory-no-correction.yaml",
  "conditions/shared-memory-gt-verification-no-correction.yaml",
  "conditions/shared-memory-early-correction.yaml",
  "conditions/shared-memory-late-correction.yaml",
  "conditions/shared-memory-decay-no-correction.yaml",
  "conditions/shared-independence-aware-no-correction.yaml",
  "conditions/shared-provenance-aware-no-correction.yaml",
];
write("part2-neutral-defense-suite-v2.json", make("part2_neutral_defense_suite_v2", "Matched neutral-prompt defense suite on ego depletion", ["scenarios/familiar-blind/blind_ego_depletion_focus_only_v1.yaml"], defenses, haikuRosters, 18, [
  "One focal claim and one matched baseline are used for every defense.",
  "The correction template is delivered only by the early and late conditions.",
  "Every condition uses the same twelve balanced orders, seed 0, eighteen calls, and three calls per agent.",
]));
console.log(JSON.stringify({ egoCrossModelCells: 108, multitaskCrossModelCells: 648, neutralDefenseCells: 84 }, null, 2));
