import "server-only";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AiRepository } from "@/db/repositories/ai-repository";
import { aiGenerations } from "@/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { getTokenKeyring } from "@/lib/crypto/token-keyring";
import { AppError } from "@/lib/errors/app-error";
import { PageAccessService } from "@/modules/auth/page-access-service";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible";

export const captionInputSchema = z
  .object({
    pageId: z.uuid(),
    topic: z.string().trim().min(3).max(1000),
    productOrService: z.string().trim().max(500).optional(),
    audience: z.string().trim().max(300).optional(),
    goal: z.string().trim().min(2).max(200),
    tone: z.string().trim().min(2).max(100),
    length: z.enum(["short", "medium", "long"]),
    ctaPreference: z.string().trim().max(200).optional(),
    hashtagPreference: z.string().trim().max(200).optional(),
    optionCount: z.number().int().min(1).max(3).default(3),
  })
  .strict();
export type CaptionInput = z.output<typeof captionInputSchema>;
const outputSchema = z
  .object({
    options: z
      .array(
        z.object({
          caption: z.string().trim().min(1).max(5000),
          hashtags: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .default([]),
          label: z.string().trim().min(1).max(100),
        }),
      )
      .min(1)
      .max(3),
  })
  .strict();

export class CaptionService {
  async generate(actor: Viewer, input: CaptionInput) {
    await new PageAccessService().assertAccess(actor, input.pageId);
    const database = getDatabase();
    const repository = new AiRepository(database);
    const binding = await repository.resolveCaptionBinding();
    if (!binding || binding.model.modality !== "text")
      throw new AppError({
        code: "AI_CAPTION_NOT_CONFIGURED",
        message: "Admin chưa cấu hình model tạo caption.",
        status: 409,
      });
    if (
      !binding.provider.apiKeyCiphertext ||
      !binding.provider.apiKeyNonce ||
      !binding.provider.apiKeyAuthTag ||
      !binding.provider.apiKeyVersion
    )
      throw new AppError({
        code: "AI_PROVIDER_KEY_MISSING",
        message: "Provider AI chưa có API key hợp lệ.",
        status: 409,
      });
    let apiKey: string;
    try {
      apiKey = getTokenKeyring().decrypt({
        ciphertext: binding.provider.apiKeyCiphertext,
        nonce: binding.provider.apiKeyNonce,
        authTag: binding.provider.apiKeyAuthTag,
        keyVersion: binding.provider.apiKeyVersion,
        fingerprint: binding.provider.apiKeyFingerprint ?? "",
      });
    } catch {
      throw new AppError({
        code: "AI_PROVIDER_CREDENTIAL_UNAVAILABLE",
        message: "Provider AI hiện không khả dụng.",
        status: 503,
      });
    }
    const safeInput = {
      topic: input.topic,
      productOrService: input.productOrService,
      audience: input.audience,
      goal: input.goal,
      tone: input.tone,
      length: input.length,
      ctaPreference: input.ctaPreference,
      hashtagPreference: input.hashtagPreference,
      optionCount: input.optionCount,
    };
    const startedAt = Date.now();
    try {
      const result = await new OpenAiCompatibleProvider({
        baseUrl: binding.provider.baseUrl,
        apiKey,
      }).generateText({
        model: binding.model.remoteModelId,
        temperature: Number(binding.binding.settings.temperature ?? 0.7),
        maxTokens: Number(binding.binding.settings.maxTokens ?? 900),
        messages: [
          {
            role: "system",
            content:
              "Return JSON only: {options:[{label,caption,hashtags}]}. Write Facebook captions in Vietnamese. Never include secrets.",
          },
          { role: "user", content: JSON.stringify(safeInput) },
        ],
      });
      let output: z.output<typeof outputSchema>;
      try {
        output = outputSchema.parse(JSON.parse(result.text));
      } catch {
        throw new AppError({
          code: "AI_CAPTION_MALFORMED_OUTPUT",
          message: "Provider AI trả về caption không đúng định dạng.",
          status: 502,
        });
      }
      if (output.options.length > input.optionCount)
        output.options = output.options.slice(0, input.optionCount);
      await database.insert(aiGenerations).values({
        actorUserId: actor.id,
        pageId: input.pageId,
        generationType: "caption",
        providerId: binding.provider.id,
        modelId: binding.model.id,
        provider: binding.provider.name,
        model: binding.model.remoteModelId,
        templateVersion: "facebook-caption-v1",
        inputData: safeInput,
        outputText: output.options.map((option) => option.caption).join("\n\n"),
        outputData: output,
        usageData: result.usage,
        status: "succeeded",
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      await database.insert(aiGenerations).values({
        actorUserId: actor.id,
        pageId: input.pageId,
        generationType: "caption",
        providerId: binding.provider.id,
        modelId: binding.model.id,
        provider: binding.provider.name,
        model: binding.model.remoteModelId,
        templateVersion: "facebook-caption-v1",
        inputData: safeInput,
        usageData: {},
        status: "failed",
        error: {
          code: error instanceof AppError ? error.code : "AI_GENERATION_FAILED",
        },
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}
