import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assert, manifestPath, relative, resultPathForCell, root, sha256, strictParse,
} from "../analysis/identical-context-replay-v1-common.mjs";

const execute = process.argv.includes("--execute");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--execute");
assert(unknown.length === 0, `Unknown argument(s): ${unknown.join(", ")}`);

execFileSync(process.execPath, ["analysis/prepare-identical-context-replay-v1.mjs"], {
  cwd: root, stdio: "inherit",
});
execFileSync(process.execPath, ["analysis/audit-identical-context-replay-v1.mjs", "--static"], {
  cwd: root, stdio: "inherit",
});

if (!execute) {
  console.log("\nPREFLIGHT PASSED. No model or API calls were made.");
  console.log("Planned launch: 24 paired contexts and 48 Claude Haiku calls.");
  console.log("Execution requires both --execute and IDENTICAL_CONTEXT_REPLAY_APPROVED=YES.");
  process.exit(0);
}

assert(process.env.IDENTICAL_CONTEXT_REPLAY_APPROVED === "YES",
  "Execution requires IDENTICAL_CONTEXT_REPLAY_APPROVED=YES after explicit user authorization");

const providerModule = await import("../src/llm/provider.ts");
const clientModule = await import("../src/llm/client.ts");
const providerApi = providerModule.default ?? providerModule;
const clientApi = clientModule.default ?? clientModule;
assert(typeof providerApi.resolveProvider === "function", "resolveProvider is unavailable");
assert(typeof clientApi.callLLM === "function", "callLLM is unavailable");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const provider = providerApi.resolveProvider(manifest.model, root);
assert(provider, `No provider credential is available for ${manifest.model}`);
assert(provider.type === "anthropic" && provider.baseUrl === "https://api.anthropic.com",
  "Replay must use the direct Anthropic provider");
assert(provider.model === manifest.model, "Resolved model differs from the frozen manifest");

const cellMap = new Map();
for (const pair of manifest.pairs) {
  for (const arm of ["record", "transcript"]) {
    cellMap.set(pair.cells[arm].cellId, { pair, arm, cell: pair.cells[arm] });
  }
}

fs.mkdirSync(path.join(root, manifest.resultDirectory), { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const [scheduleIndex, cellId] of manifest.schedule.entries()) {
  const expected = cellMap.get(cellId);
  assert(expected, `Unknown scheduled cell ${cellId}`);
  const outputPath = resultPathForCell(cellId);
  if (fs.existsSync(outputPath)) {
    const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (existing.status === "complete" && existing.parseValid === true
      && existing.request?.systemPromptSha256 === expected.pair.systemPromptSha256
      && existing.request?.userPromptSha256 === expected.cell.userPromptSha256) {
      console.log(`[${scheduleIndex + 1}/48] ${cellId}: verified complete; skipping`);
      continue;
    }
    throw new Error(`Existing result does not match the frozen manifest: ${relative(outputPath)}`);
  }

  const request = {
    systemPrompt: expected.pair.systemPrompt,
    userPrompt: expected.cell.userPrompt,
    maxTokens: expected.pair.maxTokens,
    temperature: expected.pair.temperature,
    structuredOutput: expected.pair.structuredOutput,
  };
  const attempts = [];
  let completed = null;
  for (let outerAttempt = 1; outerAttempt <= 3 && !completed; outerAttempt += 1) {
    const internalRetryLog = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      const message = args.map((value) => String(value)).join(" ");
      if (message.startsWith("[llm] retry ")) internalRetryLog.push({ at: new Date().toISOString(), message });
      originalWarn(...args);
    };
    const startedAt = new Date().toISOString();
    try {
      const response = await clientApi.callLLM(provider, request);
      const parsed = strictParse(response.text);
      const finishedAt = new Date().toISOString();
      attempts.push({
        outerAttempt, startedAt, finishedAt, status: "complete", internalRetryLog,
        rawResponse: response.text, usage: response.usage, estimatedCostUsd: response.estimatedCostUsd,
      });
      completed = { response, parsed, startedAt, finishedAt };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      attempts.push({
        outerAttempt, startedAt, finishedAt, status: "failed", internalRetryLog,
        error: error instanceof Error ? error.message : String(error),
      });
      if (outerAttempt < 3) await sleep(1500 * (2 ** (outerAttempt - 1)));
    } finally {
      console.warn = originalWarn;
    }
  }
  assert(completed, `${cellId}: no complete parse-valid response after three outer attempts`);

  const result = {
    protocolVersion: manifest.protocolVersion,
    status: "complete",
    parseValid: true,
    scheduleIndex: scheduleIndex + 1,
    cellId,
    pairId: expected.pair.pairId,
    speakingOrder: expected.pair.speakingOrder,
    arm: expected.arm,
    target: expected.pair.selectedTarget,
    request: {
      provider: provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      structuredOutput: request.structuredOutput,
      systemPrompt: request.systemPrompt,
      systemPromptSha256: sha256(request.systemPrompt),
      userPrompt: request.userPrompt,
      userPromptSha256: sha256(request.userPrompt),
    },
    rawResponse: completed.response.text,
    parsed: completed.parsed,
    completionData: {
      usage: completed.response.usage,
      estimatedCostUsd: completed.response.estimatedCostUsd,
      startedAt: completed.startedAt,
      finishedAt: completed.finishedAt,
    },
    attempts,
    retryAuditLimitation: "The shared callLLM client retries transient provider errors internally. Its warning log is captured, but failed provider response bodies are not exposed by that client.",
  };
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
  console.log(`[${scheduleIndex + 1}/48] ${cellId}: ${completed.parsed.stance} (${completed.parsed.confidence.toFixed(2)})`);
}

execFileSync(process.execPath, ["analysis/audit-identical-context-replay-v1.mjs"], {
  cwd: root, stdio: "inherit",
});
