import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const manifestPath = path.join(root, "analysis", "identical-context-replay-v1-manifest.json");
export const resultsPath = path.join(root, "analysis", "identical-context-replay-v1-results.json");
export const resultsMarkdownPath = path.join(root, "analysis", "identical-context-replay-v1-results.md");
export const protocolPath = path.join(root, "IDENTICAL_CONTEXT_REPLAY_V1_PROTOCOL.md");
export const sourceAuditPath = path.join(root, "analysis", "prompt-frame-crossover-v2-audit.json");
export const studyManifestPath = path.join(root, "experiments", "prompt_frame_crossover_v2", "study-manifest.json");
export const sourceArm = "causal_explanation__shared_memory__memory_assessment";
export const scheduleSeed = 2026110602;
export const fixedSourceIds = new Set(["analyst_1", "analyst_7"]);

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

export function extractBlock(prompt, heading, nextHeading) {
  const start = prompt.indexOf(heading);
  assert(start >= 0, `Missing prompt block: ${heading}`);
  const end = nextHeading ? prompt.indexOf(nextHeading, start + heading.length) : prompt.length;
  assert(end > start, `Missing boundary after prompt block: ${heading}`);
  return prompt.slice(start, end).trim();
}

export function formatConfidence(value) {
  return Number(value).toFixed(2);
}

export function renderPresentation(entries, arm) {
  const record = arm === "record";
  const heading = record ? "## Shared record" : "## Discussion transcript";
  const description = record
    ? "These are shared-record entries from other agents, in the order shown."
    : "These are discussion messages from other agents, in the order shown.";
  const itemLabel = record ? "Record entry" : "Discussion message";
  const items = entries.map((entry, index) => (
    `${index + 1}. ${itemLabel} from ${entry.agentId} - ${entry.stance.toUpperCase()} `
    + `(confidence: ${formatConfidence(entry.confidence)}): ${JSON.stringify(entry.text)}`
  ));
  return [heading, "", description, "", ...items].join("\n");
}

export function normalizeRendering(prompt) {
  return prompt
    .replaceAll("## Discussion transcript", "## Shared record")
    .replaceAll("These are discussion messages", "These are shared-record entries")
    .replaceAll("Discussion message", "Record entry");
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

export function strictParse(raw) {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  if (object) text = object[0];
  const parsed = JSON.parse(text);
  assert(["endorse", "reject", "uncertain"].includes(parsed.stance), "Invalid stance");
  assert(typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1,
    "Invalid confidence");
  assert(typeof parsed.reasoning === "string", "Missing reasoning");
  assert(Array.isArray(parsed.cited_source_ids), "Missing cited_source_ids");
  return {
    stance: parsed.stance,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    citedSourceIds: parsed.cited_source_ids,
  };
}

export function resultPathForCell(cellId) {
  return path.join(root, "output", "identical_context_replay_v1", `${cellId}.json`);
}
