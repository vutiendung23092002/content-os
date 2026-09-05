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
  it("preserves bounded-reader errors and normalizes provider failures", async () => {
    const abortedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new DOMException("aborted", "AbortError"));
      },
    });
    await expect(
      new OpenAiCompatibleProvider({
        baseUrl: "https://api.example.test",
        apiKey: "secret-key",
        fetcher: vi.fn().mockResolvedValue(new Response(abortedBody)),
      }).listModels(),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT" });
    const tooLarge = new Response("x".repeat(1_000_001));
    await expect(
      new OpenAiCompatibleProvider({
        baseUrl: "https://api.example.test",
        apiKey: "secret-key",
        fetcher: vi.fn().mockResolvedValue(tooLarge),
      }).listModels(),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_RESPONSE_TOO_LARGE" });
    await expect(
      new OpenAiCompatibleProvider({
        baseUrl: "https://api.example.test",
        apiKey: "secret-key",
        fetcher: vi.fn().mockResolvedValue(new Response("{}")),
      }).listModels(),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_MALFORMED_RESPONSE" });
    await expect(
      new OpenAiCompatibleProvider({
        baseUrl: "https://api.example.test",
        apiKey: "secret-key",
        fetcher: vi
          .fn()
          .mockResolvedValue(new Response("slow down", { status: 429 })),
      }).listModels(),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_RATE_LIMITED" });
    await expect(
      new OpenAiCompatibleProvider({
        baseUrl: "https://api.example.test",
        apiKey: "secret-key",
        fetcher: vi
          .fn()
          .mockResolvedValue(new Response("failure", { status: 500 })),
      }).listModels(),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_REQUEST_FAILED" });
  });
  it("keeps JSON mode opt-in and never includes the API key in errors", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          ),
        ),
      );
    const provider = new OpenAiCompatibleProvider({
      baseUrl: "https://api.example.test",
      apiKey: "never-exposed-key",
      fetcher,
    });
    await provider.generateText({ model: "m", messages: [] });
    expect(
      JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)),
    ).not.toHaveProperty("response_format");
    await provider.generateText({
      model: "m",
      messages: [],
      responseFormat: "json_object",
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
    const failing = new OpenAiCompatibleProvider({
      baseUrl: "https://api.example.test",
      apiKey: "never-exposed-key",
      fetcher: vi.fn().mockRejectedValue(new Error("never-exposed-key")),
    });
    await expect(failing.listModels()).rejects.not.toThrow("never-exposed-key");
  });
});
