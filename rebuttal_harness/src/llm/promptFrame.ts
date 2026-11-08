import {
  resolvePromptFrame,
  type AgentSpec,
  type ChatMessage,
  type Condition,
  type DiscussionMessageType,
  type MemoryEntry,
  type PromptFrame,
  type Scenario,
  type StanceLabel,
} from "../config/schema";
import type { LLMRequest } from "./client";
import { parseLastJsonObject } from "./json";
import {
  buildChatRoundPrompt,
  buildChatSystemPrompt,
  buildEvalPrompt,
  buildSystemMessage,
  parseChatResponse,
  parseLLMResponse,
} from "./prompts";

export type FramedClaimPromptInput = {
  agent: AgentSpec;
  claim: { id: string; text: string; truthLabel: string };
  scenario: Scenario;
  condition: Condition;
  visibleMemoryEntries?: MemoryEntry[];
  visibleChatMessages?: ChatMessage[];
  privateMemoryEntries?: MemoryEntry[];
  activeCorrections: { id: string; text: string; effect: number }[];
  priorBelief?: { stance: StanceLabel; confidence: number } | null;
  verificationCue?: string | null;
  currentStep?: number;
  turn: number;
  totalTurns: number;
  isFinalTurn: boolean;
  allowEntryReplies?: boolean;
  participantsPerRound?: number;
};

export type FramedClaimPrompt = {
  frame: PromptFrame;
  systemPrompt: string;
  userPrompt: string;
  responseMode: "structured_assessment" | "discussion_raw";
  structuredOutput?: NonNullable<LLMRequest["structuredOutput"]>;
};

export type FramedClaimResponse = {
  publicMessage: string;
  reasoning: string;
  messageType: DiscussionMessageType | null;
  stance: StanceLabel;
  confidence: number;
  citedSourceIds: string[];
  referencedClaimIds: string[];
  repliedEntryIds: string[];
  parseValid: boolean;
};

export function claimAssessmentOutputSchema(allowEntryReplies: boolean): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      stance: { type: "string", enum: ["endorse", "reject", "uncertain"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string" },
      cited_source_ids: { type: "array", items: { type: "string" } },
      ...(allowEntryReplies
        ? { replied_entry_ids: { type: "array", items: { type: "string" } } }
        : {}),
    },
    required: allowEntryReplies
      ? ["stance", "confidence", "reasoning", "cited_source_ids", "replied_entry_ids"]
      : ["stance", "confidence", "reasoning", "cited_source_ids"],
    additionalProperties: false,
  };
}

export function chatMessagesAsMemoryEntries(messages: ChatMessage[]): MemoryEntry[] {
  return messages.map((message, index) => ({
    id: `chat-message-${index + 1}-${message.round}-${message.agentId}`,
    step: message.round,
    agentId: message.agentId,
    claimId: message.claimId,
    stance: message.stance ?? "uncertain",
    confidence: message.confidence ?? 0.5,
    visibility: "shared",
    sourceType: "agent",
    text: message.text,
  }));
}

export function memoryEntriesAsChatMessages(
  entries: MemoryEntry[],
  participantsPerRound = 1,
): ChatMessage[] {
  return entries.map((entry) => ({
    round: Math.max(1, Math.ceil(entry.step / Math.max(1, participantsPerRound))),
    agentId: entry.agentId,
    claimId: entry.claimId,
    text: entry.text,
    stance: entry.stance,
    confidence: entry.confidence,
    citedSourceIds: [],
    referencedClaimIds: [entry.claimId],
  }));
}

/**
 * Build one model prompt after the protocol has already selected what is
 * visible. This separation is deliberate: changing promptFrame cannot change
 * topology, retrieval, record capacity, uncertainty filtering, or storage.
 */
export function buildFramedClaimPrompt(input: FramedClaimPromptInput): FramedClaimPrompt {
  const frame = resolvePromptFrame(input.condition.interaction);
  const allowEntryReplies = input.allowEntryReplies ?? false;

  if (frame === "memory_assessment") {
    const visibleMemoryEntries = input.visibleMemoryEntries
      ?? chatMessagesAsMemoryEntries(input.visibleChatMessages ?? []);
    const privateEntries = input.privateMemoryEntries ?? [];
    const retrievedMemories = [...visibleMemoryEntries, ...privateEntries];
    const systemPrompt = buildSystemMessage(input.agent, allowEntryReplies);
    const userPrompt = buildEvalPrompt({
      agent: input.agent,
      claim: input.claim,
      scenario: input.scenario,
      retrievedMemories,
      memoryRecord: input.condition.memory.record,
      showConfidenceScores: input.condition.memory.showConfidenceScores,
      allowEntryReplies,
      showOpaqueEntryIds: input.condition.memory.showOpaqueEntryIds,
      renderReplyLinks: input.condition.memory.renderReplyLinks,
      fixedSourceStance: input.condition.interaction.fixedSourceStance,
      activeCorrections: input.activeCorrections,
      isFocusClaim: input.claim.id === input.scenario.focusClaimId,
      priorBelief: input.priorBelief ?? null,
      verificationCue: input.verificationCue ?? null,
      currentStep: input.currentStep,
    });
    return {
      frame,
      systemPrompt,
      userPrompt,
      responseMode: "structured_assessment",
      structuredOutput: {
        name: "submit_claim_assessment",
        description: "Submit the claim assessment using the required fields.",
        inputSchema: claimAssessmentOutputSchema(allowEntryReplies),
      },
    };
  }

  const visibleChatMessages = input.visibleChatMessages
    ?? memoryEntriesAsChatMessages(input.visibleMemoryEntries ?? [], input.participantsPerRound);
  return {
    frame,
    systemPrompt: buildChatSystemPrompt(
      input.agent,
      input.scenario,
      input.condition,
      input.condition.interaction.chatStyle,
    ),
    userPrompt: buildChatRoundPrompt({
      agent: input.agent,
      claim: input.claim,
      scenario: input.scenario,
      condition: input.condition,
      priorMessages: visibleChatMessages,
      activeCorrections: input.activeCorrections,
      privateMemoryEntries: input.privateMemoryEntries ?? [],
      round: input.turn,
      totalRounds: input.totalTurns,
      isFinalRound: input.isFinalTurn,
      currentStep: input.currentStep,
    }),
    responseMode: "discussion_raw",
  };
}

export function parseFramedClaimResponse(
  frame: PromptFrame,
  raw: string,
): FramedClaimResponse {
  const parsedObject = parseLastJsonObject(raw);
  const hasValidStance = parsedObject?.stance === "endorse"
    || parsedObject?.stance === "reject"
    || parsedObject?.stance === "uncertain";
  const parsedConfidence = parsedObject?.confidence;
  const hasValidConfidence = typeof parsedConfidence === "number"
    && Number.isFinite(parsedConfidence)
    && parsedConfidence >= 0
    && parsedConfidence <= 1;
  const parseValid = hasValidStance && hasValidConfidence;
  if (frame === "memory_assessment") {
    const parsed = parseLLMResponse(raw);
    return {
      publicMessage: parsed.reasoning,
      reasoning: parsed.reasoning,
      messageType: null,
      stance: parsed.stance,
      confidence: parsed.confidence,
      citedSourceIds: parsed.citedSourceIds,
      referencedClaimIds: [],
      repliedEntryIds: parsed.repliedEntryIds,
      parseValid,
    };
  }

  const parsed = parseChatResponse(raw);
  return {
    publicMessage: parsed.message,
    reasoning: parsed.message,
    messageType: parsed.messageType,
    stance: parsed.stance,
    confidence: parsed.confidence,
    citedSourceIds: parsed.citedSourceIds,
    referencedClaimIds: parsed.referencedClaimIds,
    repliedEntryIds: [],
    parseValid,
  };
}
