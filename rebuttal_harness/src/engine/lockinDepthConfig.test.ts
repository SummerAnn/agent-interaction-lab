import { describe, expect, it } from "vitest";

import { conditionSchema, type BeliefStateRecord, type MemoryEntry } from "../config/schema";
import { loadCondition } from "../config/load";
import {
  priorBeliefForPrompt,
  resolveMemoryConditionForStep,
  shouldHideMemoryForStep,
} from "./backends/memoryMode";
import { retrieveMemoryEntries } from "../memory/retrieve";

function baseCondition(): any {
  return {
    id: "lockin-depth-test",
    title: "lockin depth test",
    memory: {
      mode: "shared",
      record: "agent_judgment",
      maxRetrievedEntries: 6,
    },
    interventions: {
      correctionVisibility: "global",
      correctionTiming: "none",
    },
  };
}

describe("lock-in depth condition fields", () => {
  it("accepts a shared-to-personal transition", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    const parsed = conditionSchema.parse(raw);
    expect(parsed.memory.personalFromStep).toBe(37);
    expect(parsed.memory.omitPriorBeliefFromStep).toBeUndefined();
    const previousState = {
      runId: "run",
      step: 36,
      agentId: "analyst_2",
      claimId: "claim",
      truthLabel: "false" as const,
      stance: "endorse" as const,
      score: 0.9,
      confidence: 0.9,
    };
    expect(priorBeliefForPrompt(parsed, 37, previousState)).toBe(previousState);
  });

  it("accepts a no-history transition", () => {
    const raw = baseCondition();
    raw.memory.noHistoryFromStep = 37;
    const parsed = conditionSchema.parse(raw);
    expect(parsed.memory.noHistoryFromStep).toBe(37);
  });

  it("accepts an entries-only prompt transition", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    raw.memory.omitPriorBeliefFromStep = 37;
    const parsed = conditionSchema.parse(raw);
    expect(parsed.memory.omitPriorBeliefFromStep).toBe(37);
  });

  it("accepts a reminder-only transition", () => {
    const raw = baseCondition();
    raw.memory.reminderOnlyFromStep = 37;
    const parsed = conditionSchema.parse(raw);
    expect(parsed.memory.reminderOnlyFromStep).toBe(37);
    expect(shouldHideMemoryForStep(parsed, 36)).toBe(false);
    expect(shouldHideMemoryForStep(parsed, 37)).toBe(true);
  });

  it("loads the reserved entries-only condition file", () => {
    const parsed = loadCondition(
      "conditions/lockin-entries-only-v2/shared-to-personal-entries-only-after-three-rounds.yaml",
    );
    expect(parsed.memory.personalFromStep).toBe(37);
    expect(parsed.memory.omitPriorBeliefFromStep).toBe(37);
  });

  it("loads the reminder-only condition file", () => {
    const parsed = loadCondition(
      "conditions/lockin-entries-only-v2/shared-to-reminder-only-after-three-rounds.yaml",
    );
    expect(parsed.memory.reminderOnlyFromStep).toBe(37);
    expect(parsed.memory.personalFromStep).toBeUndefined();
    expect(parsed.memory.noHistoryFromStep).toBeUndefined();
  });

  it("omits only the prior belief after the configured step", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    raw.memory.omitPriorBeliefFromStep = 37;
    const condition = conditionSchema.parse(raw);
    const previousState: BeliefStateRecord = {
      runId: "run",
      step: 36,
      agentId: "analyst_2",
      claimId: "claim",
      truthLabel: "false",
      stance: "endorse",
      score: 0.9,
      confidence: 0.9,
    };

    expect(priorBeliefForPrompt(condition, 36, previousState)).toBe(previousState);
    expect(priorBeliefForPrompt(condition, 37, previousState)).toBeNull();
  });

  it("keeps only the prior belief in the reminder-only phase", () => {
    const raw = baseCondition();
    raw.memory.reminderOnlyFromStep = 37;
    const condition = conditionSchema.parse(raw);
    const previousState: BeliefStateRecord = {
      runId: "run",
      step: 36,
      agentId: "analyst_2",
      claimId: "claim",
      truthLabel: "false",
      stance: "endorse",
      score: 0.9,
      confidence: 0.9,
    };

    expect(priorBeliefForPrompt(condition, 37, previousState)).toBe(previousState);
    expect(resolveMemoryConditionForStep(condition, 37).memory.mode).toBe("personal");
    expect(shouldHideMemoryForStep(condition, 37)).toBe(true);
  });

  it("keeps self-authored entries available in the entries-only phase", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    raw.memory.omitPriorBeliefFromStep = 37;
    const condition = conditionSchema.parse(raw);
    const entries: MemoryEntry[] = [
      {
        id: "self-entry",
        step: 30,
        agentId: "analyst_2",
        claimId: "claim",
        stance: "endorse",
        confidence: 0.8,
        visibility: "shared",
        sourceType: "agent",
        text: "self-authored entry",
      },
      {
        id: "peer-entry",
        step: 31,
        agentId: "analyst_3",
        claimId: "claim",
        stance: "reject",
        confidence: 0.8,
        visibility: "shared",
        sourceType: "agent",
        text: "peer entry",
      },
    ];

    const stepCondition = resolveMemoryConditionForStep(condition, 37);
    expect(stepCondition.memory.mode).toBe("personal");
    expect(retrieveMemoryEntries(entries, "analyst_2", "claim", stepCondition, 37)
      .map((entry) => entry.id)).toEqual(["self-entry"]);
  });

  it("rejects two transition modes on the same condition", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    raw.memory.noHistoryFromStep = 37;
    expect(() => conditionSchema.parse(raw)).toThrow(/mutually exclusive/);
  });

  it("rejects reminder-only with another transition mode", () => {
    const raw = baseCondition();
    raw.memory.personalFromStep = 37;
    raw.memory.reminderOnlyFromStep = 37;
    expect(() => conditionSchema.parse(raw)).toThrow(/mutually exclusive/);
  });

  it("accepts an equal correction follow-up limit", () => {
    const raw = baseCondition();
    raw.interventions.correctionTiming = "default";
    raw.interventions.stopAfterCorrectionTurns = 24;
    const parsed = conditionSchema.parse(raw);
    expect(parsed.interventions.stopAfterCorrectionTurns).toBe(24);
  });
});
