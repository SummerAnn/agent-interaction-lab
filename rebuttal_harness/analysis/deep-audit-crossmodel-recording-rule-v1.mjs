import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  throw new Error(
    "Usage: node analysis/deep-audit-crossmodel-recording-rule-v1.mjs "
      + "<pandas-grid-results.json> <scitat-a-grid-results.json>",
  );
}

function query(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return raw ? JSON.parse(raw) : [];
}

function readStructured(filePath) {
  return yaml.load(fs.readFileSync(filePath, "utf8"));
}

function latestNeutralStates(dbPath) {
  return query(dbPath, `
    WITH latest AS (
      SELECT agent_id, claim_id, MAX(step_index) AS step_index
      FROM agent_claim_states
      WHERE step_index > 0
      GROUP BY agent_id, claim_id
    ), sources AS (
      SELECT DISTINCT agent_id
      FROM events
      WHERE event_type = 'fixed_source_statement'
    )
    SELECT s.agent_id AS agentId, s.step_index AS stepIndex, s.stance, s.confidence
    FROM agent_claim_states s
    JOIN latest l
      ON s.agent_id = l.agent_id
     AND s.claim_id = l.claim_id
     AND s.step_index = l.step_index
    WHERE s.agent_id NOT IN (SELECT agent_id FROM sources)
    ORDER BY s.agent_id;
  `);
}

function countStances(rows) {
  const result = { E: 0, U: 0, R: 0 };
  for (const row of rows) {
    if (row.stance === "endorse") result.E += 1;
    else if (row.stance === "uncertain") result.U += 1;
    else if (row.stance === "reject") result.R += 1;
  }
  return result;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index];
}

function addCounts(target, source) {
  target.E += source.E;
  target.U += source.U;
  target.R += source.R;
}

const cells = [];
for (const gridPath of paths) {
  const result = JSON.parse(fs.readFileSync(gridPath, "utf8"));
  const conditionRefs = new Map(result.inputCatalog.conditions.map((item) => [item.id, item]));
  const scenarioRefs = new Map(result.inputCatalog.scenarios.map((item) => [item.id, item]));
  const rosterRefs = new Map(result.inputCatalog.rosters.map((item) => [item.id, item]));
  const conditions = new Map([...conditionRefs].map(([id, item]) => [id, readStructured(item.path)]));
  const scenarios = new Map([...scenarioRefs].map(([id, item]) => [id, readStructured(item.path)]));
  const rosters = new Map([...rosterRefs].map(([id, item]) => [id, readStructured(item.path)]));

  for (const cell of result.cells) {
    const condition = conditions.get(cell.conditionId);
    const scenario = scenarios.get(cell.scenarioId);
    const roster = rosters.get(cell.rosterId);
    const model = [...new Set(roster.agents.map((agent) => agent.model))][0];
    const sourcePositions = roster.agents
      .map((agent, index) => agent.role === "contamination_agent" ? index + 1 : null)
      .filter((value) => value !== null);
    const rule = condition.memory?.writeUncertainAnswers === true ? "save_uncertain" : "omit_uncertain";
    const finals = countStances(latestNeutralStates(cell.summary.dbPath));
    const callRows = query(
      cell.summary.dbPath,
      "SELECT prompt_tokens AS promptTokens, completion_tokens AS completionTokens, total_tokens AS totalTokens FROM model_calls;",
    );
    const traceRows = query(
      cell.summary.dbPath,
      "SELECT step_index AS stepIndex, agent_id AS agentId, context_json AS contextJson FROM retrieval_traces;",
    );
    const parsedContexts = traceRows.map((row) => ({ ...row, context: JSON.parse(row.contextJson) }));
    const invalidParses = parsedContexts.filter((row) => row.context.responseParseValid === false).length;
    const rawResponses = parsedContexts
      .map((row) => row.context.rawResponse)
      .filter((response) => typeof response === "string");
    const malformedRawJson = rawResponses.filter((response) => {
      try {
        JSON.parse(response);
        return false;
      } catch {
        return true;
      }
    }).length;

    cells.push({
      gridId: result.grid.id,
      task: cell.scenarioId,
      truthLabel: scenario.claims.find((claim) => claim.id === scenario.focusClaimId)?.truthLabel ?? "unknown",
      model,
      condition: cell.conditionId,
      rule,
      roster: cell.rosterId,
      sourcePositions,
      runId: cell.summary.runId,
      dbPath: cell.summary.dbPath,
      finals,
      invalidParses,
      malformedRawJson,
      promptTokens: callRows.map((row) => row.promptTokens),
      completionTokens: callRows.map((row) => row.completionTokens),
      totalTokens: callRows.map((row) => row.totalTokens),
    });
  }
}

const grouped = new Map();
for (const cell of cells) {
  const key = `${cell.model}|${cell.task}|${cell.rule}`;
  const row = grouped.get(key) ?? {
    model: cell.model,
    task: cell.task,
    truthLabel: cell.truthLabel,
    rule: cell.rule,
    runs: 0,
    neutralFinals: { E: 0, U: 0, R: 0 },
    runsWithEndorsement: 0,
    runsWithUncertainty: 0,
    runsWithRejection: 0,
    runOutcomeHistogram: {},
    invalidParses: 0,
    malformedRawJson: 0,
    promptTokens: [],
    completionTokens: [],
    totalTokens: [],
  };
  row.runs += 1;
  addCounts(row.neutralFinals, cell.finals);
  if (cell.finals.E > 0) row.runsWithEndorsement += 1;
  if (cell.finals.U > 0) row.runsWithUncertainty += 1;
  if (cell.finals.R > 0) row.runsWithRejection += 1;
  const outcome = `${cell.finals.E}E/${cell.finals.U}U/${cell.finals.R}R`;
  row.runOutcomeHistogram[outcome] = (row.runOutcomeHistogram[outcome] ?? 0) + 1;
  row.invalidParses += cell.invalidParses;
  row.malformedRawJson += cell.malformedRawJson;
  row.promptTokens.push(...cell.promptTokens);
  row.completionTokens.push(...cell.completionTokens);
  row.totalTokens.push(...cell.totalTokens);
  grouped.set(key, row);
}

const conditionSummary = [...grouped.values()].map((row) => {
  const completion = row.completionTokens.toSorted((a, b) => a - b);
  const prompt = row.promptTokens.toSorted((a, b) => a - b);
  const totalFinals = row.neutralFinals.E + row.neutralFinals.U + row.neutralFinals.R;
  return {
    model: row.model,
    task: row.task,
    truthLabel: row.truthLabel,
    rule: row.rule,
    runs: row.runs,
    neutralFinals: row.neutralFinals,
    neutralFinalRates: {
      E: row.neutralFinals.E / totalFinals,
      U: row.neutralFinals.U / totalFinals,
      R: row.neutralFinals.R / totalFinals,
    },
    runsWithEndorsement: row.runsWithEndorsement,
    runsWithUncertainty: row.runsWithUncertainty,
    runsWithRejection: row.runsWithRejection,
    runOutcomeHistogram: row.runOutcomeHistogram,
    invalidParses: row.invalidParses,
    malformedRawJson: row.malformedRawJson,
    tokenHealth: {
      calls: completion.length,
      completionMin: completion[0] ?? null,
      completionMedian: quantile(completion, 0.5),
      completionP95: quantile(completion, 0.95),
      completionMax: completion.at(-1) ?? null,
      callsAtOrAbove380: completion.filter((value) => value >= 380).length,
      promptMedian: quantile(prompt, 0.5),
      promptP95: quantile(prompt, 0.95),
      promptMax: prompt.at(-1) ?? null,
    },
  };
}).sort((a, b) => a.task.localeCompare(b.task) || a.model.localeCompare(b.model) || a.rule.localeCompare(b.rule));

const paired = new Map();
for (const cell of cells) {
  const key = `${cell.model}|${cell.task}|${cell.roster}`;
  const row = paired.get(key) ?? {
    model: cell.model,
    task: cell.task,
    truthLabel: cell.truthLabel,
    roster: cell.roster,
  };
  row[cell.rule] = cell;
  paired.set(key, row);
}

const pairedByGroup = new Map();
for (const pair of paired.values()) {
  const key = `${pair.model}|${pair.task}`;
  const group = pairedByGroup.get(key) ?? {
    model: pair.model,
    task: pair.task,
    truthLabel: pair.truthLabel,
    matchedOrders: 0,
    endorsementLowerWithSaving: 0,
    endorsementHigherWithSaving: 0,
    endorsementUnchanged: 0,
    totalEndorsementDifferenceSaveMinusOmit: 0,
    transitions: {},
    orderDetails: [],
  };
  if (!pair.omit_uncertain || !pair.save_uncertain) {
    group.orderDetails.push({ roster: pair.roster, missingRule: !pair.omit_uncertain ? "omit_uncertain" : "save_uncertain" });
    pairedByGroup.set(key, group);
    continue;
  }
  group.matchedOrders += 1;
  const omit = pair.omit_uncertain.finals;
  const save = pair.save_uncertain.finals;
  const deltaE = save.E - omit.E;
  if (deltaE < 0) group.endorsementLowerWithSaving += 1;
  else if (deltaE > 0) group.endorsementHigherWithSaving += 1;
  else group.endorsementUnchanged += 1;
  group.totalEndorsementDifferenceSaveMinusOmit += deltaE;
  const transition = `${omit.E}E/${omit.U}U/${omit.R}R -> ${save.E}E/${save.U}U/${save.R}R`;
  group.transitions[transition] = (group.transitions[transition] ?? 0) + 1;
  group.orderDetails.push({
    roster: pair.roster,
    sourcePositions: pair.omit_uncertain.sourcePositions,
    omit,
    save,
    deltaE,
  });
  pairedByGroup.set(key, group);
}

const report = {
  inputs: paths.map((item) => path.resolve(item)),
  cellCount: cells.length,
  conditionSummary,
  pairedOrderEffects: [...pairedByGroup.values()].sort((a, b) =>
    a.task.localeCompare(b.task) || a.model.localeCompare(b.model)),
};

console.log(JSON.stringify(report, null, 2));
