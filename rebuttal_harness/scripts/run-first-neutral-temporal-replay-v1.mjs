import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  assert,
  jsonSha256,
  manifestPath,
  relative,
  requestContract,
  resultDirectory,
  resultPath,
  root,
  sha256,
  strictParse,
} from "../analysis/first-neutral-temporal-replay-v1-common.mjs";

const execute = process.argv.includes("--execute");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--execute");
assert(unknown.length === 0, `Unknown argument(s): ${unknown.join(", ")}`);
assert(fs.existsSync(manifestPath),
  "The locked manifest is missing. Run analysis/prepare-first-neutral-temporal-replay-v1.mjs once, then audit it.");

// Always prove that the locked manifest still agrees with the immutable source
// traces before resolving credentials or importing any code that can make a
// provider request.
execFileSync(process.execPath, ["analysis/audit-first-neutral-temporal-replay-v1.mjs", "--static"], {
  cwd: root,
  stdio: "inherit",
});

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(manifest.status === "locked_not_executed", "Manifest is not locked for execution");
assert(manifest.contexts.length === 48 && manifest.plannedCalls === 48,
  "Manifest must contain the two separate 24-request cohorts");

if (!execute) {
  console.log("\nPREFLIGHT PASSED. No model or API calls were made.");
  console.log("Locked launch: 24 first-neutral repeatability requests plus 24 exploratory rank-16 requests.");
  console.log("The cohorts will be reported separately and never pooled.");
  console.log("Execution requires --import tsx, --execute, and FIRST_NEUTRAL_TEMPORAL_REPLAY_APPROVED=YES.");
  process.exit(0);
}

assert(process.env.FIRST_NEUTRAL_TEMPORAL_REPLAY_APPROVED === "YES",
  "Execution requires FIRST_NEUTRAL_TEMPORAL_REPLAY_APPROVED=YES after explicit user authorization");

let providerModule;
try {
  providerModule = await import("../src/llm/provider.ts");
} catch (error) {
  if (error?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    throw new Error("Execution must use: node --import tsx scripts/run-first-neutral-temporal-replay-v1.mjs --execute");
  }
  throw error;
}
const providerApi = providerModule.default ?? providerModule;
assert(typeof providerApi.resolveProvider === "function", "resolveProvider is unavailable");

const provider = providerApi.resolveProvider(manifest.model, root);
assert(provider, `No provider credential is available for ${manifest.model}`);
assert(provider.type === "anthropic" && provider.baseUrl === "https://api.anthropic.com",
  "Replay must use the direct Anthropic provider");
assert(provider.model === manifest.model, "Resolved model differs from the locked manifest");

const contextMap = new Map(manifest.contexts.map((context) => [context.contextId, context]));
fs.mkdirSync(resultDirectory, { recursive: true });

function existingResultMatches(existing, context) {
  return existing.status === "complete"
    && existing.parseValid === true
    && existing.contextId === context.contextId
    && existing.sourceRunId === context.sourceRunId
    && existing.selectedStep === context.selectedStep
    && existing.selectedAgent === context.selectedAgent
    && existing.request?.provider === "anthropic"
    && existing.request?.baseUrl === "https://api.anthropic.com"
    && existing.request?.model === context.request.model
    && existing.request?.systemPromptSha256 === sha256(context.request.systemPrompt)
    && existing.request?.userPromptSha256 === sha256(context.request.userPrompt)
    && existing.request?.requestContractHash === context.requestContractHash;
}

async function callAnthropicOnce(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connection": "close",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
        ...(provider.workspaceId ? { "anthropic-workspace-id": provider.workspaceId } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: request.maxTokens,
        system: request.systemPrompt,
        temperature: request.temperature,
        messages: [{ role: "user", content: request.userPrompt }],
        tools: [{
          name: request.structuredOutput.name,
          description: request.structuredOutput.description,
          input_schema: request.structuredOutput.inputSchema,
        }],
        tool_choice: { type: "tool", name: request.structuredOutput.name },
      }),
      signal: controller.signal,
    });
    const providerResponseBody = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic API error ${response.status}: ${providerResponseBody.slice(0, 300)}`);
    }
    const data = JSON.parse(providerResponseBody);
    const toolUse = data.content?.find((block) =>
      block.type === "tool_use" && block.name === request.structuredOutput.name);
    assert(toolUse?.input, "Anthropic response lacks the required structured tool output");
    const promptTokens = data.usage?.input_tokens;
    const completionTokens = data.usage?.output_tokens;
    assert(Number.isFinite(promptTokens) && Number.isFinite(completionTokens),
      "Anthropic response lacks token usage");
    return {
      rawResponse: JSON.stringify(toolUse.input),
      providerResponseBody,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Anthropic request timed out after 45000ms");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

for (const [scheduleIndex, contextId] of manifest.schedule.entries()) {
  const context = contextMap.get(contextId);
  assert(context, `Unknown scheduled context: ${contextId}`);
  const outputPath = resultPath(contextId);

  if (fs.existsSync(outputPath)) {
    const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (existingResultMatches(existing, context)) {
      console.log(`[${scheduleIndex + 1}/48] ${contextId}: verified complete; skipping`);
      continue;
    }
    throw new Error(`Existing result does not match the locked manifest: ${relative(outputPath)}`);
  }

  const frozenContractHash = jsonSha256(requestContract(context.promptAudit));
  assert(frozenContractHash === context.requestContractHash,
    `${contextId}: request contract changed after manifest preparation`);
  const request = {
    systemPrompt: context.request.systemPrompt,
    userPrompt: context.request.userPrompt,
    maxTokens: context.request.maxTokens,
    temperature: context.request.temperature,
    structuredOutput: context.request.structuredOutput,
  };

  const startedAt = new Date().toISOString();
  const response = await callAnthropicOnce(request);
  const parsed = strictParse(response.rawResponse);
  const finishedAt = new Date().toISOString();
  const attempts = [{
    outerAttempt: 1,
    startedAt,
    finishedAt,
    status: "complete",
    internalRetryLog: [],
    rawResponse: response.rawResponse,
    usage: response.usage,
    estimatedCostUsd: null,
  }];

  const result = {
    protocolVersion: manifest.protocolVersion,
    status: "complete",
    parseValid: true,
    scheduleIndex: scheduleIndex + 1,
    contextId,
    cohort: context.cohort,
    selectionStatus: context.selectionStatus,
    sourceRunId: context.sourceRunId,
    declaredOrder: context.declaredOrder,
    selectedStep: context.selectedStep,
    selectedAgent: context.selectedAgent,
    neutralResponseRank: context.neutralResponseRank,
    original: context.original,
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
      requestContractHash: context.requestContractHash,
    },
    rawResponse: response.rawResponse,
    providerResponseBody: response.providerResponseBody,
    parsed,
    completionData: {
      usage: response.usage,
      estimatedCostUsd: null,
      startedAt,
      finishedAt,
    },
    attempts,
    retryPolicy: "No automatic retries. A provider or parse failure stops execution and requires a separately authorized invocation.",
  };
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
  console.log(`[${scheduleIndex + 1}/48] ${contextId}: ${parsed.stance} (${parsed.confidence.toFixed(2)})`);
}

execFileSync(process.execPath, ["analysis/audit-first-neutral-temporal-replay-v1.mjs"], {
  cwd: root,
  stdio: "inherit",
});
