import fs from "fs";
import path from "path";

const root = process.cwd();
const sourceDir = path.join(root, "rosters", "content-factorial-v1");
const outputDir = path.join(root, "rosters", "lockin-depth-v1");
fs.mkdirSync(outputDir, { recursive: true });
const baseRosterPaths = [];
const exitRosterPaths = [];

for (let order = 1; order <= 24; order += 1) {
  const suffix = String(order).padStart(2, "0");
  const sourcePath = path.join(sourceDir, `content_order_${suffix}.json`);
  baseRosterPaths.push(`rosters/content-factorial-v1/content_order_${suffix}.json`);
  const roster = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  roster.id = `lockin_depth_order_${suffix}`;
  roster.title = `Lock-in depth balanced order ${order}`;
  roster.description = "Two fixed-message sources speak for three rounds, then leave. The ten neutral agents receive three follow-up turns.";
  roster.agents = roster.agents.map((agent) => agent.role === "contamination_agent"
    ? { ...agent, activeUntilStep: 36 }
    : agent);
  fs.writeFileSync(
    path.join(outputDir, `lockin_depth_order_${suffix}.json`),
    `${JSON.stringify(roster, null, 2)}\n`,
  );
  exitRosterPaths.push(`rosters/lockin-depth-v1/lockin_depth_order_${suffix}.json`);
}

const experimentDir = path.join(root, "experiments", "lockin-depth-v1");
fs.mkdirSync(experimentDir, { recursive: true });

const correctionManifest = {
  id: "fair_correction_timing_haiku_v1",
  title: "Early and late corrections with equal follow-up exposure",
  benchmarkMeta: {
    status: "confirmatory",
    locked: true,
    notes: [
      "Frozen before inspecting outcomes.",
      "Both conditions use the same fixed causal explanation, model, 24 balanced orders, and 24 correction-visible response turns.",
      "The early correction appears on turn 12 and ends on turn 35. The late correction appears on turn 30 and ends on turn 53.",
    ],
  },
  scenarios: [
    "scenarios/lockin-depth-v1/ego-depletion-early-correction-step12.yaml",
    "scenarios/lockin-depth-v1/ego-depletion-late-correction-step30.yaml",
  ],
  conditions: [
    "conditions/lockin-depth-v1/shared-memory-fixed-mechanism-equal-correction-followup.yaml",
  ],
  seeds: [731],
  rosterPaths: baseRosterPaths,
  cellOrderSeed: 2026103101,
  concurrency: 4,
  maxSteps: 54,
  budget: {
    maxModelCalls: 54,
    maxOutputTokensPerCall: 384,
    temperature: 0,
  },
};

const persistenceManifest = {
  id: "record_removal_persistence_haiku_v1",
  title: "Persistence after removing the shared record",
  benchmarkMeta: {
    status: "confirmatory",
    locked: true,
    notes: [
      "Frozen before inspecting outcomes.",
      "All conditions share the same first 36 shared-memory turns and fixed causal explanation.",
      "At turn 37 the two sources leave. Neutral agents then receive three turns each with personal memory or with no prior history.",
    ],
  },
  scenarios: ["scenarios/blind_ego_depletion_scale12_a2_v1.yaml"],
  conditions: [
    "conditions/lockin-depth-v1/shared-to-personal-after-three-rounds.yaml",
    "conditions/lockin-depth-v1/shared-to-no-history-after-three-rounds.yaml",
  ],
  seeds: [732],
  rosterPaths: exitRosterPaths,
  cellOrderSeed: 2026103102,
  concurrency: 6,
  maxSteps: 66,
  budget: {
    maxModelCalls: 66,
    maxOutputTokensPerCall: 384,
    temperature: 0,
  },
};

fs.writeFileSync(
  path.join(experimentDir, "fair-correction-timing-haiku-v1.json"),
  `${JSON.stringify(correctionManifest, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(experimentDir, "record-removal-persistence-haiku-v1.json"),
  `${JSON.stringify(persistenceManifest, null, 2)}\n`,
);

console.log(`Wrote 24 lock-in depth rosters to ${outputDir}`);
console.log(`Wrote C and D manifests to ${experimentDir}`);
