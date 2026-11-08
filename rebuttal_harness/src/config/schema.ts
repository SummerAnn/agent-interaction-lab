import { z } from "zod";

export const truthLabelSchema = z.enum(["true", "false", "mixed"]);
export const stanceLabelSchema = z.enum(["endorse", "reject", "uncertain"]);
export const memoryModeSchema = z.enum(["personal", "shared"]);
export const memoryRecordSchema = z.enum(["agent_judgment", "evidence_board", "mixed_record", "source_aware", "independence_aware", "provenance_aware", "provenance_minimal", "lineage_collapsed"]).default("agent_judgment");
export const memoryEvictionPolicySchema = z.enum(["fifo", "least_retrieved", "source_preserving"]);
export const correctionVisibilitySchema = z.enum(["global"]);
export const scenarioTypeSchema = z.enum(["claim_benchmark", "open_discussion"]).default("claim_benchmark");
export const discussionMessageTypeSchema = z.enum(["question", "critique", "summary", "citation"]);
export const mechanismFamilySchema = z.enum([
  "memory_lock_in",
  "distributed_information",
  "source_grounded_deliberation",
  "selective_disclosure",
  "source_exit_persistence",
  "memory_poisoning",
]);

export const sourceSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  url: z.string().optional(),
});

export const sourceCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  citation: z.string(),
  summary: z.string(),
  url: z.string().optional(),
  notes: z.array(z.string()).default([]),
});

export const citationRefSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  note: z.string().optional(),
});

export const citationBundleSchema = z.object({
  motivation: z.array(citationRefSchema).default([]),
  mechanism: z.array(citationRefSchema).default([]),
  scenario: z.array(citationRefSchema).default([]),
  metric: z.array(citationRefSchema).default([]),
});

export const provenanceSchema = z.object({
  kind: z.enum(["replication-inspired", "adapted", "new"]),
  note: z.string().optional(),
});

export const evidenceEffectSchema = z.object({
  claimId: z.string(),
  effect: z.number(),
});

export const evidenceSchema = z.object({
  id: z.string(),
  text: z.string(),
  effects: z.array(evidenceEffectSchema),
  visibleToAgentIds: z.array(z.string()).optional(),
  availableFromStep: z.number().int().positive().default(1),
});

export const initialBeliefStateSchema = z.object({
  agentId: z.string(),
  claimId: z.string(),
  stance: stanceLabelSchema,
  confidence: z.number().min(0).max(1),
  score: z.number().optional(),
});

export const initialMemoryEntrySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  claimId: z.string(),
  stance: stanceLabelSchema,
  confidence: z.number().min(0).max(1),
  visibility: z.enum(["shared", "personal"]).default("shared"),
  // Exact-replay validations may restore a previously recorded agent entry at
  // the post-exit boundary. Keeping its original source type preserves the
  // metadata and prompt seen by downstream agents.
  sourceType: z.enum(["seed", "agent"]).default("seed"),
  text: z.string(),
});

// A task with several exclusive explanations. The correct answer is retained in
// configuration for scoring, but is never inserted into an agent prompt.
export const groupDecisionSchema = z.object({
  candidateClaimIds: z.array(z.string()).min(2),
  correctClaimId: z.string(),
  instruction: z.string(),
  // New real-source tasks name the cards required for the supported conclusion.
  // Existing scenarios leave this empty and receive no source-grounding score.
  requiredSourceIds: z.array(z.string()).default([]),
  // Reference controls deliberately do not split evidence across agents.
  evidenceAccess: z.enum(["private_split", "none", "full_packet", "public_problem"]).default("private_split"),
  // Calibration controls need an explicit way to say that the shown cards do
  // not yet identify one answer. Main group decisions remain forced choices.
  allowAbstain: z.boolean().default(false),
});

// External datasets need a recorded screening history before their private
// split versions can be used in a group experiment. This keeps a dataset item
// from becoming paper evidence just because it was successfully converted.
export const taskProtocolSchema = z.object({
  adapterId: z.string(),
  taskId: z.string(),
  phase: z.enum(["no_context", "one_piece", "full_context", "group"]),
  pieceId: z.string().optional(),
  requiredSourceIds: z.array(z.string()).default([]),
});

const rawScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenarioType: scenarioTypeSchema,
  domain: z.string().optional(),
  mechanismFamily: mechanismFamilySchema.optional(),
  mechanismTags: z.array(z.string()).default([]),
  provenance: provenanceSchema.optional(),
  citations: citationBundleSchema.optional(),
  sources: z.array(sourceSchema).optional(),
  sourceCards: z.array(sourceCardSchema).default([]),
  discussion: z.object({
    opener: z.string(),
    instructions: z.string().optional(),
    evaluatorFocus: z.array(z.enum(["accuracy", "citation_fidelity", "premature_consensus"])).default([
      "accuracy",
      "citation_fidelity",
      "premature_consensus",
    ]),
  }).optional(),
  focusClaimId: z.string(),
  groupDecision: groupDecisionSchema.optional(),
  taskProtocol: taskProtocolSchema.optional(),
  claims: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      truthLabel: truthLabelSchema,
    }),
  ),
  evidence: z.array(evidenceSchema).default([]),
  scheduledInterventions: z.array(
    z.object({
      id: z.string(),
      step: z.number().int().positive(),
      type: z.literal("correction"),
      claimId: z.string(),
      text: z.string(),
      effect: z.number(),
    }),
  ).default([]),
  initialBeliefStates: z.array(initialBeliefStateSchema).default([]),
  initialMemoryEntries: z.array(initialMemoryEntrySchema).default([]),
  seedMemoryEntries: z.array(initialMemoryEntrySchema).optional(),
});

export const scenarioSchema = rawScenarioSchema.transform((scenario) => {
  const initialMemoryEntries = scenario.initialMemoryEntries.length > 0
    ? scenario.initialMemoryEntries
    : (scenario.seedMemoryEntries ?? []);

  return {
    ...scenario,
    initialMemoryEntries,
    seedMemoryEntries: initialMemoryEntries,
  };
});

export const decaySchema = z.object({
  enabled: z.boolean(),
  halfLife: z.number().positive(),
}).default({ enabled: false, halfLife: 6 });

export const verificationSchema = z.object({
  mode: z.enum(["none", "reliable", "noisy"]),
  noiseLevel: z.number().min(0).max(1),
}).default({ mode: "none", noiseLevel: 0 });

export const fixedCorrectionTimingSchema = z.enum(["none", "default", "early", "late"]);
export const triggeredCorrectionTimingSchema = z.object({
  mode: z.literal("endorsement_threshold"),
  threshold: z.number().gt(0).max(1),
  minStep: z.number().int().positive().default(1),
});
export const correctionTimingSchema = z.union([fixedCorrectionTimingSchema, triggeredCorrectionTimingSchema]);
export const correctionStrengthSchema = z.enum(["default", "weak", "repeated", "high_authority"]).default("default");

export const interactionModeSchema = z.enum(["memory", "chat"]).default("memory");
// Prompt wording is orthogonal to the interaction protocol. When omitted,
// legacy conditions retain their native prompt: memory uses the assessment
// form and chat uses the live-discussion form.
export const promptFrameSchema = z.enum(["memory_assessment", "live_discussion"]);
export const topologySchema = z.enum(["fully-connected", "star", "chain", "ring"]).default("fully-connected");
export const chatStyleSchema = z.enum(["claim-debate", "open-discussion"]).default("claim-debate");
export const collusionStrategySchema = z.enum(["none", "truthful_selective"]).default("none");
export const collusionVisibilitySchema = z.enum(["hidden", "visible"]).default("hidden");

export const collusionSchema = z.object({
  strategy: collusionStrategySchema,
  visibility: collusionVisibilitySchema,
  omitContraryEvidence: z.boolean().default(false),
  repeatSupportiveEvidence: z.boolean().default(false),
  note: z.string().optional(),
}).default({
  strategy: "none",
  visibility: "hidden",
  omitContraryEvidence: false,
  repeatSupportiveEvidence: false,
});

export const interactionSchema = z.object({
  mode: interactionModeSchema,
  promptFrame: promptFrameSchema.optional(),
  chatRounds: z.number().int().positive().default(3),
  adaptiveStopping: z.boolean().optional(),
  adversaryCommitment: z.enum(["prompted", "enforced"]).optional(),
  // Enforced sources usually endorse the focal claim. A matched truth-control
  // can instead make them repeatedly reject a false focal claim.
  fixedSourceStance: stanceLabelSchema.optional(),
  // When commitment is enforced, this exact public statement replaces the
  // persistent-source model's generated wording. Keeping it in the condition
  // file makes message-content manipulations explicit and auditable.
  fixedSourceMessage: z.string().min(1).optional(),
  // Bounded task chat uses one speaker per turn. The database retains the
  // full trace, while these limits control only what later agents can see.
  // The same visibility limit is also used by claim-debate ablations that
  // retain every message for auditing but expose only the most recent ones.
  maxStoredMessages: z.number().int().positive().optional(),
  maxVisibleMessages: z.number().int().positive().optional(),
  // Claim-debate normally shows uncertain messages. Mechanism experiments
  // can hide them from later speakers without deleting them from the trace.
  hideUncertainMessages: z.boolean().default(false),
  maxMessageWords: z.number().int().positive().optional(),
  topology: topologySchema,
  chatStyle: chatStyleSchema,
  collusion: collusionSchema,
}).default({
  mode: "memory",
  chatRounds: 3,
  adaptiveStopping: true,
  adversaryCommitment: "prompted",
  fixedSourceStance: "endorse",
  topology: "fully-connected",
  chatStyle: "claim-debate",
  collusion: {
    strategy: "none",
    visibility: "hidden",
    omitContraryEvidence: false,
    repeatSupportiveEvidence: false,
  },
});

export const conditionSchema = z.object({
  id: z.string(),
  title: z.string(),
  provenance: provenanceSchema.optional(),
  citations: citationBundleSchema.optional(),
  memory: z.object({
    mode: memoryModeSchema,
    record: memoryRecordSchema,
    maxRetrievedEntries: z.number().int().positive(),
    // Persistence follow-ups can begin under shared memory and then remove
    // access to the group record. In the personal phase, an agent can retrieve
    // only entries that it wrote itself, including its earlier shared entries.
    personalFromStep: z.number().int().positive().optional(),
    // A stricter control removes both the record and the agent's own previous
    // answer from the prompt. It tests the same follow-up turns with no history.
    noHistoryFromStep: z.number().int().positive().optional(),
    // Entries-only follow-ups retain personal record retrieval while omitting
    // the separate sentence that states the agent's immediately prior answer.
    // Undefined preserves the existing prompt in every legacy condition.
    omitPriorBeliefFromStep: z.number().int().positive().optional(),
    // Reminder-only follow-ups retain the sentence stating the agent's prior
    // judgment and confidence while hiding every stored memory entry.
    reminderOnlyFromStep: z.number().int().positive().optional(),
    // Standard shared memory omits uncertain judgments. Follow-up conditions
    // can opt in to saving them without changing the agent prompts.
    writeUncertainAnswers: z.boolean().default(false),
    // Confidence-display ablations keep the stored judgment and the agent's
    // required confidence output unchanged, but can hide numeric confidence
    // scores when saved entries are shown on later turns.
    showConfidenceScores: z.boolean().default(true),
    // Reply conditions expose stable IDs for the entries retrieved on this
    // turn and let the model identify which entries its response addresses.
    // The engine accepts only IDs that were actually retrieved.
    allowEntryReplies: z.boolean().default(false),
    // Opaque, run-local labels (e1, e2, ...) can be shown independently of
    // the reply affordance. This permits an ID-visible matched control without
    // leaking internal run, condition, order, or seed metadata.
    showOpaqueEntryIds: z.boolean().default(false),
    // When enabled, explicit reply links stored on an entry are shown to later
    // readers. Keeping this separate from allowEntryReplies distinguishes the
    // act of replying from downstream visibility of that dependency.
    renderReplyLinks: z.boolean().default(false),
    // Undefined preserves the legacy append-only record. New bounded-record
    // studies opt in explicitly so their capacity can be audited.
    maxStoredEntries: z.number().int().positive().optional(),
    evictionPolicy: memoryEvictionPolicySchema.optional(),
    reservedSourceEntries: z.number().int().nonnegative().optional(),
    // Shared records normally retain statements after their author leaves.
    // Exit-persistence studies can remove those statements at departure while
    // holding the rest of the memory condition fixed.
    departedAgentEntries: z.enum(["retain", "remove"]).default("retain"),
    decay: decaySchema,
  }),
  interaction: interactionSchema,
  interventions: z.object({
    correctionVisibility: correctionVisibilitySchema,
    verification: verificationSchema,
    correctionTiming: correctionTimingSchema.default("default"),
    correctionStrength: correctionStrengthSchema,
    // Count the turn on which the correction first appears. This lets early
    // and late corrections receive exactly the same number of response turns.
    stopAfterCorrectionTurns: z.number().int().positive().optional(),
  }),
}).superRefine((condition, ctx) => {
  const transitionModes = [
    condition.memory.personalFromStep,
    condition.memory.noHistoryFromStep,
    condition.memory.reminderOnlyFromStep,
  ].filter((step) => step !== undefined);
  if (transitionModes.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["memory"],
      message: "personalFromStep, noHistoryFromStep, and reminderOnlyFromStep are mutually exclusive",
    });
  }
});

export const agentSpecSchema = z.object({
  id: z.string(),
  role: z.string(),
  model: z.string(),
  positiveEvidenceWeight: z.number().positive(),
  negativeEvidenceWeight: z.number().positive(),
  socialWeight: z.number().min(0),
  falseClaimBias: z.number(),
  // A temporary, explicit false statement from an otherwise neutral agent.
  // A mistaken seed is represented by scenario.initialBeliefStates instead.
  seedStatementPolicy: z.object({
    kind: z.literal("informed_false_statement"),
    claimId: z.string(),
    targetStance: z.enum(["endorse", "reject"]),
    fromStep: z.number().int().positive().default(1),
    untilStep: z.number().int().positive().default(1),
  }).optional(),
  correctionTrust: z.number(),
  writesMemoryThreshold: z.number().min(0).max(1),
  activeFromStep: z.number().int().positive().default(1),
  activeUntilStep: z.number().int().positive().optional(),
  canWriteMemory: z.boolean().default(true),
});

export const runConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenarioPath: z.string(),
  conditionPath: z.string(),
  seed: z.number().int().nonnegative(),
  maxSteps: z.number().int().positive(),
  budget: z.object({
    maxModelCalls: z.number().int().positive(),
    maxInputTokensPerCall: z.number().int().positive().optional(),
    maxOutputTokensPerCall: z.number().int().positive().optional(),
    maxTokensPerRun: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  }),
  agents: z.array(agentSpecSchema).min(1),
  outputDir: z.string(),
  // When supplied, this replaces seed-based rotation. It is required for
  // experiments where the timing of private signals is a manipulated variable.
  turnOrder: z.array(z.string()).min(1).optional(),
});

export type TruthLabel = z.infer<typeof truthLabelSchema>;
export type StanceLabel = z.infer<typeof stanceLabelSchema>;
export type MemoryMode = z.infer<typeof memoryModeSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type RunConfig = z.infer<typeof runConfigSchema>;
export type InitialBeliefState = z.infer<typeof initialBeliefStateSchema>;
export type InitialMemoryEntry = z.infer<typeof initialMemoryEntrySchema>;
export type EvidenceSpec = z.infer<typeof evidenceSchema>;
export type GroupDecision = z.infer<typeof groupDecisionSchema>;
export type TaskProtocol = z.infer<typeof taskProtocolSchema>;

export type InteractionMode = z.infer<typeof interactionModeSchema>;
export type PromptFrame = z.infer<typeof promptFrameSchema>;
export type Topology = z.infer<typeof topologySchema>;
export type ChatStyle = z.infer<typeof chatStyleSchema>;
export type ScenarioType = z.infer<typeof scenarioTypeSchema>;
export type DiscussionMessageType = z.infer<typeof discussionMessageTypeSchema>;
export type MechanismFamily = z.infer<typeof mechanismFamilySchema>;
export type CitationRef = z.infer<typeof citationRefSchema>;
export type CitationBundle = z.infer<typeof citationBundleSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type CorrectionTiming = z.infer<typeof correctionTimingSchema>;

export function resolvePromptFrame(
  interaction: { mode: InteractionMode; promptFrame?: PromptFrame },
): PromptFrame {
  return interaction.promptFrame
    ?? (interaction.mode === "chat" ? "live_discussion" : "memory_assessment");
}

export type ChatMessage = {
  round: number;
  agentId: string;
  claimId: string;
  text: string;
  messageType?: DiscussionMessageType | null;
  stance: StanceLabel | null;
  confidence: number | null;
  citedSourceIds?: string[];
  referencedClaimIds?: string[];
};

export type MemoryEntry = {
  id: string;
  opaqueId?: string;
  step: number;
  agentId: string;
  claimId: string;
  stance: StanceLabel;
  confidence: number;
  visibility: "shared" | "personal";
  sourceType: "seed" | "agent" | "evidence" | "mixed";
  text: string;
  derivedFromEntryId?: string;
  repliedToEntryIds?: string[];
  repliedToOpaqueEntryIds?: string[];
};

export type BeliefStateRecord = {
  runId: string;
  step: number;
  agentId: string;
  claimId: string;
  truthLabel: TruthLabel;
  stance: StanceLabel;
  score: number;
  confidence: number;
};

export type StepEvent = {
  runId: string;
  step: number;
  agentId: string;
  claimId: string;
  eventType: "agent_step";
  retrievedMemoryIds: string[];
  repliedMemoryEntryIds: string[];
  activeInterventionIds: string[];
  writtenMemoryEntryId: string | null;
  focusClaimStance: StanceLabel;
};

export type RetrievalTrace = {
  runId: string;
  step: number;
  agentId: string;
  claimId: string;
  retrievedEntryIds: string[];
  context: Record<string, unknown>;
};

export type StepMetrics = {
  runId: string;
  step: number;
  focusAgentCount: number;
  falseClaimEndorsementRate: number;
  confidenceWeightedFalseEndorsement: number;
  falseClaimRejectRate: number;
  uncertainRate: number;
  distanceFromGroundTruth: number;
  diversityRetention: number;
  endorseShare: number;
  rejectShare: number;
  uncertainShare: number;
  majorityStance: StanceLabel;
  consensusStrength: number;
  majorityMargin: number;
  netEndorsement: number;
  meanConfidence: number;
  disagreementLevel: number;
  honestFalseEndorsementRate: number;
  honestEndorseCount: number;
  honestAgentCount: number;
  corroborationInflation: number | null;
};

export type RunSummary = {
  runId: string;
  configId: string;
  conditionId: string;
  scenarioId: string;
  memoryMode: MemoryMode;
  interactionMode: InteractionMode;
  topology: Topology;
  agentCount: number;
  claimCount: number;
  correctionCount: number;
  maxSteps: number;
  completedSteps: number;
  falseClaimEndorsementRate: number;
  honestFalseEndorsementRate: number;
  finalCorroborationInflation: number | null;
  finalConfidenceWeightedFalseEndorsement: number;
  finalFalseClaimRejectRate: number;
  finalUncertainRate: number;
  peakFalseClaimEndorsementRate: number;
  peakConfidenceWeightedFalseEndorsement: number;
  timeToMajorityAdoption: number | null;
  timeToCorrection: number | null;
  distanceFromGroundTruth: number;
  recoveryAfterCorrection: number;
  postCorrectionPersistence: number;
  diversityRetention: number;
  trajectory: {
    finalMajorityStance: StanceLabel;
    finalConsensusStrength: number;
    peakConsensusStrength: number;
    lowestConsensusStrength: number;
    finalNetEndorsement: number;
    finalMeanConfidence: number;
  };
  physics: {
    predictedRegime: string | null;
    actualRegime: string | null;
    regimeMatch: boolean | null;
    extendedModelImprovement: number | null;
    truthAsymmetryRatio: number | null;
    groupArchetype: string | null;
    criticalTemperature: number | null;
    correctionEffect: number | null;
    correctionSurprise: number | null;
  } | null;
  evaluation?: {
    focusClaimAccuracy: number | null;
    citationFidelity: number | null;
    citedMessageRate: number;
    sourceCoverage: number | null;
    earlyConsensusPeak: number;
    prematureConsensusRisk: number;
    prematureConsensusFlag: boolean;
  } | null;
  groupDecision?: {
    candidateClaimIds: string[];
    correctClaimId: string;
    selectedClaimId: string | null;
    correct: boolean;
    tied: boolean;
    margin: number;
    candidateSupport: Record<string, number>;
    retrievalSupport: {
      supportingAgents: number;
      agentsRetrievingSharedConclusions: number;
      agentsRetrievingSharedEvidence: number;
      detachedSupportAgents: number;
      detachedSupportRate: number | null;
    } | null;
    sourceGrounding: {
      requiredSourceIds: string[];
      finalSupporterCount: number;
      availableRequiredSourceIds: string[];
      citedRequiredSourceIds: string[];
      sourceCoverage: number;
      citationCoverage: number;
      correctAndGrounded: boolean;
    } | null;
  } | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
  } | null;
  dbPath: string;
};
