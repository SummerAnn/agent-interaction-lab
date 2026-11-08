import { describe, expect, it } from "vitest";

import {
  conditionSchema,
  resolvePromptFrame,
  scenarioSchema,
  type AgentSpec,
  type ChatMessage,
  type MemoryEntry,
} from "../config/schema";
import { retrieveMemoryEntries } from "../memory/retrieve";
import { applyClaimDebateVisibility, filterByTopology } from "../engine/chat";
import { shouldStoreAgentJudgment } from "../engine/backends/memoryMode";
import {
  buildChatRoundPrompt,
  buildChatSystemPrompt,
  buildEvalPrompt,
  buildSystemMessage,
} from "./prompts";
import { buildFramedClaimPrompt, parseFramedClaimResponse } from "./promptFrame";

const agent: AgentSpec = {
  id: "analyst_1",
  role: "neutral_agent",
  model: "claude-haiku-4-5-20251001",
  positiveEvidenceWeight: 1,
  negativeEvidenceWeight: 1,
  socialWeight: 1,
  falseClaimBias: 0,
  correctionTrust: 1,
  writesMemoryThreshold: 0,
  activeFromStep: 1,
  canWriteMemory: true,
};

const scenario = scenarioSchema.parse({
  id: "prompt-frame-test",
  title: "Prompt frame test",
  focusClaimId: "claim_1",
  claims: [{ id: "claim_1", text: "The claim is true.", truthLabel: "false" }],
  initialBeliefStates: [{
    agentId: agent.id,
    claimId: "claim_1",
    stance: "uncertain",
    confidence: 0.2,
  }],
});

function condition(mode: "memory" | "chat", promptFrame?: "memory_assessment" | "live_discussion") {
  return conditionSchema.parse({
    id: `${mode}-${promptFrame ?? "native"}`,
    title: "Prompt frame test",
    memory: {
      mode: "shared",
      record: "agent_judgment",
      maxRetrievedEntries: 6,
    },
    interaction: {
      mode,
      ...(promptFrame ? { promptFrame } : {}),
    },
    interventions: {
      correctionVisibility: "global",
      correctionTiming: "none",
    },
  });
}

const claim = scenario.claims[0];
const priorBelief = { stance: "uncertain" as const, confidence: 0.2 };

describe("protocol-independent prompt frames", () => {
  it("keeps omitted promptFrame backward compatible by mode", () => {
    const memory = condition("memory");
    const chat = condition("chat");
    expect(memory.interaction.promptFrame).toBeUndefined();
    expect(chat.interaction.promptFrame).toBeUndefined();
    expect(resolvePromptFrame(memory.interaction)).toBe("memory_assessment");
    expect(resolvePromptFrame(chat.interaction)).toBe("live_discussion");
  });

  it("reproduces the legacy native memory prompt byte for byte", () => {
    const native = condition("memory");
    expect(native.memory.showConfidenceScores).toBe(true);
    const framed = buildFramedClaimPrompt({
      agent,
      claim,
      scenario,
      condition: native,
      visibleMemoryEntries: [],
      activeCorrections: [],
      priorBelief,
      currentStep: 1,
      turn: 1,
      totalTurns: 3,
      isFinalTurn: false,
    });
    expect(framed.systemPrompt).toBe(buildSystemMessage(agent, false));
    expect(framed.userPrompt).toBe(buildEvalPrompt({
      agent,
      claim,
      scenario,
      retrievedMemories: [],
      memoryRecord: native.memory.record,
      showConfidenceScores: true,
      activeCorrections: [],
      isFocusClaim: true,
      priorBelief,
      currentStep: 1,
    }));
    expect(framed.responseMode).toBe("structured_assessment");
    expect(framed.structuredOutput?.name).toBe("submit_claim_assessment");
  });

  it("hides only retrieved numeric confidence when the condition disables it", () => {
    const hidden = conditionSchema.parse({
      id: "memory-confidence-hidden",
      title: "Memory with saved confidence hidden",
      memory: {
        mode: "shared",
        record: "agent_judgment",
        maxRetrievedEntries: 6,
        showConfidenceScores: false,
      },
      interaction: { mode: "memory" },
      interventions: {
        correctionVisibility: "global",
        correctionTiming: "none",
      },
    });
    const entry: MemoryEntry = {
      id: "entry-1",
      step: 1,
      agentId: "source_1",
      claimId: claim.id,
      stance: "endorse",
      confidence: 0.91,
      visibility: "shared",
      sourceType: "agent",
      text: "[source_1] endorses claim_1 (conf: 0.91): The repeated explanation.",
    };
    const framed = buildFramedClaimPrompt({
      agent,
      claim,
      scenario,
      condition: hidden,
      visibleMemoryEntries: [entry],
      activeCorrections: [],
      priorBelief,
      currentStep: 2,
      turn: 2,
      totalTurns: 3,
      isFinalTurn: false,
    });

    expect(framed.userPrompt).toContain("ENDORSE");
    expect(framed.userPrompt).toContain("The repeated explanation.");
    expect(framed.userPrompt).not.toContain("0.91");
    expect(framed.userPrompt).not.toContain("confidence shown for a retrieved note");
    expect(framed.systemPrompt).toContain('"confidence": 0.0-1.0');
  });

  it("reproduces the legacy native chat prompt byte for byte", () => {
    const native = condition("chat");
    const framed = buildFramedClaimPrompt({
      agent,
      claim,
      scenario,
      condition: native,
      visibleChatMessages: [],
      activeCorrections: [],
      turn: 1,
      totalTurns: 3,
      isFinalTurn: false,
    });
    expect(framed.systemPrompt).toBe(
      buildChatSystemPrompt(agent, scenario, native, native.interaction.chatStyle),
    );
    expect(framed.userPrompt).toBe(buildChatRoundPrompt({
      agent,
      claim,
      scenario,
      condition: native,
      priorMessages: [],
      activeCorrections: [],
      round: 1,
      totalRounds: 3,
      isFinalRound: false,
    }));
    expect(framed.responseMode).toBe("discussion_raw");
    expect(framed.structuredOutput).toBeUndefined();
  });

  it.each(["memory_assessment", "live_discussion"] as const)(
    "makes first-turn prompts identical across protocols within %s",
    (promptFrame) => {
      const memory = buildFramedClaimPrompt({
        agent,
        claim,
        scenario,
        condition: condition("memory", promptFrame),
        visibleMemoryEntries: [],
        activeCorrections: [],
        priorBelief,
        currentStep: 1,
        turn: 1,
        totalTurns: 3,
        isFinalTurn: false,
      });
      const chat = buildFramedClaimPrompt({
        agent,
        claim,
        scenario,
        condition: condition("chat", promptFrame),
        visibleChatMessages: [],
        activeCorrections: [],
        priorBelief,
        currentStep: promptFrame === "memory_assessment" ? 1 : undefined,
        turn: 1,
        totalTurns: 3,
        isFinalTurn: false,
      });
      expect(chat.systemPrompt).toBe(memory.systemPrompt);
      expect(chat.userPrompt).toBe(memory.userPrompt);
      expect(chat.responseMode).toBe(memory.responseMode);
      expect(chat.structuredOutput).toEqual(memory.structuredOutput);
    },
  );

  it.each(["memory_assessment", "live_discussion"] as const)(
    "matches first-turn prompts when a contamination agent speaks first under %s",
    (promptFrame) => {
      const sourceAgent: AgentSpec = {
        ...agent,
        id: "source_1",
        role: "contamination_agent",
      };
      const sharedInput = {
        agent: sourceAgent,
        claim,
        scenario,
        activeCorrections: [],
        priorBelief,
        currentStep: 1,
        turn: 1,
        totalTurns: 3,
        isFinalTurn: false,
      };
      const memory = buildFramedClaimPrompt({
        ...sharedInput,
        condition: condition("memory", promptFrame),
        visibleMemoryEntries: [],
      });
      const chat = buildFramedClaimPrompt({
        ...sharedInput,
        condition: condition("chat", promptFrame),
        visibleChatMessages: [],
      });
      expect(chat.systemPrompt).toBe(memory.systemPrompt);
      expect(chat.userPrompt).toBe(memory.userPrompt);
      expect(chat.structuredOutput).toEqual(memory.structuredOutput);
    },
  );

  it("does not let promptFrame change protocol visibility or retrieval", () => {
    const shown: ChatMessage = {
      round: 1,
      agentId: "analyst_2",
      claimId: claim.id,
      text: "VISIBLE MESSAGE",
      stance: "endorse",
      confidence: 0.9,
    };
    const hidden: ChatMessage = { ...shown, agentId: "analyst_3", text: "HIDDEN MESSAGE" };
    const chatPrompt = buildFramedClaimPrompt({
      agent,
      claim,
      scenario,
      condition: condition("chat", "memory_assessment"),
      // The chat protocol has already applied topology and visibility here.
      visibleChatMessages: [shown],
      activeCorrections: [],
      priorBelief,
      currentStep: 2,
      turn: 1,
      totalTurns: 3,
      isFinalTurn: false,
    });
    expect(chatPrompt.userPrompt).toContain(shown.text);
    expect(chatPrompt.userPrompt).not.toContain(hidden.text);

    const entries: MemoryEntry[] = [
      {
        id: "entry-visible",
        step: 1,
        agentId: shown.agentId,
        claimId: claim.id,
        stance: "endorse",
        confidence: 0.9,
        visibility: "shared",
        sourceType: "agent",
        text: shown.text,
      },
    ];
    const assessmentRetrieval = retrieveMemoryEntries(
      entries,
      agent.id,
      claim.id,
      condition("memory", "memory_assessment"),
      2,
    );
    const discussionRetrieval = retrieveMemoryEntries(
      entries,
      agent.id,
      claim.id,
      condition("memory", "live_discussion"),
      2,
    );
    expect(discussionRetrieval.map((entry) => entry.id))
      .toEqual(assessmentRetrieval.map((entry) => entry.id));
  });

  it("keeps mixed histories under their protocol rules in both frames", () => {
    const agents = Array.from({ length: 9 }, (_, index) => ({
      ...agent,
      id: index === 0 ? agent.id : `analyst_${index + 1}`,
    }));
    const messages: ChatMessage[] = agents.map((candidate, index) => ({
      round: 1,
      agentId: candidate.id,
      claimId: claim.id,
      text: `message ${index + 1}`,
      stance: index % 3 === 1 ? "uncertain" : index % 3 === 2 ? "reject" : "endorse",
      confidence: 0.8,
    }));
    const chatCondition = condition("chat", "memory_assessment");
    const topologyVisible = filterByTopology(
      messages,
      agent,
      agents,
      chatCondition.interaction.topology,
    );
    const chatVisible = applyClaimDebateVisibility(topologyVisible, chatCondition);
    expect(chatVisible).toHaveLength(8);
    expect(chatVisible.every((message) => message.agentId !== agent.id)).toBe(true);
    expect(chatVisible.some((message) => message.stance === "uncertain")).toBe(true);

    const entries: MemoryEntry[] = messages.map((message, index) => ({
      id: `entry-${index + 1}`,
      step: index + 1,
      agentId: message.agentId,
      claimId: message.claimId,
      stance: message.stance ?? "uncertain",
      confidence: message.confidence ?? 0.5,
      visibility: "shared",
      sourceType: "agent",
      text: message.text,
    }));
    for (const frame of ["memory_assessment", "live_discussion"] as const) {
      const memoryCondition = condition("memory", frame);
      expect(retrieveMemoryEntries(entries, agent.id, claim.id, memoryCondition, 10)
        .map((entry) => entry.id)).toEqual([
        "entry-4", "entry-5", "entry-6", "entry-7", "entry-8", "entry-9",
      ]);
      expect(shouldStoreAgentJudgment(memoryCondition, "uncertain")).toBe(false);
    }
    const saveUncertain = {
      ...condition("memory", "live_discussion"),
      memory: {
        ...condition("memory", "live_discussion").memory,
        writeUncertainAnswers: true,
      },
    };
    expect(shouldStoreAgentJudgment(saveUncertain, "uncertain")).toBe(true);
  });

  it("uses structured assessment parsing only for the memory frame", () => {
    const structured = parseFramedClaimResponse(
      "memory_assessment",
      '{"stance":"reject","confidence":0.8,"reasoning":"The evidence is weak.","cited_source_ids":[]}',
    );
    expect(structured).toMatchObject({
      stance: "reject",
      confidence: 0.8,
      publicMessage: "The evidence is weak.",
      parseValid: true,
    });

    const raw = parseFramedClaimResponse(
      "live_discussion",
      'The evidence is weak.\n```json\n{"stance":"reject","confidence":0.8}\n```',
    );
    expect(raw).toMatchObject({
      stance: "reject",
      confidence: 0.8,
      publicMessage: "The evidence is weak.",
      parseValid: true,
    });

    const malformed = parseFramedClaimResponse(
      "live_discussion",
      'I reject this. {"stance":"reject","confidence":0.8',
    );
    expect(malformed.stance).toBe("reject");
    expect(malformed.parseValid).toBe(false);
  });
});
