import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

const gridResultPath = process.argv[2];
if (!gridResultPath) {
  throw new Error("Usage: node analysis/audit-entry-reply-grid.mjs <grid-result.json>");
}

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

const result = JSON.parse(fs.readFileSync(path.resolve(gridResultPath), "utf8"));
const conditionById = new Map(result.inputCatalog.conditions.map((conditionRef) => {
  const condition = yaml.load(fs.readFileSync(conditionRef.path, "utf8"));
  return [condition.id, condition];
}));

const failures = [];
const cells = [];
for (const cell of result.cells) {
  const condition = conditionById.get(cell.conditionId);
  if (!condition) throw new Error(`Condition ${cell.conditionId} is absent from the input catalog.`);
  const repliesEnabled = condition.memory?.allowEntryReplies === true;
  const replyEvents = query(
    cell.summary.dbPath,
    "SELECT run_id AS runId, step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson "
      + "FROM events WHERE event_type = 'memory_entry_reply';",
  );
  const traces = query(
    cell.summary.dbPath,
    "SELECT step_index AS stepIndex, agent_id AS agentId, retrieved_entry_ids_json AS retrievedIdsJson, "
      + "context_json AS contextJson FROM retrieval_traces;",
  );
  const traceByTurn = new Map(traces.map((trace) => [`${trace.stepIndex}|${trace.agentId}`, trace]));
  const memoryRows = query(
    cell.summary.dbPath,
    "SELECT memory_entry_id AS memoryEntryId, replied_to_entry_ids_json AS repliedToIdsJson FROM memory_entries;",
  );
  const memoryById = new Map(memoryRows.map((entry) => [entry.memoryEntryId, entry]));
  let invalidTargets = 0;
  let missingMemoryLinks = 0;
  let rejectedRequestedIds = 0;

  for (const event of replyEvents) {
    const payload = JSON.parse(event.outputJson);
    const trace = traceByTurn.get(`${event.stepIndex}|${event.agentId}`);
    const retrievedIds = new Set(trace ? JSON.parse(trace.retrievedIdsJson) : []);
    if (!retrievedIds.has(payload.repliedMemoryEntryId)) invalidTargets += 1;

    if (payload.responseMemoryEntryId) {
      const responseEntry = memoryById.get(payload.responseMemoryEntryId);
      const repliedToIds = responseEntry ? JSON.parse(responseEntry.repliedToIdsJson) : [];
      if (!repliedToIds.includes(payload.repliedMemoryEntryId)) missingMemoryLinks += 1;
    }
  }
  for (const trace of traces) {
    const context = JSON.parse(trace.contextJson);
    rejectedRequestedIds += Array.isArray(context.rejectedReplyEntryIds)
      ? context.rejectedReplyEntryIds.length
      : 0;
  }

  const replyLineageRows = query(
    cell.summary.dbPath,
    "SELECT COUNT(*) AS count FROM claim_lineage WHERE relation_type LIKE '%reply%';",
  )[0]?.count ?? 0;
  if (!repliesEnabled && replyEvents.length > 0) {
    failures.push(`${cell.summary.runId}: reply events appeared with replies disabled.`);
  }
  if (invalidTargets > 0) {
    failures.push(`${cell.summary.runId}: ${invalidTargets} reply targets were not retrieved on the same turn.`);
  }
  if (missingMemoryLinks > 0) {
    failures.push(`${cell.summary.runId}: ${missingMemoryLinks} reply events were absent from their response entry metadata.`);
  }
  if (replyLineageRows > 0) {
    failures.push(`${cell.summary.runId}: ${replyLineageRows} reply relations were written into causal claim_lineage.`);
  }
  cells.push({
    runId: cell.summary.runId,
    conditionId: cell.conditionId,
    repliesEnabled,
    replyEvents: replyEvents.length,
    invalidTargets,
    rejectedRequestedIds,
    missingMemoryLinks,
    replyLineageRows,
  });
}

const report = {
  gridId: result.grid.id,
  expectedCells: result.cells.length,
  repliesEnabledCells: cells.filter((cell) => cell.repliesEnabled).length,
  cellsWithAtLeastOneReply: cells.filter((cell) => cell.replyEvents > 0).length,
  replyEvents: cells.reduce((sum, cell) => sum + cell.replyEvents, 0),
  rejectedRequestedIds: cells.reduce((sum, cell) => sum + cell.rejectedRequestedIds, 0),
  failures,
  eligibleForAnalysis: failures.length === 0,
  cells,
};
console.log(JSON.stringify(report, null, 2));
