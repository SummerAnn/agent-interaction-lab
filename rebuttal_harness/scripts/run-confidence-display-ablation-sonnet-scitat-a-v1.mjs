import { execFileSync } from "node:child_process";
import path from "node:path";

import { resolveProvider } from "../src/llm/provider.ts";

const root = path.resolve(import.meta.dirname, "..");
const execute = process.argv.includes("--execute");
const model = "claude-sonnet-4-6";
const provider = resolveProvider(model, root);

execFileSync(process.execPath, [
  "--import",
  "tsx",
  "analysis/audit-confidence-display-ablation-sonnet-scitat-a-v1.mjs",
  "--static",
], { cwd: root, stdio: "inherit" });

if (!provider) {
  throw new Error("No provider is configured for claude-sonnet-4-6.");
}
if (provider.type !== "anthropic" || provider.model !== model
  || provider.baseUrl !== "https://api.anthropic.com") {
  throw new Error(
    `This study requires direct Anthropic access to ${model}; resolved ${provider.type}:${provider.model} at ${provider.baseUrl}.`,
  );
}

console.log("Direct Anthropic provider check passed for claude-sonnet-4-6.");

if (!execute) {
  console.log("\nPREFLIGHT PASSED. No model or API calls were made.");
  console.log("Planned launch: 48 executions and 1,728 logical Claude Sonnet 4.6 calls.");
  console.log("Use --execute only after the user explicitly authorizes this batch.");
  process.exit(0);
}

if (process.env.SONNET_SCITAT_CONFIDENCE_ABLATION_APPROVED !== "YES") {
  throw new Error(
    "Execution requires SONNET_SCITAT_CONFIDENCE_ABLATION_APPROVED=YES after explicit user authorization.",
  );
}

execFileSync(process.execPath, [
  "--import",
  "tsx",
  "src/cli.ts",
  "experiment",
  "experiments/confidence-display-ablation-sonnet-scitat-a-v1.json",
], { cwd: root, stdio: "inherit" });
