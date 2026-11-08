import { afterEach, describe, expect, it, vi } from "vitest";

import { callLLM } from "./client";
import type { ProviderConfig } from "./provider";

const provider = {
  type: "anthropic",
  apiKey: "test-key",
  baseUrl: "https://example.test",
  model: "claude-test",
} satisfies ProviderConfig;

const request = {
  systemPrompt: "Judge the claim.",
  userPrompt: "Is it true?",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LLM response timeouts", () => {
  it("asks Anthropic to close the connection after each response", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: null,
      json: async () => ({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    await callLLM(provider, request);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("connection")).toBe("close");
  });

  it("aborts and cancels a stalled response body before retrying", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let firstSignal: AbortSignal | undefined;
    const cancelBody = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        firstSignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          body: { cancel: cancelBody },
          json: () => new Promise<never>(() => undefined),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        body: null,
        json: async () => ({
          content: [{ type: "text", text: "retry succeeded" }],
          usage: { input_tokens: 2, output_tokens: 3 },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = callLLM(provider, request);
    await vi.advanceTimersByTimeAsync(45_000);

    expect(firstSignal?.aborted).toBe(true);
    expect(cancelBody).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_500);
    await expect(resultPromise).resolves.toMatchObject({
      text: "retry succeeded",
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
