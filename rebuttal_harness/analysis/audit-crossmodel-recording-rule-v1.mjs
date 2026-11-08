import { auditRecordingRuleGrid, mergeRawStanceSummaries } from "./lib/recording-rule-grid-audit.mjs";

const paths = process.argv.slice(2);
if (paths.length !== 3) {
  throw new Error(
    "Usage: node analysis/audit-crossmodel-recording-rule-v1.mjs "
      + "<pandas-grid-results.json> <scitat-a-grid-results.json> <frontier-grid-results.json>",
  );
}

const expected = new Map([
  ["crossmodel_pandas_recording_rule_v1", 96],
  ["crossmodel_scitat_a_recording_rule_v1", 96],
  ["frontier_gpt61_scitat_a_recording_rule_v1", 48],
]);
const reports = paths.map((gridResultPath) => auditRecordingRuleGrid(gridResultPath));
const failures = reports.flatMap((report) => report.failures.map((failure) => `${report.gridId}: ${failure}`));
const seen = new Set();
for (const report of reports) {
  if (!expected.has(report.gridId)) failures.push(`Unexpected grid ${report.gridId}.`);
  if (seen.has(report.gridId)) failures.push(`Grid ${report.gridId} was supplied more than once.`);
  seen.add(report.gridId);
  const expectedCells = expected.get(report.gridId);
  if (expectedCells !== undefined && report.cells.observed !== expectedCells) {
    failures.push(`${report.gridId}: expected ${expectedCells} registered cells, found ${report.cells.observed}.`);
  }
}
for (const gridId of expected.keys()) {
  if (!seen.has(gridId)) failures.push(`Required grid ${gridId} was not supplied.`);
}

const combined = {
  grids: reports.map((report) => ({
    gridId: report.gridId,
    gridResultPath: report.gridResultPath,
    cells: report.cells,
    eligibleForAnalysis: report.eligibleForAnalysis,
  })),
  // These are raw final stances for neutral agents. No interpretation of
  // endorse as "false" is made, which is essential for mixed-label PANDAS.
  rawStanceSummary: mergeRawStanceSummaries(reports),
  traceTotals: {
    modelCalls: reports.reduce((sum, report) => sum + report.traceTotals.modelCalls, 0),
    fixedSourceEvents: reports.reduce((sum, report) => sum + report.traceTotals.fixedSourceEvents, 0),
    invalidParses: reports.reduce((sum, report) => sum + report.traceTotals.invalidParses, 0),
    fallbackMemoryEntries: reports.reduce((sum, report) => sum + report.traceTotals.fallbackMemoryEntries, 0),
    sourceRetrievalsByNeutralAgents: reports.reduce(
      (sum, report) => sum + report.traceTotals.sourceRetrievalsByNeutralAgents,
      0,
    ),
  },
  failures,
  eligibleForAnalysis: failures.length === 0,
  perGrid: reports,
};
console.log(JSON.stringify(combined, null, 2));
if (!combined.eligibleForAnalysis) process.exitCode = 1;
