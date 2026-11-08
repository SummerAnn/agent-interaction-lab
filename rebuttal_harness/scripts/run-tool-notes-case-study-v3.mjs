import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Safe by default. The no-argument path only runs a static preflight.
// Paid calls require both --execute and an explicit authorization environment
// variable so an accidental command cannot launch the study.

const root = process.cwd();
const version = "tool-notes-case-study-v3";
const manifestPath = path.join(root, "experiments", version, "study-manifest.json");
const execute = process.argv.includes("--execute");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--execute");

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  process.exit(2);
}
if (!fs.existsSync(manifestPath)) {
  console.error("Missing manifest. Run node scripts/generate-tool-notes-case-study-v3.mjs first.");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
console.log(JSON.stringify({
  study: manifest.id,
  status: manifest.status,
  tasks: manifest.tasks.map((task) => task.id),
  methods: manifest.methods.map((method) => method.id),
  ordersPerTaskMethod: manifest.orders.length,
  plannedRuns: manifest.plannedRuns,
  callsPerRun: manifest.callsPerRun,
  plannedModelCalls: manifest.plannedModelCalls,
  execute,
}, null, 2));

if (!execute) {
  console.log("\nSAFE PREFLIGHT ONLY: no model or API calls will be made.");
  const preflight = spawnSync(
    process.execPath,
    ["analysis/audit-tool-notes-case-study-v3.mjs", "--preflight"],
    { cwd: root, stdio: "inherit" },
  );
  process.exit(preflight.status ?? 1);
}

if (process.env.TOOL_NOTES_CASE_STUDY_V3_AUTHORIZED !== "YES") {
  console.error("\nEXECUTION BLOCKED: set TOOL_NOTES_CASE_STUDY_V3_AUTHORIZED=YES only after the parent agent confirms that the user's authorization covers this exact 96-run, 1,536-call study.");
  process.exit(3);
}

console.error("\nEXECUTION AUTHORIZED: launching 96 runs with a hard harness cap of 1,536 logical model calls.");
const child = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/cli.ts", "experiment", manifest.experiment],
  { cwd: root, stdio: "inherit", env: process.env },
);
if (child.status !== 0) process.exit(child.status ?? 1);

const audit = spawnSync(
  process.execPath,
  ["analysis/audit-tool-notes-case-study-v3.mjs"],
  { cwd: root, stdio: "inherit" },
);
process.exit(audit.status ?? 1);
