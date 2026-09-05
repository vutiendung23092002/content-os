import "server-only";
import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { aiModels, aiProviders, aiTaskBindings } from "@/db/schema";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";

export class AiRepository {
  constructor(private readonly database: DatabaseExecutor) {}
  async listProviders() {
    return this.database.select().from(aiProviders);
  }
  async findProvider(id: string) {
    const [row] = await this.database
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, id));
    return row;
  }
  async saveProvider(input: {
    id?: string;
    name: string;
    adapterType: string;
    baseUrl: string;
    enabled: boolean;
    apiKey?: EncryptedToken;
    actorId: string;
    providerMetadata?: Record<string, unknown>;
  }) {
    const values = {
      name: input.name,
      adapterType: input.adapterType,
      baseUrl: input.baseUrl,
      enabled: input.enabled,
      providerMetadata: input.providerMetadata ?? {},
      updatedByUserId: input.actorId,
      ...(input.apiKey
        ? {
            apiKeyCiphertext: input.apiKey.ciphertext,
            apiKeyNonce: input.apiKey.nonce,
            apiKeyAuthTag: input.apiKey.authTag,
            apiKeyVersion: input.apiKey.keyVersion,
            apiKeyFingerprint: input.apiKey.fingerprint,
          }
        : {}),
    };
    if (input.id) {
      const [row] = await this.database
        .update(aiProviders)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(aiProviders.id, input.id))
        .returning();
      return row;
    }
    const [row] = await this.database
      .insert(aiProviders)
      .values({ ...values, createdByUserId: input.actorId })
      .returning();
    return row;
  }
  async upsertModel(input: {
    providerId: string;
    remoteModelId: string;
    displayName: string;
    modality?: string;
    providerMetadata?: Record<string, unknown>;
  }) {
    const values = {
      ...input,
      modality: input.modality ?? "text",
      providerMetadata: input.providerMetadata ?? {},
      updatedAt: new Date(),
    };
    const [row] = await this.database
      .insert(aiModels)
      .values(values)
      .onConflictDoUpdate({
        target: [aiModels.providerId, aiModels.remoteModelId],
        set: {
          displayName: values.displayName,
          providerMetadata: values.providerMetadata,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return row;
  }
  async resolveCaptionBinding() {
    const [row] = await this.database
      .select({
        binding: aiTaskBindings,
        model: aiModels,
        provider: aiProviders,
      })
      .from(aiTaskBindings)
      .innerJoin(aiModels, eq(aiTaskBindings.modelId, aiModels.id))
      .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
      .where(
        and(
          eq(aiTaskBindings.task, "facebook_caption"),
          eq(aiModels.enabled, true),
          eq(aiProviders.enabled, true),
        ),
      );
    return row;
  }
}
