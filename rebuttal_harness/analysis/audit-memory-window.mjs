import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "output");
const conditions = [
  ["k3", "shared_memory_fixed_sources_k3", "yoked_scale12_memory_window_v1_"],
  ["k6", "shared_memory_fixed_sources", "yoked_scale12_memory_window_k6_v1_"],
  ["k12", "shared_memory_fixed_sources_k12", "yoked_scale12_memory_window_k12_v1_"],
  ["full", "shared_memory_fixed_sources_full", "yoked_scale12_memory_window_full_v1_"],
];

function query(db, sql) {
  const raw = execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

const report = { design: "12 agents, 2 fixed persistent sources, 10 neutral agents, 12 speaking orders", conditions: {} };
for (const [label, condition, prefix] of conditions) {
  const dirs = fs.readdirSync(output)
    .filter((name) => name.startsWith(prefix) && name.includes(`_${condition}_`) && fs.existsSync(path.join(output, name, "summary.json")))
    .map((name) => path.join(output, name));
  const unique = new Map();
  for (const dir of dirs) {
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    unique.set(summary.runId, { dir, summary });
  }
  const counts = { endorse: 0, reject: 0, uncertain: 0 };
  const perRun = [];
  let sourceFinalEndorse = 0;
  let sourceFinalTotal = 0;
  let completeCalls = true;
  for (const { dir, summary } of unique.values()) {
    const db = path.join(dir, "trace.db");
    const finals = query(db, `
      WITH last_step AS (
        SELECT agent_id, MAX(step_index) AS step_index
        FROM agent_claim_states GROUP BY agent_id
      )
      SELECT s.agent_id, s.stance
      FROM agent_claim_states s
      JOIN last_step l ON s.agent_id=l.agent_id AND s.step_index=l.step_index
      ORDER BY s.agent_id;
    `);
    const neutral = finals.filter((row) => !["analyst_1", "analyst_7"].includes(row.agent_id));
    const sources = finals.filter((row) => ["analyst_1", "analyst_7"].includes(row.agent_id));
    for (const row of neutral) counts[row.stance] += 1;
    sourceFinalEndorse += sources.filter((row) => row.stance === "endorse").length;
    sourceFinalTotal += sources.length;
    const calls = query(db, "SELECT COUNT(*) AS n FROM model_calls;")[0]?.n ?? 0;
    completeCalls &&= calls === 36;
    perRun.push({ runId: summary.runId, endorse: neutral.filter((r) => r.stance === "endorse").length, reject: neutral.filter((r) => r.stance === "reject").length, uncertain: neutral.filter((r) => r.stance === "uncertain").length, calls });
  }
  report.conditions[label] = {
    condition,
    runs: unique.size,
    neutralFinal: counts,
    neutralTotal: counts.endorse + counts.reject + counts.uncertain,
    runsAnyEndorse: perRun.filter((r) => r.endorse > 0).length,
    runsAllEndorse: perRun.filter((r) => r.endorse === 10).length,
    sourceFinalEndorse,
    sourceFinalTotal,
    completeCalls,
    perRun,
  };
}

const out = path.join(import.meta.dirname, "memory-window-audit.json");
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Saved ${out}`);
