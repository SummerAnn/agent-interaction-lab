import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const execute = process.argv.includes("--execute");
const nodeArgs = [
  "--import",
  "tsx",
  "analysis/audit-confidence-display-ablation-v1.mjs",
  "--static",
];

execFileSync(process.execPath, nodeArgs, { cwd: root, stdio: "inherit" });

if (!execute) {
  console.log("\nPREFLIGHT PASSED. No model or API calls were made.");
  console.log("Planned launch: 48 executions, at most 1,728 Claude Haiku calls.");
  console.log("Use --execute only after the user explicitly authorizes this batch.");
  process.exit(0);
}

if (process.env.CONFIDENCE_DISPLAY_ABLATION_APPROVED !== "YES") {
  throw new Error(
    "Execution requires CONFIDENCE_DISPLAY_ABLATION_APPROVED=YES after explicit user authorization.",
  );
}

execFileSync(process.execPath, [
  "--import",
  "tsx",
  "src/cli.ts",
  "experiment",
  "experiments/confidence-display-ablation-haiku-scale12-v1.json",
], { cwd: root, stdio: "inherit" });
