import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { AiRepository } from "@/db/repositories/ai-repository";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getTokenKeyring } from "@/lib/crypto/token-keyring";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertEmptyBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import {
  OpenAiCompatibleProvider,
  sanitizeProviderMetadata,
} from "@/modules/ai/providers/openai-compatible";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    // Sync decrypts a provider credential, so this endpoint is Super Admin-only.
    const actor = await requireSuperAdmin();
    await assertEmptyBody(request);
    await assertMutationRateLimit({ actor, action: "admin:ai:configure" });
    const { id } = await context.params;
    const repo = new AiRepository(getDatabase());
    const provider = await repo.findProvider(id);
    if (!provider)
      throw new AppError({
        code: "AI_PROVIDER_NOT_FOUND",
        message: "AI provider was not found.",
        status: 404,
      });
    if (!provider.enabled)
      throw new AppError({
        code: "AI_PROVIDER_NOT_AVAILABLE",
        message: "AI provider is not available.",
        status: 409,
      });
    if (
      !provider.apiKeyCiphertext ||
      !provider.apiKeyNonce ||
      !provider.apiKeyAuthTag ||
      !provider.apiKeyVersion
    )
      throw new AppError({
        code: "AI_PROVIDER_KEY_MISSING",
        message: "AI provider credentials are not configured.",
        status: 409,
      });
    let apiKey: string;
    try {
      apiKey = getTokenKeyring().decrypt({
        ciphertext: provider.apiKeyCiphertext,
        nonce: provider.apiKeyNonce,
        authTag: provider.apiKeyAuthTag,
        keyVersion: provider.apiKeyVersion,
        fingerprint: provider.apiKeyFingerprint ?? "",
      });
    } catch {
      throw new AppError({
        code: "AI_PROVIDER_CREDENTIAL_UNAVAILABLE",
        message: "AI provider credentials are unavailable.",
        status: 503,
      });
    }
    const remoteModels = await new OpenAiCompatibleProvider({
      baseUrl: provider.baseUrl,
      apiKey,
    }).listModels();
    const summary = {
      discovered: remoteModels.length,
      created: 0,
      updated: 0,
      unchanged: 0,
    };
    for (const remoteModel of remoteModels) {
      // Do not persist arbitrary upstream metadata; local fields remain admin-managed.
      const result = await repo.syncModelFromProvider({
        providerId: provider.id,
        remoteModelId: remoteModel.id,
        providerMetadata: sanitizeProviderMetadata(remoteModel.metadata),
      });
      summary[result.outcome] += 1;
    }
    return NextResponse.json({ ...summary, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
