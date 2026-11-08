import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const resultPath = path.resolve(process.argv[2] ?? "output/content_mechanism_reply_affordance_v2-grid-results.json");
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

function query(dbPath) {
  const sql = `SELECT step_index AS step, json_extract(context_json,'$.promptAudit.systemPrompt') AS systemPrompt, json_extract(context_json,'$.promptAudit.userPrompt') AS userPrompt, json_extract(context_json,'$.rawResponse') AS rawResponse FROM retrieval_traces ORDER BY step_index;`;
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function parseResponse(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

const cells = new Map(result.cells.map((cell) => [`${cell.conditionId}|${cell.rosterId}`, cell]));
const rows = [];
for (let order = 1; order <= 24; order += 1) {
  const rosterId = `content_order_${String(order).padStart(2, "0")}`;
  const hidden = query(cells.get(`reply_v2_replies_hidden|${rosterId}`).summary.dbPath);
  const visible = query(cells.get(`reply_v2_replies_visible|${rosterId}`).summary.dbPath);
  const firstRenderedStep = visible.find((row) => row.userPrompt.includes("[replies to:"))?.step ?? null;
  const prelink = visible.filter((row) => firstRenderedStep === null || row.step < firstRenderedStep);
  rows.push({
    order,
    firstRenderedStep,
    comparedPrelinkSteps: prelink.length,
    prelinkPromptMismatches: prelink.filter((row) => {
      const other = hidden.find((candidate) => candidate.step === row.step);
      return !other || other.systemPrompt !== row.systemPrompt || other.userPrompt !== row.userPrompt;
    }).map((row) => row.step),
    prelinkResponseMismatches: prelink.filter((row) => hidden.find((candidate) => candidate.step === row.step)?.rawResponse !== row.rawResponse).map((row) => row.step),
    prelinkStanceMismatches: prelink.filter((row) => {
      const other = hidden.find((candidate) => candidate.step === row.step);
      return !other || parseResponse(other.rawResponse).stance !== parseResponse(row.rawResponse).stance;
    }).map((row) => row.step),
    prelinkConfidenceMismatches: prelink.filter((row) => {
      const other = hidden.find((candidate) => candidate.step === row.step);
      return !other || parseResponse(other.rawResponse).confidence !== parseResponse(row.rawResponse).confidence;
    }).map((row) => row.step),
  });
}

console.log(JSON.stringify({
  orders: rows.length,
  ordersWithPrelinkPromptMismatch: rows.filter((row) => row.prelinkPromptMismatches.length > 0).length,
  ordersWithPrelinkResponseMismatch: rows.filter((row) => row.prelinkResponseMismatches.length > 0).length,
  ordersWithPrelinkStanceMismatch: rows.filter((row) => row.prelinkStanceMismatches.length > 0).length,
  ordersWithPrelinkConfidenceMismatch: rows.filter((row) => row.prelinkConfidenceMismatches.length > 0).length,
  rows,
}, null, 2));
