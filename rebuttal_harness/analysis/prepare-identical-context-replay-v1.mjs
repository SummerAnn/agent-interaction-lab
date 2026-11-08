import fs from "node:fs";
import {
  assert, extractBlock, fileSha256, fixedSourceIds, formatConfidence, manifestPath,
  normalizeRendering, protocolPath, relative, renderPresentation, root, scheduleSeed,
  sha256, shuffled, sourceArm, sourceAuditPath, sqliteJson, sqlQuote, studyManifestPath,
} from "./identical-context-replay-v1-common.mjs";

for (const source of [protocolPath, sourceAuditPath, studyManifestPath]) {
  assert(fs.existsSync(source), `Missing required source: ${source}`);
}

const sourceAudit = JSON.parse(fs.readFileSync(sourceAuditPath, "utf8"));
const runs = sourceAudit.runs.filter((run) => run.arm === sourceArm).sort((a, b) => a.order - b.order);
assert(runs.length === 24, `Expected 24 source runs, found ${runs.length}`);
assert(new Set(runs.map((run) => run.order)).size === 24, "Speaking orders are not unique");

const decisionBlock = [
  "## Decision",
  "",
  "Use your prior belief and the information shown above to assess the claim. Respond with the required JSON assessment.",
].join("\n");

const pairs = runs.map((run) => {
  assert(fs.existsSync(run.dbPath), `Missing trace: ${run.dbPath}`);
  const states = sqliteJson(run.dbPath, `
    SELECT state_id, step_index, agent_id, claim_id, truth_label, stance, score, confidence
    FROM agent_claim_states ORDER BY state_id
  `);
  const counts = new Map();
  const thirds = [];
  for (const state of states) {
    if (state.step_index === 0) continue;
    if (fixedSourceIds.has(state.agent_id)) continue;
    const count = (counts.get(state.agent_id) ?? 0) + 1;
    counts.set(state.agent_id, count);
    if (count === 3) thirds.push(state);
  }
  assert(thirds.length === 10, `Order ${run.order}: expected ten neutral third responses`);
  const selected = thirds.sort((a, b) => a.state_id - b.state_id)[0];
  const prior = states.filter((state) => state.agent_id === selected.agent_id && state.state_id < selected.state_id)
    .sort((a, b) => b.state_id - a.state_id)[0];
  assert(prior, `Order ${run.order}: missing prior state`);

  const traces = sqliteJson(run.dbPath, `
    SELECT retrieved_entry_ids_json, context_json FROM retrieval_traces
    WHERE step_index=${Number(selected.step_index)} AND agent_id=${sqlQuote(selected.agent_id)}
  `);
  assert(traces.length === 1, `Order ${run.order}: expected one retrieval trace`);
  const trace = traces[0];
  const context = JSON.parse(trace.context_json);
  const promptAudit = context.promptAudit;
  assert(promptAudit, `Order ${run.order}: selected trace has no prompt audit`);
  const ids = JSON.parse(trace.retrieved_entry_ids_json);
  assert(ids.length >= 4 && ids.length <= 6, `Order ${run.order}: expected four to six entries`);
  const rawEntries = sqliteJson(run.dbPath, `
    SELECT memory_entry_id, step_index, agent_id, claim_id, stance, confidence,
           visibility, source_type, entry_text FROM memory_entries ORDER BY step_index, memory_entry_id
  `);
  const entryMap = new Map(rawEntries.map((entry) => [entry.memory_entry_id, entry]));
  const entries = ids.map((id) => {
    const entry = entryMap.get(id);
    assert(entry, `Order ${run.order}: missing entry ${id}`);
    assert(entry.step_index < selected.step_index, `Order ${run.order}: entry ${id} is not prior`);
    return {
      id: entry.memory_entry_id, step: entry.step_index, agentId: entry.agent_id,
      claimId: entry.claim_id, stance: entry.stance, confidence: entry.confidence,
      visibility: entry.visibility, sourceType: entry.source_type, text: entry.entry_text,
    };
  });

  const claimBlock = extractBlock(promptAudit.userPrompt, "## Claim to evaluate", "## Your current belief before this step");
  const priorStateBlock = extractBlock(promptAudit.userPrompt, "## Your current belief before this step", "## Retrieved record");
  assert(priorStateBlock.includes(prior.stance.toUpperCase()), `Order ${run.order}: prior stance mismatch`);
  assert(priorStateBlock.includes(formatConfidence(prior.confidence)), `Order ${run.order}: prior confidence mismatch`);
  const recordBlock = renderPresentation(entries, "record");
  const transcriptBlock = renderPresentation(entries, "transcript");
  const recordPrompt = [claimBlock, priorStateBlock, recordBlock, decisionBlock].join("\n\n");
  const transcriptPrompt = [claimBlock, priorStateBlock, transcriptBlock, decisionBlock].join("\n\n");
  assert(normalizeRendering(recordPrompt) === normalizeRendering(transcriptPrompt),
    `Order ${run.order}: pair differs beyond permitted substitutions`);

  const pairId = `order-${String(run.order).padStart(2, "0")}`;
  const cell = (arm, presentationBlock, userPrompt) => ({
    cellId: `${pairId}-${arm}`, arm, presentationBlock,
    presentationBlockSha256: sha256(presentationBlock), userPrompt,
    userPromptSha256: sha256(userPrompt), normalizedPromptSha256: sha256(normalizeRendering(userPrompt)),
  });
  return {
    pairId, sourceRunId: run.runId, sourceArm: run.arm, speakingOrder: run.order,
    tracePath: relative(run.dbPath), traceSha256: fileSha256(run.dbPath),
    selectedTarget: selected.agent_id, selectedStep: selected.step_index, selectedResponseNumber: 3,
    priorState: { stance: prior.stance, confidence: prior.confidence },
    retrievedEntryIds: ids, entries,
    systemPrompt: promptAudit.systemPrompt, systemPromptSha256: sha256(promptAudit.systemPrompt),
    claimBlock, claimBlockSha256: sha256(claimBlock),
    priorStateBlock, priorStateBlockSha256: sha256(priorStateBlock),
    decisionBlock, decisionBlockSha256: sha256(decisionBlock),
    model: promptAudit.model, temperature: promptAudit.temperature, maxTokens: promptAudit.maxTokens,
    structuredOutput: {
      name: promptAudit.structuredOutputName,
      description: "Submit the claim assessment using the required fields.",
      inputSchema: promptAudit.structuredOutputSchema,
    },
    cells: {
      record: cell("record", recordBlock, recordPrompt),
      transcript: cell("transcript", transcriptBlock, transcriptPrompt),
    },
  };
});

const shuffledPairIds = shuffled(pairs.map((pair) => pair.pairId), scheduleSeed);
const schedule = shuffledPairIds.flatMap((pairId, index) => {
  const arms = (index + 1) % 2 ? ["record", "transcript"] : ["transcript", "record"];
  return arms.map((arm) => `${pairId}-${arm}`);
});

const manifest = {
  id: "identical_context_replay_v1", protocolVersion: "1.0.0", preparedAt: new Date().toISOString(),
  status: "locked_not_executed",
  purpose: "Hold the complete later-turn context fixed and change only record-versus-transcript presentation.",
  protocol: { path: relative(protocolPath), sha256: fileSha256(protocolPath) },
  sources: {
    audit: { path: relative(sourceAuditPath), sha256: fileSha256(sourceAuditPath) },
    studyManifest: { path: relative(studyManifestPath), sha256: fileSha256(studyManifestPath) },
    arm: sourceArm,
  },
  selectionRule: "Earliest neutral agent's third response in each speaking order, preserving retrieved entries and prior state.",
  renderingDifference: ["Shared record <-> Discussion transcript", "shared-record entries <-> discussion messages", "Record entry <-> Discussion message"],
  model: "claude-haiku-4-5-20251001", temperature: 0, concurrency: 1,
  pairCount: 24, plannedCalls: 48, scheduleSeed, schedule, pairs,
  resultDirectory: "output/identical_context_replay_v1",
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ manifest: relative(manifestPath), pairs: 24, plannedCalls: 48, seed: scheduleSeed }, null, 2));
