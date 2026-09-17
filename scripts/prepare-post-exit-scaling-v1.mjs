import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const rosterDir = path.join(projectRoot, "rosters", "post-exit-scaling-v1");
const experimentDir = path.join(projectRoot, "experiments");
fs.mkdirSync(rosterDir, { recursive: true });

const model = "claude-haiku-4-5-20251001";
const sizes = [6, 12, 24];

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
  const liarCount = size / 2;
  const neutralCount = size - liarCount;
  const maxSteps = liarCount + 2 * neutralCount;
  const rosterId = `post_exit_scaling_v1_n${size}`;
  const agents = [
    ...Array.from({ length: liarCount }, (_, i) => liarAgent(i + 1, liarCount)),
    ...Array.from({ length: neutralCount }, (_, i) => neutralAgent(liarCount + i + 1, liarCount + 1)),
  ];
  const roster = {
    id: rosterId,
    title: `${size} agents, half write the false claim and then exit`,
    description: "Liar agents each write once, then leave. Neutral agents then receive two turns each.",
    agents,
  };
  const rosterPath = path.join(rosterDir, `${rosterId}.json`);
  fs.writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);

  const experiment = {
    id: `post_exit_scaling_v1_n${size}`,
    title: `Post-exit scaling at N=${size}`,
    benchmarkMeta: { status: "exploratory", locked: false },
    scenarios: ["scenarios/post-exit-scaling-ego-v1.yaml"],
    conditions: [
      "conditions/shared-memory-post-exit-retained.yaml",
      "conditions/shared-memory-post-exit-cleared.yaml",
    ],
    seeds: [0, 1, 2, 3, 4, 5],
    rosterPaths: [`rosters/post-exit-scaling-v1/${rosterId}.json`],
    maxSteps,
    budget: {
      maxModelCalls: maxSteps,
      maxOutputTokensPerCall: 160,
      temperature: 0,
    },
  };
  fs.writeFileSync(
    path.join(experimentDir, `post-exit-scaling-v1-n${size}.json`),
    `${JSON.stringify(experiment, null, 2)}\n`,
  );
}

console.log("Prepared post-exit scaling rosters and experiment grids for N=6, 12, and 24.");
