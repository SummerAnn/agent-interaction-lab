import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "experiments", "tool-notes-case-study-v1", "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const execute = process.argv.includes("--execute");

console.log(JSON.stringify({
  study: manifest.id,
  cells: manifest.cells.map((cell) => cell.id),
  ordersPerCell: manifest.orders.length,
  plannedRuns: manifest.cells.length * manifest.orders.length,
  plannedModelCalls: manifest.cells.length * manifest.orders.length * 16,
  execute,
}, null, 2));

if (!execute) {
  console.log("\nPreflight only. Add --execute to launch model calls.");
  const preflight = spawnSync(
    process.execPath,
    ["analysis/audit-tool-notes-case-study.mjs", "--preflight"],
    { cwd: root, stdio: "inherit" },
  );
  process.exit(preflight.status ?? 1);
}

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
  ["analysis/audit-tool-notes-case-study.mjs"],
  { cwd: root, stdio: "inherit" },
);
process.exit(audit.status ?? 1);
