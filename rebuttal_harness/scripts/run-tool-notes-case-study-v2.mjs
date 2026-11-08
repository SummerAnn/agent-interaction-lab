import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// RESERVED REBUTTAL EXPERIMENT.
// DO NOT RUN WITH --execute unless a reviewer specifically asks for the
// 24-order tool-note replication. The default path is a no-API preflight.

const root = process.cwd();
const manifestPath = path.join(
  root,
  "experiments",
  "tool-notes-case-study-v2",
  "study-manifest.json",
);
const execute = process.argv.includes("--execute");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--execute");

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  process.exit(2);
}
if (!fs.existsSync(manifestPath)) {
  console.error("Missing v2 manifest. Run node scripts/generate-tool-notes-case-study-v2.mjs first.");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const summary = {
  study: manifest.id,
  status: manifest.status,
  cells: manifest.cells.map((cell) => cell.id),
  ordersPerCell: manifest.orders.length,
  plannedRuns: manifest.cells.length * manifest.orders.length,
  plannedModelCalls: manifest.cells.length * manifest.orders.length * 16,
  execute,
};
console.log(JSON.stringify(summary, null, 2));

if (!execute) {
  console.log("\nSAFE PREFLIGHT ONLY: no model/API calls will be made.");
  console.log("DO NOT add --execute unless a reviewer specifically requests this experiment.");
  const preflight = spawnSync(
    process.execPath,
    ["analysis/audit-tool-notes-case-study-v2.mjs", "--preflight"],
    { cwd: root, stdio: "inherit" },
  );
  process.exit(preflight.status ?? 1);
}

console.error("\nEXECUTION ENABLED: this launches 96 runs and up to 1,536 model calls.");
console.error("This path is reserved for a specific reviewer request.");

for (const cell of manifest.cells) {
  console.log(`\n=== ${cell.id} ===`);
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "experiment", cell.experiment],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  if (child.status !== 0) {
    process.exit(child.status ?? 1);
  }
}

const audit = spawnSync(
  process.execPath,
  ["analysis/audit-tool-notes-case-study-v2.mjs"],
  { cwd: root, stdio: "inherit" },
);
process.exit(audit.status ?? 1);
