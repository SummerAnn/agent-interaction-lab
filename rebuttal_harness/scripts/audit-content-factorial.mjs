import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outputRoot = path.join(root, "output");
const prefix = "content_factorial_ego_haiku_v1_order";
const expectedMessages = new Map();
for (const file of fs.readdirSync(path.join(root, "conditions", "content-factorial-v1"))) {
  const condition = JSON.parse(fs.readFileSync(path.join(root, "conditions", "content-factorial-v1", file), "utf8"));
  expectedMessages.set(condition.id, condition.interaction.fixedSourceMessage);
}

function query(dbPath, sql) {
  const value = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return value ? JSON.parse(value) : [];
}

const runs = [];
for (const name of fs.readdirSync(outputRoot)) {
  if (!name.startsWith(prefix)) continue;
  const summaryPath = path.join(outputRoot, name, "summary.json");
  if (!fs.existsSync(summaryPath)) continue;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const run = query(dbPath, "select run_id as runId, condition_id as conditionId, seed from runs limit 1;")[0];
  const finalStates = query(dbPath, `
    WITH last AS (
      SELECT agent_id, MAX(step_index) AS final_step
      FROM agent_claim_states WHERE claim_id='claim_ego_depletion' GROUP BY agent_id
    )
    SELECT s.agent_id AS agentId, s.stance
    FROM agent_claim_states s JOIN last l
      ON s.agent_id=l.agent_id AND s.step_index=l.final_step
    WHERE s.claim_id='claim_ego_depletion';
  `);
  const sources = new Set(["analyst_1", "analyst_7"]);
  const neutral = finalStates.filter((row) => !sources.has(row.agentId));
  const source = finalStates.filter((row) => sources.has(row.agentId));
  const count = (rows, stance) => rows.filter((row) => row.stance === stance).length;
  const fixedEvents = query(dbPath, `
    SELECT json_extract(output_json,'$.text') AS text, COUNT(*) AS n
    FROM events WHERE event_type='fixed_source_statement' GROUP BY text;
  `);
  const chatSource = query(dbPath, `
    SELECT message_text AS text, COUNT(*) AS n FROM chat_messages
    WHERE agent_id IN ('analyst_1','analyst_7') GROUP BY message_text;
  `);
  const observedMessages = fixedEvents.length > 0 ? fixedEvents : chatSource;
  const callCount = query(dbPath, "select count(*) as n from model_calls;")[0]?.n ?? 0;
  runs.push({
    runId: run.runId,
    conditionId: run.conditionId,
    seed: run.seed,
    neutral: {
      endorse: count(neutral, "endorse"),
      reject: count(neutral, "reject"),
      uncertain: count(neutral, "uncertain"),
    },
    sourceEndorse: count(source, "endorse"),
    callCount,
    exactMessage: observedMessages.length === 1
      && observedMessages[0].text === expectedMessages.get(run.conditionId)
      && Number(observedMessages[0].n) === 6,
  });
}

const byCondition = {};
for (const conditionId of [...expectedMessages.keys()].sort()) {
  const subset = runs.filter((run) => run.conditionId === conditionId);
  byCondition[conditionId] = {
    runs: subset.length,
    neutralFinal: {
      endorse: subset.reduce((sum, run) => sum + run.neutral.endorse, 0),
      reject: subset.reduce((sum, run) => sum + run.neutral.reject, 0),
      uncertain: subset.reduce((sum, run) => sum + run.neutral.uncertain, 0),
    },
    runsAnyEndorse: subset.filter((run) => run.neutral.endorse > 0).length,
    bySeed: Object.fromEntries([101, 202, 303].map((seed) => {
      const batch = subset.filter((run) => run.seed === seed);
      return [seed, {
        runs: batch.length,
        endorse: batch.reduce((sum, run) => sum + run.neutral.endorse, 0),
        reject: batch.reduce((sum, run) => sum + run.neutral.reject, 0),
        uncertain: batch.reduce((sum, run) => sum + run.neutral.uncertain, 0),
      }];
    })),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  intendedRuns: 576,
  observedRuns: runs.length,
  checks: {
    complete: runs.length === 576,
    uniqueRunIds: new Set(runs.map((run) => run.runId)).size === runs.length,
    eachConditionHas72Runs: Object.values(byCondition).every((row) => row.runs === 72),
    everyRunHas36Calls: runs.every((run) => run.callCount === 36),
    everySourceRetainsEndorsement: runs.every((run) => run.sourceEndorse === 2),
    everyFixedMessageExact: runs.every((run) => run.exactMessage),
  },
  byCondition,
  runs,
};
const reportPath = path.join(root, "analysis", "content-factorial-v1-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, observedRuns: report.observedRuns, checks: report.checks, byCondition }, null, 2));
