import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AiRepository } from "@/db/repositories/ai-repository";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    modelId: z.uuid(),
    settings: z
      .object({
        temperature: z.number().min(0).max(2).default(0.7),
        maxTokens: z.number().int().min(1).max(2000).default(900),
      })
      .strict(),
  })
  .strict();
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    await requireAdmin();
    return NextResponse.json({
      binding: await new AiRepository(getDatabase()).getCaptionBinding(),
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
export async function PUT(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const input = await parseJsonBody(request, schema);
    await assertMutationRateLimit({ actor, action: "admin:ai:configure" });
    const repo = new AiRepository(getDatabase());
    const model = await repo.findModel(input.modelId);
    if (!model || !model.enabled || model.modality !== "text")
      throw new AppError({
        code: "AI_CAPTION_MODEL_INVALID",
        message: "Model caption phải là text model đang bật.",
        status: 409,
      });
    const provider = await repo.findProvider(model.providerId);
    if (!provider?.enabled || !provider.apiKeyCiphertext)
      throw new AppError({
        code: "AI_PROVIDER_NOT_READY",
        message: "Provider AI chưa sẵn sàng.",
        status: 409,
      });
    return NextResponse.json({
      binding: await repo.saveBinding({ ...input, actorId: actor.id }),
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
