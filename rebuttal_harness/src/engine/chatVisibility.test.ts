import { describe, expect, it } from "vitest";

import type { ChatMessage, Condition } from "../config/schema";
import { applyClaimDebateVisibility } from "./chat";

function condition(hideUncertainMessages: boolean, maxVisibleMessages?: number) {
  return {
    interaction: { hideUncertainMessages, maxVisibleMessages },
  } as Pick<Condition, "interaction">;
}

const messages: ChatMessage[] = Array.from({ length: 9 }, (_, index) => ({
  round: 1,
  agentId: `analyst_${index + 1}`,
  claimId: "claim_ego_depletion",
  text: `message ${index + 1}`,
  stance: index % 3 === 1 ? "uncertain" : index % 3 === 2 ? "reject" : "endorse",
  confidence: 0.8,
}));

describe("claim-debate message visibility", () => {
  it("preserves the standard full debate transcript", () => {
    expect(applyClaimDebateVisibility(messages, condition(false))).toEqual(messages);
  });

  it("hides uncertain messages while retaining all decisive messages", () => {
    const visible = applyClaimDebateVisibility(messages, condition(true));
    expect(visible).toHaveLength(6);
    expect(visible.every((message) => message.stance !== "uncertain")).toBe(true);
  });

  it("shows only the six most recent messages", () => {
    expect(applyClaimDebateVisibility(messages, condition(false, 6)))
      .toEqual(messages.slice(-6));
  });

  it("filters uncertainty before applying the six-message window", () => {
    const visible = applyClaimDebateVisibility(messages, condition(true, 6));
    expect(visible).toHaveLength(6);
    expect(visible.map((message) => message.text)).toEqual([
      "message 1", "message 3", "message 4", "message 6", "message 7", "message 9",
    ]);
  });
});
