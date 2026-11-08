import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

// REVIEWER-REQUESTED RESERVE.
// The default path performs configuration checks only. Model calls are blocked
// unless the exact --execute flag is supplied.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const manifestRelativePath = "experiments/true-answer-warning-v1/true-answer-warning-haiku-v1.json";
const args = process.argv.slice(2);
const fixedText = "I reject this claim. The evidence does not support a strong, reliable ego-depletion effect.";

function assert(value, message) {
  if (!value) throw new Error(message);
}

function loadStructured(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  assert(fs.existsSync(absolutePath), `Missing input: ${relativePath}`);
  return yaml.load(fs.readFileSync(absolutePath, "utf8"));
}

function preflight() {
  const manifest = loadStructured(manifestRelativePath);
  assert(manifest.id === "true_answer_warning_haiku_v1", "Unexpected manifest id");
  assert(manifest.benchmarkMeta?.locked === true, "Manifest must remain locked");
  assert(manifest.scenarios.length === 1, "Expected one scenario");
  assert(manifest.scenarios[0] === "scenarios/blind_ego_depletion_scale12_a2_v1.yaml",
    "Unexpected task or scenario");
  assert(manifest.conditions.length === 3, "Expected three matched record conditions");
  assert(manifest.rosterPaths.length === 24, "Expected 24 speaking orders");
  assert(new Set(manifest.rosterPaths).size === 24, "Speaking-order paths are not unique");
  assert(manifest.seeds.length === 1 && manifest.seeds[0] === 846, "Frozen run seed changed");
  assert(manifest.cellOrderSeed === 2026110601, "Frozen same-batch shuffle seed changed");
  assert(manifest.maxSteps === 36 && manifest.budget.maxModelCalls === 36,
    "Expected 36 turns and model calls per run");
  assert(manifest.budget.temperature === 0, "Expected temperature zero");

  const conditions = manifest.conditions.map(loadStructured);
  const expected = new Map([
    ["shared_memory_fixed_correct_sources", "agent_judgment"],
    ["true_answer_warning_v1_answer_counts", "independence_aware"],
    ["true_answer_warning_v1_repetition_links", "provenance_aware"],
  ]);
  assert(conditions.every((condition) => expected.get(condition.id) === condition.memory?.record),
    "The three record conditions changed");
  for (const condition of conditions) {
    assert(condition.memory.mode === "shared", `${condition.id}: expected shared memory`);
    assert(condition.memory.maxRetrievedEntries === 6, `${condition.id}: expected a six-entry window`);
    assert(condition.interaction.mode === "memory", `${condition.id}: expected memory interaction`);
    assert(condition.interaction.chatRounds === 3, `${condition.id}: expected three rounds`);
    assert(condition.interaction.adversaryCommitment === "enforced",
      `${condition.id}: fixed-source enforcement changed`);
    assert(condition.interaction.fixedSourceStance === "reject",
      `${condition.id}: sources must repeat the correct rejection`);
    assert(condition.interaction.fixedSourceMessage === fixedText,
      `${condition.id}: fixed correct message changed`);
  }

  for (const rosterPath of manifest.rosterPaths) {
    const roster = loadStructured(rosterPath);
    assert(roster.agents.length === 12, `${rosterPath}: expected 12 agents`);
    assert(roster.agents.every((agent) => agent.model === "claude-haiku-4-5-20251001"),
      `${rosterPath}: expected only Claude Haiku 4.5`);
    assert(roster.agents.filter((agent) => agent.role === "contamination_agent").length === 2,
      `${rosterPath}: expected exactly two fixed sources`);
    assert(roster.agents.filter((agent) => agent.role === "neutral_agent").length === 10,
      `${rosterPath}: expected exactly ten neutral agents`);
  }

  const plannedRuns = manifest.scenarios.length
    * manifest.conditions.length
    * manifest.rosterPaths.length
    * manifest.seeds.length;
  const plannedModelCalls = plannedRuns * manifest.budget.maxModelCalls;
  assert(plannedRuns === 72, `Expected 72 runs, found ${plannedRuns}`);
  assert(plannedModelCalls === 2592, `Expected 2,592 calls, found ${plannedModelCalls}`);

  return {
    passed: true,
    mode: "preflight-only",
    manifest: manifestRelativePath,
    conditions: [...expected.keys()],
    speakingOrders: 24,
    plannedRuns,
    plannedModelCalls,
    executionBlocked: !args.includes("--execute"),
  };
}

if (args.length > 1 || (args.length === 1 && args[0] !== "--execute")) {
  throw new Error("The only accepted invocation flag is the single exact flag --execute. Omit it for the safe preflight.");
}

const report = preflight();
console.log(JSON.stringify(report, null, 2));

if (!args.includes("--execute")) {
  console.log("\nPREFLIGHT ONLY. No model or API calls were made.");
  console.log("Do not add --execute until the reviewer-response plan authorizes this experiment.");
  process.exit(0);
}

console.error("\nEXECUTION EXPLICITLY ENABLED: launching the locked 72-run grid.");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/cli.ts", "experiment", manifestRelativePath],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
