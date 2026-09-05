import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AiRepository } from "@/db/repositories/ai-repository";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { getTokenKeyring } from "@/lib/crypto/token-keyring";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { normalizeProviderBaseUrl } from "@/modules/ai/providers/openai-compatible";
export const dynamic = "force-dynamic";
const inputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(100),
    adapterType: z.literal("openai_compatible"),
    baseUrl: z.string().trim().max(500),
    enabled: z.boolean().default(true),
    apiKey: z.string().trim().min(8).max(1000).optional(),
  })
  .strict();
function dto(provider: Awaited<ReturnType<AiRepository["findProvider"]>>) {
  return (
    provider && {
      id: provider.id,
      name: provider.name,
      adapterType: provider.adapterType,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      apiKeyConfigured: Boolean(provider.apiKeyCiphertext),
      providerMetadata: provider.providerMetadata,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }
  );
}
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    await requireAdmin();
    const providers = await new AiRepository(getDatabase()).listProviders();
    return NextResponse.json({ providers: providers.map(dto), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireSuperAdmin();
    const input = await parseJsonBody(request, inputSchema);
    await assertMutationRateLimit({ actor, action: "admin:ai:configure" });
    const provider = await new AiRepository(getDatabase()).saveProvider({
      ...input,
      baseUrl: normalizeProviderBaseUrl(input.baseUrl),
      apiKey: input.apiKey
        ? getTokenKeyring().encrypt(input.apiKey)
        : undefined,
      actorId: actor.id,
    });
    return NextResponse.json({ provider: dto(provider), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
