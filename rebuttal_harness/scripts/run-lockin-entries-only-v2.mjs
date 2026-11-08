import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import yaml from "js-yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const manifestRelativePath = "experiments/lockin-entries-only-v2/record-removal-entries-only-haiku-v2.json";
const manifestPath = path.join(root, manifestRelativePath);
const args = process.argv.slice(2);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function loadStructured(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assert(fs.existsSync(absolutePath), `Missing input: ${relativePath}`);
  return yaml.load(fs.readFileSync(absolutePath, "utf8"));
}

function sharedPhaseCondition(condition) {
  const copy = structuredClone(condition);
  delete copy.id;
  delete copy.title;
  delete copy.memory.personalFromStep;
  delete copy.memory.noHistoryFromStep;
  delete copy.memory.omitPriorBeliefFromStep;
  delete copy.memory.reminderOnlyFromStep;
  return copy;
}

function preflight() {
  const manifest = loadStructured(manifestRelativePath);
  assert(manifest.id === "record_removal_history_components_haiku_v2", "Unexpected manifest id");
  assert(manifest.benchmarkMeta?.locked === true, "Manifest must remain locked");
  assert(manifest.scenarios.length === 1, "Expected one scenario");
  assert(manifest.conditions.length === 4, "Expected four conditions");
  assert(manifest.rosterPaths.length === 24, "Expected 24 speaking orders");
  assert(new Set(manifest.rosterPaths).size === 24, "Speaking-order paths are not unique");
  assert(manifest.seeds.length === 1 && manifest.seeds[0] === 732,
    "Expected the original persistence experiment's shared seed 732");
  assert(manifest.cellOrderSeed === 2026110701, "The four-arm same-batch shuffle seed changed");
  assert(manifest.maxSteps === 66, "Expected 66 turns per run");
  assert(manifest.budget.maxModelCalls === 66, "Expected a 66-call cap per run");

  const conditions = manifest.conditions.map(loadStructured);
  const byId = new Map(conditions.map((condition) => [condition.id, condition]));
  const expectedIds = [
    "shared_to_personal_after_three_rounds",
    "shared_to_personal_entries_only_after_three_rounds",
    "shared_to_reminder_only_after_three_rounds",
    "shared_to_no_history_after_three_rounds",
  ];
  assert(expectedIds.every((id) => byId.has(id)), "The four planned conditions changed");

  const personal = byId.get("shared_to_personal_after_three_rounds");
  const entriesOnly = byId.get("shared_to_personal_entries_only_after_three_rounds");
  const reminderOnly = byId.get("shared_to_reminder_only_after_three_rounds");
  const noHistory = byId.get("shared_to_no_history_after_three_rounds");
  assert(personal.memory.personalFromStep === 37, "Personal+prior transition must begin at turn 37");
  assert(personal.memory.omitPriorBeliefFromStep === undefined,
    "Personal+prior control unexpectedly omits the prior stance");
  assert(entriesOnly.memory.personalFromStep === 37, "Entries-only personal transition must begin at turn 37");
  assert(entriesOnly.memory.omitPriorBeliefFromStep === 37,
    "Entries-only prompt omission must begin at turn 37");
  assert(reminderOnly.memory.reminderOnlyFromStep === 37,
    "Reminder-only transition must begin at turn 37");
  assert(reminderOnly.memory.personalFromStep === undefined
      && reminderOnly.memory.noHistoryFromStep === undefined
      && reminderOnly.memory.omitPriorBeliefFromStep === undefined,
  "Reminder-only condition unexpectedly enables another transition mode");
  assert(noHistory.memory.noHistoryFromStep === 37, "No-history transition must begin at turn 37");

  const sharedPhase = JSON.stringify(sharedPhaseCondition(personal));
  for (const condition of conditions) {
    assert(
      JSON.stringify(sharedPhaseCondition(condition)) === sharedPhase,
      `${condition.id}: differs from the other conditions before turn 37`,
    );
  }

  for (const rosterPath of manifest.rosterPaths) {
    const roster = loadStructured(rosterPath);
    assert(roster.agents.length === 12, `${rosterPath}: expected 12 agents`);
    assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
      `${rosterPath}: expected only Claude Haiku 4.5`);
    const sources = roster.agents.filter((agent) => agent.role === "contamination_agent");
    assert(sources.length === 2 && sources.every((agent) => agent.activeUntilStep === 36),
      `${rosterPath}: expected two sources that leave after turn 36`);
  }

  const plannedRuns = manifest.scenarios.length
    * manifest.conditions.length
    * manifest.rosterPaths.length
    * manifest.seeds.length;
  const plannedModelCalls = plannedRuns * manifest.budget.maxModelCalls;
  assert(plannedRuns === 96, `Expected 96 runs, found ${plannedRuns}`);
  assert(plannedModelCalls === 6336, `Expected 6,336 calls, found ${plannedModelCalls}`);

  return {
    passed: true,
    mode: "preflight-only",
    manifest: manifestRelativePath,
    conditions: expectedIds,
    speakingOrders: 24,
    plannedRuns,
    plannedModelCalls,
    executionBlocked: !args.includes("--execute"),
  };
}

if (args.some((arg) => arg !== "--execute")) {
  throw new Error("Only --execute is accepted. Omit it for the safe preflight.");
}

const report = preflight();
console.log(JSON.stringify(report, null, 2));

if (!args.includes("--execute")) {
  console.log("\nPREFLIGHT ONLY. No model API calls were made.");
  console.log("DO NOT RUN with --execute until the preflight has been reviewed and execution is explicitly approved.");
  process.exit(0);
}

console.error("\nEXECUTION EXPLICITLY ENABLED: launching the frozen 96-run grid.");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/cli.ts", "experiment", manifestRelativePath],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
