import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { OpenAiCompatibleProvider } from "./openai-compatible";

describe("OpenAiCompatibleProvider", () => {
  it("normalizes a successful OpenAI-compatible response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"options":[]}' } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
        { headers: { "x-request-id": "safe-id" } },
      ),
    );
    const result = await new OpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "not-returned",
      fetcher,
    }).generateText({
      model: "text-model",
      messages: [{ role: "user", content: "brief" }],
    });
    expect(result).toMatchObject({
      text: '{"options":[]}',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      providerRequestId: "safe-id",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/chat/completions",
    );
  });
  it("maps provider authentication and malformed output without exposing secrets", async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "https://api.example.test/v1",
      apiKey: "never-exposed",
      fetcher: vi.fn().mockResolvedValue(new Response("no", { status: 401 })),
    });
    await expect(
      provider.generateText({ model: "m", messages: [] }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_AUTH_FAILED",
    } satisfies Partial<AppError>);
  });
  it("rejects unsafe provider base URLs", async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "https://key@example.test/v1",
      apiKey: "x",
    });
    await expect(
      provider.generateText({ model: "m", messages: [] }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_URL_INVALID",
    } satisfies Partial<AppError>);
  });
});
