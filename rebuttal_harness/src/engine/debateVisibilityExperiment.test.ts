import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadCondition } from "../config/load";

const root = process.cwd();
const experimentPath = path.join(root, "experiments/debate-visibility-ablation-ego-haiku-v1.json");

describe("debate visibility ablation grid", () => {
  it("defines five interleaved arms across 24 balanced orders", () => {
    const experiment = JSON.parse(fs.readFileSync(experimentPath, "utf8"));
    expect(experiment.conditions).toHaveLength(5);
    expect(experiment.rosterPaths).toHaveLength(24);
    expect(experiment.seeds).toHaveLength(1);
    expect(experiment.conditions.length * experiment.rosterPaths.length).toBe(120);
    expect(experiment.cellOrderSeed).toBeTypeOf("number");
    expect(experiment.budget.maxModelCalls).toBe(36);

    const conditions = experiment.conditions.map((relativePath: string) =>
      loadCondition(path.join(root, relativePath)));
    expect(conditions.map((item: ReturnType<typeof loadCondition>) => item.interaction.mode))
      .toEqual(["chat", "chat", "chat", "chat", "memory"]);
    expect(conditions.slice(0, 4).map((item: ReturnType<typeof loadCondition>) => ({
      hideUncertainMessages: item.interaction.hideUncertainMessages,
      maxVisibleMessages: item.interaction.maxVisibleMessages,
    }))).toEqual([
      { hideUncertainMessages: false, maxVisibleMessages: undefined },
      { hideUncertainMessages: true, maxVisibleMessages: undefined },
      { hideUncertainMessages: false, maxVisibleMessages: 6 },
      { hideUncertainMessages: true, maxVisibleMessages: 6 },
    ]);
    expect(new Set(conditions.map((item: ReturnType<typeof loadCondition>) =>
      item.interaction.fixedSourceMessage)).size).toBe(1);
  });

  it("uses 24 orders in which every identity appears twice in every position", () => {
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
        const counts = positionCounts.get(agentId) ?? Array(12).fill(0);
        counts[position] += 1;
        positionCounts.set(agentId, counts);
      }
    }
    expect(positionCounts.size).toBe(12);
    for (const counts of positionCounts.values()) expect(counts).toEqual(Array(12).fill(2));
  });
});
