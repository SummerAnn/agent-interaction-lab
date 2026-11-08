import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadCondition } from "../config/load";

const root = process.cwd();
const experimentPath = path.join(root, "experiments/content-mechanism-reply-affordance-v2.json");

describe("reply-affordance v2 confirmatory grid", () => {
  it("defines three matched, interleaved arms and 72 runs at 768 output tokens", () => {
    const experiment = JSON.parse(fs.readFileSync(experimentPath, "utf8"));
    expect(experiment.conditions).toHaveLength(3);
    expect(experiment.rosterPaths).toHaveLength(24);
    expect(experiment.seeds).toHaveLength(1);
    expect(experiment.cellOrderSeed).toBeTypeOf("number");
    expect(experiment.maxSteps).toBe(36);
    expect(experiment.budget).toMatchObject({
      maxModelCalls: 36,
      maxOutputTokensPerCall: 768,
      temperature: 0,
    });
    expect(experiment.conditions.length * experiment.rosterPaths.length * experiment.seeds.length).toBe(72);

    const conditions = experiment.conditions.map((relativePath: string) =>
      loadCondition(path.join(root, relativePath)));
    const invariantView = conditions.map((condition: ReturnType<typeof loadCondition>) => ({
      mode: condition.memory.mode,
      record: condition.memory.record,
      maxRetrievedEntries: condition.memory.maxRetrievedEntries,
      writeUncertainAnswers: condition.memory.writeUncertainAnswers,
      showOpaqueEntryIds: condition.memory.showOpaqueEntryIds,
      fixedSourceMessage: condition.interaction.fixedSourceMessage,
      fixedSourceStance: condition.interaction.fixedSourceStance,
      adversaryCommitment: condition.interaction.adversaryCommitment,
    }));
    expect(new Set(invariantView.map((value: unknown) => JSON.stringify(value))).size).toBe(1);
    expect(conditions.map((condition: ReturnType<typeof loadCondition>) => ({
      allowEntryReplies: condition.memory.allowEntryReplies,
      renderReplyLinks: condition.memory.renderReplyLinks,
    }))).toEqual([
      { allowEntryReplies: false, renderReplyLinks: false },
      { allowEntryReplies: true, renderReplyLinks: false },
      { allowEntryReplies: true, renderReplyLinks: true },
    ]);
  });

  it("uses 24 position-balanced orders without embedding order metadata in agent IDs", () => {
    const experiment = JSON.parse(fs.readFileSync(experimentPath, "utf8"));
    const seed = experiment.seeds[0] as number;
    const positionCounts = new Map<string, number[]>();
    for (const rosterPath of experiment.rosterPaths as string[]) {
      const roster = JSON.parse(fs.readFileSync(path.join(root, rosterPath), "utf8"));
      const agents = roster.agents as Array<{ id: string }>;
      const offset = seed % agents.length;
      const effectiveOrder = Array.from({ length: agents.length }, (_, index) =>
        agents[(offset + index) % agents.length].id);
      for (const [position, agentId] of effectiveOrder.entries()) {
        expect(agentId).toMatch(/^analyst_\d+$/);
        const counts = positionCounts.get(agentId) ?? Array(agents.length).fill(0);
        counts[position] += 1;
        positionCounts.set(agentId, counts);
      }
    }
    expect(positionCounts.size).toBe(12);
    for (const counts of positionCounts.values()) expect(counts).toEqual(Array(12).fill(2));
  });
});
