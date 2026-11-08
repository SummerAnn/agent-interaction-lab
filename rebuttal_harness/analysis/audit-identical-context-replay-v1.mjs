import fs from "node:fs";
import path from "node:path";
import {
  assert, fileSha256, fixedSourceIds, manifestPath, normalizeRendering, protocolPath,
  relative, resultPathForCell, resultsMarkdownPath, resultsPath, root, scheduleSeed,
  sha256, shuffled, sourceArm, sourceAuditPath, sqliteJson, sqlQuote, strictParse,
  studyManifestPath,
} from "./identical-context-replay-v1-common.mjs";

const staticOnly = process.argv.includes("--static");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--static");
assert(unknown.length === 0, `Unknown argument(s): ${unknown.join(", ")}`);
assert(fs.existsSync(manifestPath), "Missing replay manifest; run the prepare script first");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function almostEqual(a, b, tolerance = 1e-12) {
  return Math.abs(a - b) <= tolerance;
}

function staticAudit() {
  assert(manifest.id === "identical_context_replay_v1", "Unexpected manifest id");
  assert(manifest.status === "locked_not_executed", "Manifest is not locked before execution");
  assert(manifest.pairCount === 24 && manifest.plannedCalls === 48, "Unexpected design size");
  assert(manifest.model === "claude-haiku-4-5-20251001", "Pinned model changed");
  assert(manifest.temperature === 0 && manifest.concurrency === 1, "Execution settings changed");
  assert(manifest.scheduleSeed === scheduleSeed, "Schedule seed changed");
  assert(fileSha256(protocolPath) === manifest.protocol.sha256, "Protocol hash changed");
  assert(fileSha256(sourceAuditPath) === manifest.sources.audit.sha256, "Source audit hash changed");
  assert(fileSha256(studyManifestPath) === manifest.sources.studyManifest.sha256, "Study manifest hash changed");
  assert(manifest.sources.arm === sourceArm, "Source arm changed");
  assert(manifest.pairs.length === 24, "Manifest does not contain 24 pairs");
  assert(new Set(manifest.pairs.map((pair) => pair.speakingOrder)).size === 24, "Speaking orders are not unique");
  assert(new Set(manifest.pairs.map((pair) => pair.pairId)).size === 24, "Pair ids are not unique");

  const expectedPairOrder = shuffled(manifest.pairs.map((pair) => pair.pairId), scheduleSeed);
  const expectedSchedule = expectedPairOrder.flatMap((pairId, index) => {
    const arms = (index + 1) % 2 ? ["record", "transcript"] : ["transcript", "record"];
    return arms.map((arm) => `${pairId}-${arm}`);
  });
  assert(JSON.stringify(manifest.schedule) === JSON.stringify(expectedSchedule), "Frozen schedule does not reproduce");
  assert(manifest.schedule.length === 48 && new Set(manifest.schedule).size === 48, "Schedule cells are incomplete or duplicated");
  const recordFirst = Array.from({ length: 24 }, (_, index) => manifest.schedule[index * 2].endsWith("-record")).filter(Boolean).length;
  assert(recordFirst === 12, "Arm order is not balanced 12/12");

  const forbidden = ["originalOutcome", "originalResponse", "rawResponse", "selectedOutcome", "apiKey"];
  const serialized = JSON.stringify(manifest);
  for (const key of forbidden) assert(!serialized.includes(`\"${key}\"`), `Manifest contains forbidden field ${key}`);
  for (const script of [
    path.join(root, "analysis", "prepare-identical-context-replay-v1.mjs"),
    path.join(root, "analysis", "audit-identical-context-replay-v1.mjs"),
  ]) {
    const source = fs.readFileSync(script, "utf8");
    assert(!source.includes(`call${"LLM"}(`), `${relative(script)} must not call models`);
    assert(!source.includes(`resolve${"Provider"}(`), `${relative(script)} must not resolve credentials`);
    assert(!source.includes(`fet${"ch"}(`), `${relative(script)} must not access the network`);
  }

  for (const pair of manifest.pairs) {
    assert(pair.sourceArm === sourceArm, `${pair.pairId}: source arm changed`);
    assert(pair.selectedResponseNumber === 3, `${pair.pairId}: target response is not the third`);
    assert(!fixedSourceIds.has(pair.selectedTarget), `${pair.pairId}: fixed source selected as target`);
    const dbPath = path.join(root, pair.tracePath);
    assert(fs.existsSync(dbPath), `${pair.pairId}: missing trace`);
    assert(fileSha256(dbPath) === pair.traceSha256, `${pair.pairId}: trace hash changed`);
    assert(pair.entries.length >= 4 && pair.entries.length <= 6, `${pair.pairId}: entry count out of range`);
    assert(JSON.stringify(pair.retrievedEntryIds) === JSON.stringify(pair.entries.map((entry) => entry.id)),
      `${pair.pairId}: entry order changed`);
    for (const entry of pair.entries) assert(entry.step < pair.selectedStep, `${pair.pairId}: future entry included`);
    assert(pair.model === manifest.model && pair.temperature === 0 && pair.maxTokens === 1024,
      `${pair.pairId}: model request settings changed`);
    assert(pair.structuredOutput.name === "submit_claim_assessment", `${pair.pairId}: output name changed`);
    assert(sha256(pair.systemPrompt) === pair.systemPromptSha256, `${pair.pairId}: system hash mismatch`);
    assert(sha256(pair.claimBlock) === pair.claimBlockSha256, `${pair.pairId}: claim hash mismatch`);
    assert(sha256(pair.priorStateBlock) === pair.priorStateBlockSha256, `${pair.pairId}: prior block hash mismatch`);
    assert(sha256(pair.decisionBlock) === pair.decisionBlockSha256, `${pair.pairId}: decision block hash mismatch`);
    for (const arm of ["record", "transcript"]) {
      const cell = pair.cells[arm];
      assert(cell.arm === arm && cell.cellId === `${pair.pairId}-${arm}`, `${pair.pairId}: malformed ${arm} cell`);
      assert(sha256(cell.presentationBlock) === cell.presentationBlockSha256, `${cell.cellId}: presentation hash mismatch`);
      assert(sha256(cell.userPrompt) === cell.userPromptSha256, `${cell.cellId}: user prompt hash mismatch`);
      assert(sha256(normalizeRendering(cell.userPrompt)) === cell.normalizedPromptSha256,
        `${cell.cellId}: normalized prompt hash mismatch`);
    }
    assert(normalizeRendering(pair.cells.record.userPrompt) === normalizeRendering(pair.cells.transcript.userPrompt),
      `${pair.pairId}: pair differs beyond permitted substitutions`);

    const states = sqliteJson(dbPath, `SELECT state_id, step_index, agent_id, stance, confidence FROM agent_claim_states ORDER BY state_id`);
    const counts = new Map();
    const thirds = [];
    for (const state of states) {
      if (state.step_index === 0) continue;
      if (fixedSourceIds.has(state.agent_id)) continue;
      const count = (counts.get(state.agent_id) ?? 0) + 1;
      counts.set(state.agent_id, count);
      if (count === 3) thirds.push(state);
    }
    const selected = thirds.sort((a, b) => a.state_id - b.state_id)[0];
    assert(selected.agent_id === pair.selectedTarget && selected.step_index === pair.selectedStep,
      `${pair.pairId}: selection rule does not reproduce`);
    const prior = states.filter((state) => state.agent_id === selected.agent_id && state.state_id < selected.state_id)
      .sort((a, b) => b.state_id - a.state_id)[0];
    assert(prior.stance === pair.priorState.stance && almostEqual(prior.confidence, pair.priorState.confidence),
      `${pair.pairId}: prior state does not reproduce`);
    const traces = sqliteJson(dbPath, `SELECT retrieved_entry_ids_json, context_json FROM retrieval_traces
      WHERE step_index=${Number(pair.selectedStep)} AND agent_id=${sqlQuote(pair.selectedTarget)}`);
    assert(traces.length === 1, `${pair.pairId}: selected trace does not reproduce`);
    assert(JSON.stringify(JSON.parse(traces[0].retrieved_entry_ids_json)) === JSON.stringify(pair.retrievedEntryIds),
      `${pair.pairId}: retrieved ids changed`);
    const context = JSON.parse(traces[0].context_json);
    assert(context.promptAudit.systemPrompt === pair.systemPrompt, `${pair.pairId}: system prompt changed`);
  }
  return { status: "pass", pairs: 24, cells: 48, recordFirst, transcriptFirst: 24 - recordFirst };
}

const staticResult = staticAudit();
if (staticOnly) {
  console.log(JSON.stringify({ audit: "identical-context-replay-v1", mode: "static", ...staticResult }, null, 2));
  process.exit(0);
}

function choose(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = result * (n - k + i) / i;
  return result;
}

function exactMcNemar(b, c) {
  const n = b + c;
  if (n === 0) return null;
  const tail = Math.min(b, c);
  let probability = 0;
  for (let k = 0; k <= tail; k += 1) probability += choose(n, k) * (0.5 ** n);
  return Math.min(1, 2 * probability);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bootstrapInterval(differences, iterations = 100000, seed = 2026110603) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) {
      sum += differences[Math.floor(random() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(0.025 * iterations)], samples[Math.floor(0.975 * iterations)]];
}

const cellMap = new Map();
for (const pair of manifest.pairs) for (const arm of ["record", "transcript"]) cellMap.set(pair.cells[arm].cellId, { pair, arm, cell: pair.cells[arm] });
const loaded = [];
for (const cellId of manifest.schedule) {
  const filePath = resultPathForCell(cellId);
  assert(fs.existsSync(filePath), `Missing result: ${relative(filePath)}`);
  const result = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const expected = cellMap.get(cellId);
  assert(result.status === "complete" && result.parseValid === true, `${cellId}: result incomplete or parse-invalid`);
  assert(result.cellId === cellId && result.pairId === expected.pair.pairId && result.arm === expected.arm,
    `${cellId}: result identity mismatch`);
  assert(result.request.model === expected.pair.model && result.request.temperature === expected.pair.temperature
    && result.request.maxTokens === expected.pair.maxTokens, `${cellId}: request settings mismatch`);
  assert(result.request.systemPromptSha256 === expected.pair.systemPromptSha256
    && result.request.userPromptSha256 === expected.cell.userPromptSha256, `${cellId}: prompt hashes mismatch`);
  const parsed = strictParse(result.rawResponse);
  assert(parsed.stance === result.parsed.stance && almostEqual(parsed.confidence, result.parsed.confidence),
    `${cellId}: stored parse does not match raw response`);
  assert(Array.isArray(result.attempts) && result.attempts.length >= 1, `${cellId}: attempt history missing`);
  loaded.push(result);
}
assert(loaded.length === 48 && new Set(loaded.map((result) => result.cellId)).size === 48, "Result cells are incomplete or duplicated");

const resultMap = new Map(loaded.map((result) => [result.cellId, result]));
let a = 0; let b = 0; let c = 0; let d = 0;
const stanceCounts = { record: { endorse: 0, reject: 0, uncertain: 0 }, transcript: { endorse: 0, reject: 0, uncertain: 0 } };
const confidences = { record: [], transcript: [] };
const pairedRows = [];
for (const pair of manifest.pairs.sort((left, right) => left.speakingOrder - right.speakingOrder)) {
  const record = resultMap.get(pair.cells.record.cellId);
  const transcript = resultMap.get(pair.cells.transcript.cellId);
  const recordE = record.parsed.stance === "endorse";
  const transcriptE = transcript.parsed.stance === "endorse";
  if (recordE && transcriptE) a += 1;
  else if (recordE) b += 1;
  else if (transcriptE) c += 1;
  else d += 1;
  stanceCounts.record[record.parsed.stance] += 1;
  stanceCounts.transcript[transcript.parsed.stance] += 1;
  confidences.record.push(record.parsed.confidence);
  confidences.transcript.push(transcript.parsed.confidence);
  pairedRows.push({
    speakingOrder: pair.speakingOrder, target: pair.selectedTarget, priorState: pair.priorState,
    entries: pair.entries.length, entryStances: pair.entries.reduce((counts, entry) => ({ ...counts, [entry.stance]: (counts[entry.stance] ?? 0) + 1 }), {}),
    record: record.parsed, transcript: transcript.parsed,
    stanceChanged: record.parsed.stance !== transcript.parsed.stance,
  });
}
const differences = pairedRows.map((row) => Number(row.record.stance === "endorse") - Number(row.transcript.stance === "endorse"));
const confidenceDifferences = pairedRows.map((row) => row.record.confidence - row.transcript.confidence);
const interval = bootstrapInterval(differences);
const summary = {
  status: "pass", generatedAt: new Date().toISOString(), manifestPath: relative(manifestPath),
  calls: 48, pairs: 24, pairedTable: { a, b, c, d },
  endorsement: {
    record: stanceCounts.record.endorse, transcript: stanceCounts.transcript.endorse,
    difference: mean(differences), bootstrap95: interval, exactMcNemarP: exactMcNemar(b, c),
  },
  stanceCounts,
  confidence: {
    recordMean: mean(confidences.record), recordMedian: median(confidences.record),
    transcriptMean: mean(confidences.transcript), transcriptMedian: median(confidences.transcript),
    pairedMeanDifference: mean(confidenceDifferences),
  },
  stanceChangedPairs: pairedRows.filter((row) => row.stanceChanged).length,
  pairsDetail: pairedRows,
  limitation: "One-turn replay of contexts generated under shared memory; it does not recreate full debate dynamics.",
};
fs.writeFileSync(resultsPath, `${JSON.stringify(summary, null, 2)}\n`);
const table = pairedRows.map((row) => `| ${String(row.speakingOrder).padStart(2, "0")} | ${row.target} | ${row.entries} | ${row.record.stance} (${row.record.confidence.toFixed(2)}) | ${row.transcript.stance} (${row.transcript.confidence.toFixed(2)}) |`).join("\n");
const markdown = `# Identical-context record-versus-transcript replay v1\n\n- Record endorsements: ${summary.endorsement.record}/24\n- Transcript endorsements: ${summary.endorsement.transcript}/24\n- Paired difference: ${(100 * summary.endorsement.difference).toFixed(1)} percentage points\n- Discordant pairs (record only / transcript only): ${b} / ${c}\n- Two-sided exact McNemar p: ${summary.endorsement.exactMcNemarP ?? "uninformative (no discordant pairs)"}\n- Paired 95% bootstrap interval: ${(100 * interval[0]).toFixed(1)} to ${(100 * interval[1]).toFixed(1)} percentage points\n\n| Order | Target | Entries | Record | Transcript |\n|---:|---|---:|---|---|\n${table}\n\nThis is a one-turn replay of contexts generated under shared memory. It does not recreate the full dynamics of live debate.\n`;
fs.writeFileSync(resultsMarkdownPath, markdown);
console.log(JSON.stringify({ audit: "identical-context-replay-v1", mode: "post-run", ...summary }, null, 2));
