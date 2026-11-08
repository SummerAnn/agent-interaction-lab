import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const resultPath = path.resolve(process.argv[2] ?? "output/content_mechanism_reply_affordance_v2-grid-results.json");
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function parseJson(raw, fallback = []) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function orderNumber(rosterId) {
  return Number(rosterId.match(/order_(\d+)/)?.[1] ?? NaN);
}

const byCondition = new Map();
for (const cell of result.cells) {
  const dbPath = cell.summary.dbPath;
  const roster = result.grid.rosters.find((candidate) => candidate.id === cell.rosterId);
  const sources = new Set(roster.agents.filter((agent) => agent.role === "contamination_agent").map((agent) => agent.id));
  const neutrals = new Set(roster.agents.filter((agent) => agent.role !== "contamination_agent").map((agent) => agent.id));
  const states = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, stance FROM agent_claim_states WHERE step_index > 0 ORDER BY step_index;");
  const latest = new Map();
  for (const state of states) latest.set(state.agentId, state);
  const final = { E: 0, U: 0, R: 0 };
  for (const agentId of neutrals) {
    const stance = latest.get(agentId)?.stance;
    if (stance === "endorse") final.E += 1;
    if (stance === "uncertain") final.U += 1;
    if (stance === "reject") final.R += 1;
  }
  const rounds = [1, 2, 3].map((round) => {
    const counts = { E: 0, U: 0, R: 0 };
    for (const state of states.filter((row) => Math.ceil(Number(row.stepIndex) / 12) === round && neutrals.has(row.agentId))) {
      if (state.stance === "endorse") counts.E += 1;
      if (state.stance === "uncertain") counts.U += 1;
      if (state.stance === "reject") counts.R += 1;
    }
    return counts;
  });

  const memories = query(dbPath, "SELECT memory_entry_id AS id, opaque_entry_id AS opaqueId, step_index AS stepIndex, agent_id AS agentId, stance, replied_to_opaque_entry_ids_json AS repliedOpaqueIdsJson FROM memory_entries ORDER BY step_index;");
  const memoryById = new Map(memories.map((entry) => [entry.id, entry]));
  const replyEvents = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, output_json AS outputJson FROM events WHERE event_type='memory_entry_reply' ORDER BY step_index;");
  const repliesByTurn = new Map();
  const replyTargets = { source: 0, neutral: 0, targetE: 0, targetU: 0, targetR: 0 };
  for (const event of replyEvents) {
    const payload = parseJson(event.outputJson, {});
    const target = memoryById.get(payload.repliedMemoryEntryId);
    const turnKey = `${event.stepIndex}|${event.agentId}`;
    if (!repliesByTurn.has(turnKey)) repliesByTurn.set(turnKey, []);
    repliesByTurn.get(turnKey).push(target);
    if (target) {
      if (sources.has(target.agentId)) replyTargets.source += 1;
      else replyTargets.neutral += 1;
      if (target.stance === "endorse") replyTargets.targetE += 1;
      if (target.stance === "uncertain") replyTargets.targetU += 1;
      if (target.stance === "reject") replyTargets.targetR += 1;
    }
  }
  let replyTurnsWithSource = 0;
  let replyTurnsAllSix = 0;
  let rejectingTurns = 0;
  let rejectingTurnsReplySource = 0;
  for (const [turnKey, targets] of repliesByTurn) {
    if (targets.some((target) => target && sources.has(target.agentId))) replyTurnsWithSource += 1;
    if (targets.length === 6) replyTurnsAllSix += 1;
    const [stepIndex, agentId] = turnKey.split("|");
    const state = states.find((row) => Number(row.stepIndex) === Number(stepIndex) && row.agentId === agentId);
    if (state?.stance === "reject") {
      rejectingTurns += 1;
      if (targets.some((target) => target && sources.has(target.agentId))) rejectingTurnsReplySource += 1;
    }
  }
  let finalRejectorsReplySource = 0;
  for (const agentId of neutrals) {
    const state = latest.get(agentId);
    if (state?.stance !== "reject") continue;
    const targets = repliesByTurn.get(`${state.stepIndex}|${agentId}`) ?? [];
    if (targets.some((target) => target && sources.has(target.agentId))) finalRejectorsReplySource += 1;
  }
  const traces = query(dbPath, "SELECT step_index AS stepIndex, agent_id AS agentId, retrieved_entry_ids_json AS retrievedIdsJson, context_json AS contextJson FROM retrieval_traces ORDER BY step_index;");
  let renderedPrompts = 0;
  let neutralRenderedPrompts = 0;
  let emptyNeutralTurns = 0;
  let nonEmptyNeutralTurnsWithoutReply = 0;
  for (const trace of traces) {
    const context = parseJson(trace.contextJson, {});
    const prompt = `${context.promptAudit?.systemPrompt ?? ""}\n${context.promptAudit?.userPrompt ?? ""}`;
    if (prompt.includes("[replies to:")) renderedPrompts += 1;
    if (neutrals.has(trace.agentId)) {
      if (prompt.includes("[replies to:")) neutralRenderedPrompts += 1;
      const retrievedIds = parseJson(trace.retrievedIdsJson, []);
      if (retrievedIds.length === 0) emptyNeutralTurns += 1;
      else if (!repliesByTurn.has(`${trace.stepIndex}|${trace.agentId}`)) nonEmptyNeutralTurnsWithoutReply += 1;
    }
  }
  const row = {
    order: orderNumber(cell.rosterId),
    rosterId: cell.rosterId,
    dbPath,
    final,
    rounds,
    replyEdges: replyEvents.length,
    replyTurns: repliesByTurn.size,
    replyTurnsWithSource,
    replyTurnsAllSix,
    rejectingTurns,
    rejectingTurnsReplySource,
    finalRejectorsReplySource,
    replyTargets,
    renderedPrompts,
    neutralRenderedPrompts,
    emptyNeutralTurns,
    nonEmptyNeutralTurnsWithoutReply,
  };
  if (!byCondition.has(cell.conditionId)) byCondition.set(cell.conditionId, []);
  byCondition.get(cell.conditionId).push(row);
}

for (const rows of byCondition.values()) rows.sort((a, b) => a.order - b.order);

function sumRows(rows) {
  const total = {
    runs: rows.length,
    runsWithE: 0,
    runsWithR: 0,
    final: { E: 0, U: 0, R: 0 },
    rounds: [1, 2, 3].map(() => ({ E: 0, U: 0, R: 0 })),
    replyEdges: 0,
    replyTurns: 0,
    replyTurnsWithSource: 0,
    replyTurnsAllSix: 0,
    rejectingTurns: 0,
    rejectingTurnsReplySource: 0,
    finalRejectorsReplySource: 0,
    replyTargets: { source: 0, neutral: 0, targetE: 0, targetU: 0, targetR: 0 },
    renderedPrompts: 0,
    neutralRenderedPrompts: 0,
    emptyNeutralTurns: 0,
    nonEmptyNeutralTurnsWithoutReply: 0,
  };
  for (const row of rows) {
    if (row.final.E > 0) total.runsWithE += 1;
    if (row.final.R > 0) total.runsWithR += 1;
    for (const key of ["E", "U", "R"]) total.final[key] += row.final[key];
    for (let index = 0; index < 3; index += 1) {
      for (const key of ["E", "U", "R"]) total.rounds[index][key] += row.rounds[index][key];
    }
    for (const key of ["replyEdges", "replyTurns", "replyTurnsWithSource", "replyTurnsAllSix", "rejectingTurns", "rejectingTurnsReplySource", "finalRejectorsReplySource", "renderedPrompts", "neutralRenderedPrompts", "emptyNeutralTurns", "nonEmptyNeutralTurnsWithoutReply"]) total[key] += row[key];
    for (const key of Object.keys(total.replyTargets)) total.replyTargets[key] += row.replyTargets[key];
  }
  total.perOrderFinalR = rows.map((row) => ({ order: row.order, R: row.final.R }));
  return total;
}

function paired(leftId, rightId) {
  const left = new Map(byCondition.get(leftId).map((row) => [row.order, row]));
  const right = new Map(byCondition.get(rightId).map((row) => [row.order, row]));
  const pairs = [...left.keys()].sort((a, b) => a - b).map((order) => ({
    order,
    leftR: left.get(order).final.R,
    rightR: right.get(order).final.R,
    differenceR: right.get(order).final.R - left.get(order).final.R,
    leftU: left.get(order).final.U,
    rightU: right.get(order).final.U,
  }));
  return {
    leftId,
    rightId,
    ordersRightHigherR: pairs.filter((pair) => pair.differenceR > 0).length,
    ordersEqualR: pairs.filter((pair) => pair.differenceR === 0).length,
    ordersRightLowerR: pairs.filter((pair) => pair.differenceR < 0).length,
    meanDifferenceR: pairs.reduce((sum, pair) => sum + pair.differenceR, 0) / pairs.length,
    pairs,
  };
}

const report = {
  conditions: Object.fromEntries([...byCondition.entries()].map(([id, rows]) => [id, sumRows(rows)])),
  comparisons: {
    controlToHidden: paired("reply_v2_id_control", "reply_v2_replies_hidden"),
    hiddenToVisible: paired("reply_v2_replies_hidden", "reply_v2_replies_visible"),
    controlToVisible: paired("reply_v2_id_control", "reply_v2_replies_visible"),
  },
};

console.log(JSON.stringify(report, null, 2));
