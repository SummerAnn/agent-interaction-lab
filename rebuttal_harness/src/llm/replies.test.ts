import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { conditionSchema, type AgentSpec, type MemoryEntry, type Scenario } from "../config/schema";
import { initDatabase, queryRows } from "../db/sqlite";
import { persistMemoryEntryReply } from "../engine/core";
import { buildEvalPrompt, buildSystemMessage, parseLLMResponse } from "./prompts";
import { filterReplyEntryIds, resolveReplyEntryIds } from "./score";

const agent = {
  id: "analyst_3",
  role: "neutral_agent",
  model: "test-model",
  positiveEvidenceWeight: 1,
  negativeEvidenceWeight: 1,
  socialWeight: 0,
  falseClaimBias: 0,
  correctionTrust: 1,
  writesMemoryThreshold: 0,
  activeFromStep: 1,
  canWriteMemory: true,
} satisfies AgentSpec;

const scenario = {
  id: "reply-test",
  title: "Reply test",
  scenarioType: "claim_benchmark",
  mechanismTags: [],
  sourceCards: [],
  focusClaimId: "claim",
  claims: [{ id: "claim", text: "The claim is true.", truthLabel: "false" }],
  evidence: [],
  scheduledInterventions: [],
  initialBeliefStates: [],
  initialMemoryEntries: [],
  seedMemoryEntries: [],
} as Scenario;

const retrieved: MemoryEntry[] = [
  {
    id: "entry-1",
    opaqueId: "e1",
    step: 1,
    agentId: "analyst_1",
    claimId: "claim",
    stance: "endorse",
    confidence: 0.9,
    visibility: "shared",
    sourceType: "agent",
    text: "I endorse the claim.",
  },
  {
    id: "entry-2",
    opaqueId: "e2",
    step: 2,
    agentId: "analyst_2",
    claimId: "claim",
    stance: "uncertain",
    confidence: 0.5,
    visibility: "shared",
    sourceType: "agent",
    text: "I am uncertain.",
    repliedToEntryIds: ["entry-1"],
    repliedToOpaqueEntryIds: ["e1"],
  },
];

describe("direct replies to retrieved record entries", () => {
  it("keeps the feature off unless a condition enables it", () => {
    const condition = conditionSchema.parse({
      id: "default-replies-off",
      title: "default replies off",
      memory: {
        mode: "shared",
        record: "agent_judgment",
        maxRetrievedEntries: 6,
      },
      interventions: { correctionVisibility: "global" },
    });
    expect(condition.memory.allowEntryReplies).toBe(false);
    expect(condition.memory.showOpaqueEntryIds).toBe(false);
    expect(condition.memory.renderReplyLinks).toBe(false);
  });

  it("shows only compact opaque IDs, never internal storage IDs", () => {
    const prompt = buildEvalPrompt({
      agent,
      claim: scenario.claims[0],
      scenario,
      retrievedMemories: retrieved,
      memoryRecord: "agent_judgment",
      allowEntryReplies: true,
      showOpaqueEntryIds: true,
      renderReplyLinks: true,
      activeCorrections: [],
      isFocusClaim: true,
    });
    expect(prompt).toContain("[entry_id: e1]");
    expect(prompt).toContain("[replies to: e1]");
    expect(prompt).not.toContain("entry-1");
    expect(prompt).toContain("replied_entry_ids");
    expect(buildSystemMessage(agent, true)).toContain('"replied_entry_ids"');
    expect(buildSystemMessage(agent, false)).not.toContain('"replied_entry_ids"');
  });

  it("separates ID visibility, reply affordance, and downstream link rendering", () => {
    const common = {
      agent,
      claim: scenario.claims[0],
      scenario,
      retrievedMemories: retrieved,
      memoryRecord: "agent_judgment" as const,
      showOpaqueEntryIds: true,
      activeCorrections: [],
      isFocusClaim: true,
    };
    const idControl = buildEvalPrompt({
      ...common,
      allowEntryReplies: false,
      renderReplyLinks: false,
    });
    const repliesHidden = buildEvalPrompt({
      ...common,
      allowEntryReplies: true,
      renderReplyLinks: false,
    });
    const repliesVisible = buildEvalPrompt({
      ...common,
      allowEntryReplies: true,
      renderReplyLinks: true,
    });
    expect(idControl).toContain("[entry_id: e1]");
    expect(idControl).not.toContain("replied_entry_ids");
    expect(idControl).not.toContain("[replies to:");
    expect(repliesHidden).toContain("replied_entry_ids");
    expect(repliesHidden).not.toContain("[replies to:");
    expect(repliesVisible).toContain("[replies to: e1]");
  });

  it("deduplicates model replies and accepts only IDs retrieved on that turn", () => {
    const parsed = parseLLMResponse(JSON.stringify({
      stance: "reject",
      confidence: 0.8,
      reasoning: "The first entry gives no evidence.",
      cited_source_ids: [],
      replied_entry_ids: ["e1", "not-retrieved", "e1"],
    }));
    expect(parsed.repliedEntryIds).toEqual(["e1", "not-retrieved"]);
    expect(filterReplyEntryIds(parsed.repliedEntryIds, retrieved)).toEqual(["entry-1"]);
    expect(resolveReplyEntryIds(parsed.repliedEntryIds, retrieved)).toEqual({
      internalIds: ["entry-1"],
      opaqueIds: ["e1"],
    });
  });

  it("persists a reply as an explicit event without creating causal lineage", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-reply-test-"));
    const dbPath = path.join(tempDir, "trace.db");
    try {
      initDatabase(dbPath);
      persistMemoryEntryReply(
        dbPath,
        "run-1",
        3,
        "analyst_3",
        "claim",
        retrieved[0],
        "response-entry",
        "reject",
      );
      const replyEvents = queryRows<{ eventType: string; outputJson: string }>(
        dbPath,
        "SELECT event_type AS eventType, output_json AS outputJson FROM events;",
      );
      expect(replyEvents).toHaveLength(1);
      expect(replyEvents[0].eventType).toBe("memory_entry_reply");
      expect(JSON.parse(replyEvents[0].outputJson)).toMatchObject({
        repliedMemoryEntryId: "entry-1",
        repliedOpaqueEntryId: "e1",
        responseMemoryEntryId: "response-entry",
        responseStance: "reject",
      });
      expect(queryRows(dbPath, "SELECT * FROM claim_lineage;")).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
