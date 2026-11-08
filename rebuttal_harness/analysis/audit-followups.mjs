import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "output");
const batches = {
  warning: "yoked_scale12_mitigation_warning_v1_",
  saveUncertain: "yoked_scale12_mitigation_save_uncertain_v1_",
  arithmetic: "yoked_scale12_task_arithmetic_v1_",
  pandasHaiku: "yoked_scale12_task_pandas_v1_",
  pandasSonnet: "yoked_scale12_model_sonnet_pandas_v1_",
  pandasOpus: "yoked_scale12_model_opus_pandas_v1_",
  correction: "yoked_scale12_mitigation_correction_v1_",
  personal: "yoked_scale12_personal_fixed_v1_",
};
function query(db, sql) {
  const raw = execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}
const report = {};
for (const [label, prefix] of Object.entries(batches)) {
  const dirs = fs.readdirSync(output).filter((n) => n.startsWith(prefix)
    && (label !== "correction" || n.includes("_shared_memory_fixed_sources_correction_"))
    && fs.existsSync(path.join(output,n,"summary.json")));
  const counts = { endorse:0, reject:0, uncertain:0 };
  let sourceEndorse=0, sourceTotal=0, allComplete=true;
  const perRun=[];
  for (const name of dirs) {
    const db=path.join(output,name,"trace.db");
    const finals=query(db,`WITH last_step AS (SELECT agent_id, MAX(step_index) step_index FROM agent_claim_states GROUP BY agent_id) SELECT s.agent_id,s.stance FROM agent_claim_states s JOIN last_step l ON s.agent_id=l.agent_id AND s.step_index=l.step_index ORDER BY s.agent_id;`);
    const neutral=finals.filter(r=>!["analyst_1","analyst_7"].includes(r.agent_id));
    const sources=finals.filter(r=>["analyst_1","analyst_7"].includes(r.agent_id));
    for (const r of neutral) counts[r.stance]++;
    sourceEndorse += sources.filter(r=>r.stance==="endorse").length; sourceTotal += sources.length;
    const calls=query(db,"SELECT COUNT(*) n FROM model_calls;")[0]?.n ?? 0; allComplete &&= calls===36;
    perRun.push({name, endorse:neutral.filter(r=>r.stance==="endorse").length,reject:neutral.filter(r=>r.stance==="reject").length,uncertain:neutral.filter(r=>r.stance==="uncertain").length,calls});
  }
  report[label]={runs:dirs.length,neutralFinal:counts,neutralTotal:Object.values(counts).reduce((a,b)=>a+b,0),runsAnyEndorse:perRun.filter(r=>r.endorse>0).length,runsAllEndorse:perRun.filter(r=>r.endorse===10).length,sourceFinalEndorse:sourceEndorse,sourceFinalTotal:sourceTotal,completeCalls:allComplete,perRun};
}
const out=path.join(import.meta.dirname,"followup-audit.json");
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
