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
  async createModel(input: {
    providerId: string;
    remoteModelId: string;
    displayName: string;
    modality: "text" | "vision" | "image";
    enabled: boolean;
    capabilities: Record<string, unknown>;
  }) {
    const [row] = await this.database
      .insert(aiModels)
      .values(input)
      .returning();
    return row;
  }
  async updateModel(
    id: string,
    input: Partial<{
      displayName: string;
      modality: "text" | "vision" | "image";
      enabled: boolean;
      capabilities: Record<string, unknown>;
    }>,
  ) {
    const [row] = await this.database
      .update(aiModels)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(aiModels.id, id))
      .returning();
    return row;
  }
  async syncModelFromProvider(input: {
    providerId: string;
    remoteModelId: string;
    providerMetadata?: Record<string, unknown>;
  }) {
    const existing = await this.findModelByRemoteId(
      input.providerId,
      input.remoteModelId,
    );
    if (!existing) {
      const [row] = await this.database
        .insert(aiModels)
        .values({
          providerId: input.providerId,
          remoteModelId: input.remoteModelId,
          displayName: input.remoteModelId,
          modality: "text",
          enabled: false,
          capabilities: {},
          providerMetadata: input.providerMetadata ?? {},
        })
        .returning();
      return { model: row, outcome: "created" as const };
    }
    if (input.providerMetadata === undefined)
      return { model: existing, outcome: "unchanged" as const };
    const providerMetadata = input.providerMetadata;
    if (
      JSON.stringify(existing.providerMetadata) ===
      JSON.stringify(providerMetadata)
    )
      return { model: existing, outcome: "unchanged" as const };
    const [row] = await this.database
      .update(aiModels)
      .set({ providerMetadata, updatedAt: new Date() })
      .where(eq(aiModels.id, existing.id))
      .returning();
    return { model: row, outcome: "updated" as const };
  }
  async listModels() {
    return this.database.select().from(aiModels);
  }
  async findModel(id: string) {
    const [row] = await this.database
      .select()
      .from(aiModels)
      .where(eq(aiModels.id, id));
    return row;
  }
  async findModelByRemoteId(providerId: string, remoteModelId: string) {
    const [row] = await this.database
      .select()
      .from(aiModels)
      .where(
        and(
          eq(aiModels.providerId, providerId),
          eq(aiModels.remoteModelId, remoteModelId),
        ),
      );
    return row;
  }
  async saveBinding(input: {
    modelId: string;
    settings: Record<string, unknown>;
    actorId: string;
  }) {
    const values = {
      task: "facebook_caption",
      modelId: input.modelId,
      settings: input.settings,
      updatedByUserId: input.actorId,
      updatedAt: new Date(),
    };
    const [row] = await this.database
      .insert(aiTaskBindings)
      .values(values)
      .onConflictDoUpdate({ target: aiTaskBindings.task, set: values })
      .returning();
    return row;
  }
  async getCaptionBinding() {
    const [row] = await this.database
      .select()
      .from(aiTaskBindings)
      .where(eq(aiTaskBindings.task, "facebook_caption"));
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
