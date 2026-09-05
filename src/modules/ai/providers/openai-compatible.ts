import "server-only";

import { AppError } from "@/lib/errors/app-error";

export type TextGenerationRequest = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object";
};

export type TextGenerationResult = {
  text: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerRequestId?: string;
};

export type RemoteModel = { id: string; metadata: Record<string, unknown> };
const MAX_RESPONSE_BYTES = 1_000_000;

function providerError(
  code: string,
  status: number,
  retryable = false,
): AppError {
  return new AppError({
    code,
    message: "Dịch vụ AI không thể hoàn tất yêu cầu.",
    status,
    retryable,
  });
}

export function normalizeProviderBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw providerError("AI_PROVIDER_URL_INVALID", 400);
  }
  if (url.username || url.password || url.search || url.hash)
    throw providerError("AI_PROVIDER_URL_INVALID", 400);
  const host = url.hostname.toLowerCase();
  if (
    process.env.NODE_ENV !== "development" &&
    (host === "localhost" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("169.254."))
  )
    throw providerError("AI_PROVIDER_URL_UNSAFE", 400);
  if (process.env.NODE_ENV !== "development" && url.protocol !== "https:")
    throw providerError("AI_PROVIDER_URL_HTTPS_REQUIRED", 400);
  return url.toString().replace(/\/$/, "");
}

export class OpenAiCompatibleProvider {
  constructor(
    private readonly input: {
      baseUrl: string;
      apiKey: string;
      fetcher?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<{
    response: Response;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.input.timeoutMs ?? 30_000,
    );
    try {
      const response = await (this.input.fetcher ?? fetch)(
        `${normalizeProviderBaseUrl(this.input.baseUrl)}${path}`,
        {
          ...init,
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.input.apiKey}`,
            "content-type": "application/json",
            ...init.headers,
          },
        },
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw providerError("AI_PROVIDER_AUTH_FAILED", 502);
        if (response.status === 429)
          throw providerError("AI_PROVIDER_RATE_LIMITED", 503, true);
        throw providerError(
          "AI_PROVIDER_REQUEST_FAILED",
          502,
          response.status >= 500,
        );
      }
      return { response, controller, timer };
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw providerError("AI_PROVIDER_TIMEOUT", 504, true);
      throw providerError("AI_PROVIDER_NETWORK_FAILED", 502, true);
    }
  }

  private async json<T>(pending: {
    response: Response;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  }): Promise<T> {
    try {
      const length = Number(pending.response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
        throw providerError("AI_PROVIDER_RESPONSE_TOO_LARGE", 502);
      const reader = pending.response.body?.getReader();
      if (!reader) throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw providerError("AI_PROVIDER_RESPONSE_TOO_LARGE", 502);
        }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw providerError("AI_PROVIDER_TIMEOUT", 504, true);
      throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
    } finally {
      clearTimeout(pending.timer);
    }
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResult> {
    const pending = await this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...(request.responseFormat
          ? { response_format: { type: request.responseFormat } }
          : {}),
      }),
    });
    let body: {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    try {
      body = await this.json(pending);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
    }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
    return {
      text,
      usage: {
        inputTokens: body.usage?.prompt_tokens,
        outputTokens: body.usage?.completion_tokens,
        totalTokens: body.usage?.total_tokens,
      },
      providerRequestId:
        pending.response.headers.get("x-request-id") ?? undefined,
    };
  }

  async listModels(): Promise<RemoteModel[]> {
    const pending = await this.request("/models", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    let body: { data?: Array<{ id?: unknown; [key: string]: unknown }> };
    try {
      body = await this.json(pending);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
    }
    if (!Array.isArray(body.data))
      throw providerError("AI_PROVIDER_MALFORMED_RESPONSE", 502);
    return body.data
      .filter(
        (item): item is { id: string; [key: string]: unknown } =>
          typeof item.id === "string" && item.id.length > 0,
      )
      .map(({ id, ...metadata }) => ({ id, metadata }));
  }
}
