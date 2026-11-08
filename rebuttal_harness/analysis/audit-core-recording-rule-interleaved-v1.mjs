import { auditRecordingRuleGrid } from "./lib/recording-rule-grid-audit.mjs";

const gridResultPath = process.argv[2];
if (!gridResultPath) {
  throw new Error(
    "Usage: node analysis/audit-core-recording-rule-interleaved-v1.mjs "
      + "output/core_recording_rule_interleaved_v1-grid-results.json",
  );
}

const report = auditRecordingRuleGrid(gridResultPath, {
  gridId: "core_recording_rule_interleaved_v1",
  expectedCells: 96,
});
console.log(JSON.stringify(report, null, 2));
if (!report.eligibleForAnalysis) process.exitCode = 1;
