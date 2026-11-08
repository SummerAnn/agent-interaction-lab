import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const sourceAuditPath = path.join(root, "analysis", "prompt-frame-crossover-v2-audit.json");
export const batchAnalysisPath = path.join(root, "analysis", "fixed-explanation-batch-divergence-v1-results.json");
export const protocolPath = path.join(root, "FIRST_NEUTRAL_TEMPORAL_REPLAY_V1_PROTOCOL.md");
export const manifestPath = path.join(root, "analysis", "first-neutral-temporal-replay-v1-manifest.json");
export const staticAuditPath = path.join(root, "analysis", "first-neutral-temporal-replay-v1-static-audit.json");
export const auditPath = path.join(root, "analysis", "first-neutral-temporal-replay-v1-audit.json");
export const resultsMarkdownPath = path.join(root, "analysis", "first-neutral-temporal-replay-v1-results.md");
export const resultDirectory = path.join(root, "output", "first_neutral_temporal_replay_v1");
export const sourceArm = "causal_explanation__shared_memory__memory_assessment";
export const model = "claude-haiku-4-5-20251001";
export const scheduleSeed = 2026110701;

export function assert(value, message) {
  if (!value) throw new Error(message);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function sqliteJson(dbPath, sql) {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  return raw ? JSON.parse(raw) : [];
}

export function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function jsonSha256(value) {
  return sha256(canonicalJson(value));
}

export function requestContract(promptAudit) {
  return {
    model: promptAudit.model,
    temperature: promptAudit.temperature,
    maxTokens: promptAudit.maxTokens,
    systemPrompt: promptAudit.systemPrompt,
    userPrompt: promptAudit.userPrompt,
    responseMode: promptAudit.responseMode,
    structuredOutputName: promptAudit.structuredOutputName,
    structuredOutputSchema: promptAudit.structuredOutputSchema,
  };
}

export function structuredOutput(promptAudit) {
  return {
    name: promptAudit.structuredOutputName,
    description: "Submit the claim assessment using the required fields.",
    inputSchema: promptAudit.structuredOutputSchema,
  };
}

export function strictParse(raw) {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  if (object) text = object[0];
  const parsed = JSON.parse(text);
  assert(["endorse", "reject", "uncertain"].includes(parsed.stance), "Invalid stance");
  assert(
    typeof parsed.confidence === "number"
      && Number.isFinite(parsed.confidence)
      && parsed.confidence >= 0
      && parsed.confidence <= 1,
    "Invalid confidence",
  );
  assert(typeof parsed.reasoning === "string", "Missing reasoning");
  assert(Array.isArray(parsed.cited_source_ids), "Missing cited_source_ids");
  return {
    stance: parsed.stance,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    citedSourceIds: parsed.cited_source_ids,
  };
}

export function shuffled(values, seed) {
  const result = [...values];
  let state = (seed >>> 0) || 0x9e3779b9;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function resultPath(contextId) {
  return path.join(resultDirectory, `${contextId}.json`);
}

export function countStances(values) {
  return Object.fromEntries(
    ["endorse", "reject", "uncertain"].map((stance) => [
      stance,
      values.filter((value) => value === stance).length,
    ]),
  );
}
