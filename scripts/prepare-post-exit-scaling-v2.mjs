import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const rosterDir = path.join(projectRoot, "rosters", "post-exit-scaling-v2");
const experimentDir = path.join(projectRoot, "experiments");
fs.mkdirSync(rosterDir, { recursive: true });

const model = "claude-haiku-4-5-20251001";
const sizes = [6, 12, 24];
const ratios = [
  { id: "equal", label: "equal split", liarFraction: 1 / 2 },
  { id: "lower", label: "one-third liar agents", liarFraction: 1 / 3 },
];

function liarAgent(index, exitStep) {
  return {
    id: `analyst_${index}`,
    role: "contamination_agent",
    model,
    positiveEvidenceWeight: 0.7,
    negativeEvidenceWeight: 0.45,
    socialWeight: 0.2,
    falseClaimBias: 0.95,
    correctionTrust: 0.2,
    writesMemoryThreshold: 0,
    activeFromStep: 1,
    activeUntilStep: exitStep,
    canWriteMemory: true,
  };
}

function neutralAgent(index, entryStep) {
  return {
    id: `analyst_${index}`,
    role: "neutral_agent",
    model,
    positiveEvidenceWeight: 0.7,
    negativeEvidenceWeight: 0.7,
    socialWeight: 0.5,
    falseClaimBias: 0,
    correctionTrust: 0.5,
    writesMemoryThreshold: 0,
    activeFromStep: entryStep,
    canWriteMemory: true,
  };
}

for (const size of sizes) {
  for (const ratio of ratios) {
    const liarCount = Math.round(size * ratio.liarFraction);
    const neutralCount = size - liarCount;
    const maxSteps = liarCount + 2 * neutralCount;
    const id = `post_exit_scaling_v2_${ratio.id}_n${size}`;
    const agents = [
      ...Array.from({ length: liarCount }, (_, i) => liarAgent(i + 1, liarCount)),
      ...Array.from({ length: neutralCount }, (_, i) => neutralAgent(liarCount + i + 1, liarCount + 1)),
    ];

    const roster = {
      id,
      title: `${size} agents with ${liarCount} liar and ${neutralCount} neutral agents`,
      description: "Each liar agent writes once and exits. Each neutral agent then receives two turns.",
      agents,
    };
    fs.writeFileSync(
      path.join(rosterDir, `${id}.json`),
      `${JSON.stringify(roster, null, 2)}\n`,
    );

    const experiment = {
      id,
      title: `Post-exit scaling, ${ratio.label}, N=${size}`,
      benchmarkMeta: {
        status: "exploratory",
        locked: false,
        notes: [
          "Claude Haiku 4.5 on the ego-depletion claim.",
          `${liarCount} liar agents each speak once and exit; ${neutralCount} neutral agents then receive two turns each.`,
          "Matched conditions differ only in whether memory entries written by departed liar agents are retained or removed.",
          "Seeds 0 through 11 rotate speaking order within each role group.",
        ],
      },
      scenarios: ["scenarios/post-exit-scaling-ego-v1.yaml"],
      conditions: [
        "conditions/shared-memory-post-exit-retained-v2.yaml",
        "conditions/shared-memory-post-exit-cleared-v2.yaml",
      ],
      seeds: Array.from({ length: 12 }, (_, seed) => seed),
      rosterPaths: [`rosters/post-exit-scaling-v2/${id}.json`],
      maxSteps,
      budget: {
        maxModelCalls: maxSteps,
        maxOutputTokensPerCall: 160,
        temperature: 0,
      },
    };
    fs.writeFileSync(
      path.join(experimentDir, `${id}.json`),
      `${JSON.stringify(experiment, null, 2)}\n`,
    );
  }
}

console.log("Prepared 144 post-exit scaling runs across two ratios and three group sizes.");
