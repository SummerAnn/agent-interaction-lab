import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "experiments", "experiment_b_same_batch_v1", "study-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function count(rows, stance) {
  return rows.filter((row) => row.stance === stance).length;
}

const runs = [];
for (const cell of manifest.cells) {
  const runConfig = JSON.parse(fs.readFileSync(cell.runConfigPath, "utf8"));
  const condition = JSON.parse(fs.readFileSync(cell.conditionPath, "utf8"));
  const runId = `${runConfig.id}-${condition.id}-seed${runConfig.seed}`;
  const summaryPath = path.join(runConfig.outputDir, runId, "summary.json");
  if (!fs.existsSync(summaryPath)) continue;
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const dbPath = summary.dbPath;
  const sourceIds = new Set(runConfig.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const configuredOrder = runConfig.agents.map((agent) => agent.id);
  const startOffset = cell.method === "shared_memory" ? runConfig.seed % configuredOrder.length : 0;
  const executedOrder = configuredOrder.slice(startOffset).concat(configuredOrder.slice(0, startOffset));
  const executedOrderKey = executedOrder.join(">");
  const finalStates = query(dbPath, `
    WITH last AS (
      SELECT agent_id, MAX(step_index) AS final_step
      FROM agent_claim_states
      WHERE claim_id='claim_ego_depletion'
      GROUP BY agent_id
    )
    SELECT s.agent_id AS agentId, s.stance
    FROM agent_claim_states s
    JOIN last l ON s.agent_id=l.agent_id AND s.step_index=l.final_step
    WHERE s.claim_id='claim_ego_depletion';
  `);
  const neutral = finalStates.filter((row) => !sourceIds.has(row.agentId));
  const sources = finalStates.filter((row) => sourceIds.has(row.agentId));
  const fixedEvents = query(dbPath, `
    SELECT json_extract(output_json,'$.text') AS text, COUNT(*) AS n
    FROM events
    WHERE event_type='fixed_source_statement'
    GROUP BY text;
  `);
  const chatSources = sourceIds.size === 0 ? [] : query(dbPath, `
    SELECT message_text AS text, COUNT(*) AS n
    FROM chat_messages
    WHERE agent_id IN (${[...sourceIds].map((id) => `'${id}'`).join(",")})
    GROUP BY message_text;
  `);
  const observedMessages = fixedEvents.length > 0 ? fixedEvents : chatSources;
  const callCount = query(dbPath, "SELECT COUNT(*) AS n FROM model_calls;")[0]?.n ?? 0;
  const createdAt = query(dbPath, "SELECT created_at AS createdAt FROM runs LIMIT 1;")[0]?.createdAt ?? null;
  runs.push({
    id: cell.id,
    arm: cell.arm,
    order: cell.order,
    executedOrder,
    executedOrderKey,
    runId,
    createdAt,
    callCount,
    sourceCount: sourceIds.size,
    sourceEndorse: count(sources, "endorse"),
    neutralCount: neutral.length,
    neutral: {
      endorse: count(neutral, "endorse"),
      reject: count(neutral, "reject"),
      uncertain: count(neutral, "uncertain"),
    },
    exactMessage: cell.hasSources
      ? observedMessages.length === 1 && observedMessages[0].text === cell.message && Number(observedMessages[0].n) === 6
      : observedMessages.length === 0,
  });
}

const byArm = {};
for (const arm of manifest.arms) {
  const subset = runs.filter((run) => run.arm === arm);
  byArm[arm] = {
    runs: subset.length,
    finalJudgments: {
      endorse: subset.reduce((sum, run) => sum + run.neutral.endorse, 0),
      reject: subset.reduce((sum, run) => sum + run.neutral.reject, 0),
      uncertain: subset.reduce((sum, run) => sum + run.neutral.uncertain, 0),
    },
    ordersWithAnyEndorsement: subset.filter((run) => run.neutral.endorse > 0).length,
    ordersWithAnyRejection: subset.filter((run) => run.neutral.reject > 0).length,
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let index = 1; index <= k; index += 1) {
    value *= (n - index + 1) / index;
  }
  return value;
}

function twoSidedSignP(leftWins, rightWins) {
  const n = leftWins + rightWins;
  if (n === 0) return 1;
  const smaller = Math.min(leftWins, rightWins);
  let tail = 0;
  for (let index = 0; index <= smaller; index += 1) {
    tail += choose(n, index) * (0.5 ** n);
  }
  return Math.min(1, 2 * tail);
}

const protocolComparisons = {};
for (const prefix of ["no_repeating_agents", "statement_only", "causal_explanation"]) {
  const memory = runs.filter((run) => run.arm === `${prefix}_shared_memory`);
  const debate = runs.filter((run) => run.arm === `${prefix}_live_debate`);
  const pairs = [];
  const executedOrderKeys = [...new Set([...memory, ...debate].map((run) => run.executedOrderKey))].sort();
  for (const executedOrderKey of executedOrderKeys) {
    const memoryRun = memory.find((run) => run.executedOrderKey === executedOrderKey);
    const debateRun = debate.find((run) => run.executedOrderKey === executedOrderKey);
    if (!memoryRun || !debateRun) continue;
    pairs.push({
      executedOrderKey,
      memoryRosterOrder: memoryRun.order,
      debateRosterOrder: debateRun.order,
      memoryEndorse: memoryRun.neutral.endorse,
      debateEndorse: debateRun.neutral.endorse,
      memoryReject: memoryRun.neutral.reject,
      debateReject: debateRun.neutral.reject,
      memoryUncertain: memoryRun.neutral.uncertain,
      debateUncertain: debateRun.neutral.uncertain,
    });
  }
  const memoryMoreReject = pairs.filter((pair) => pair.memoryReject > pair.debateReject).length;
  const debateMoreReject = pairs.filter((pair) => pair.debateReject > pair.memoryReject).length;
  const memoryMoreEndorse = pairs.filter((pair) => pair.memoryEndorse > pair.debateEndorse).length;
  const debateMoreEndorse = pairs.filter((pair) => pair.debateEndorse > pair.memoryEndorse).length;
  protocolComparisons[prefix] = {
    pairedOrders: pairs.length,
    rejection: {
      sharedMemoryHigher: memoryMoreReject,
      liveDebateHigher: debateMoreReject,
      ties: pairs.length - memoryMoreReject - debateMoreReject,
      signTestP: twoSidedSignP(memoryMoreReject, debateMoreReject),
    },
    endorsement: {
      sharedMemoryHigher: memoryMoreEndorse,
      liveDebateHigher: debateMoreEndorse,
      ties: pairs.length - memoryMoreEndorse - debateMoreEndorse,
      signTestP: twoSidedSignP(memoryMoreEndorse, debateMoreEndorse),
    },
    pairs,
  };
}

const times = runs.map((run) => run.createdAt).filter(Boolean).sort();
const report = {
  generatedAt: new Date().toISOString(),
  manifestPath,
  intendedRuns: manifest.plannedRuns,
  observedRuns: runs.length,
  executionWindow: times.length > 0 ? { firstRunCreatedAt: times[0], lastRunCreatedAt: times.at(-1) } : null,
  checks: {
    complete: runs.length === manifest.plannedRuns,
    uniqueRunIds: new Set(runs.map((run) => run.runId)).size === runs.length,
    eachArmHas24Orders: manifest.arms.every((arm) => runs.filter((run) => run.arm === arm).length === 24),
    completeOrderCoverage: manifest.arms.every((arm) => {
      const orders = runs.filter((run) => run.arm === arm).map((run) => run.order).sort((a, b) => a - b);
      return orders.length === 24 && orders.every((order, index) => order === index + 1);
    }),
    completeExecutedOrderCoverage: manifest.arms.every((arm) =>
      new Set(runs.filter((run) => run.arm === arm).map((run) => run.executedOrderKey)).size === 24
    ),
    everyRunHas36Calls: runs.every((run) => run.callCount === 36),
    allFinalStatesPresent: runs.every((run) => run.neutralCount === (run.sourceCount === 0 ? 12 : 10)),
    sourceRolesCorrect: runs.every((run) => run.sourceCount === (run.arm.startsWith("no_repeating_agents") ? 0 : 2)),
    everyFixedMessageExact: runs.every((run) => run.exactMessage),
    everySourceRetainsEndorsement: runs.every((run) => run.sourceCount === 0 || run.sourceEndorse === 2),
  },
  byArm,
  protocolComparisons,
  runs,
};

const reportPath = path.join(root, "analysis", "experiment-b-same-batch-v1-audit.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  observedRuns: report.observedRuns,
  checks: report.checks,
  byArm: report.byArm,
  protocolComparisons: report.protocolComparisons,
}, null, 2));
