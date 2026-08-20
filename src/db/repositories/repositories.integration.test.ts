import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase, runInTransaction } from "@/db/client";
import { FacebookOperationRepository } from "./facebook-operation-repository";
import { PageCredentialRepository } from "./page-credential-repository";
import { PageRepository } from "./page-repository";
import { PostRepository } from "./post-repository";
import { encryptToken } from "@/lib/crypto/token-crypto";

const integrationEnabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!integrationEnabled)("database repositories", () => {
  afterAll(async () => {
    await closeDatabase();
  });

  it("persists related records and rolls the complete unit of work back", async () => {
    const externalPageId = `integration-${randomUUID()}`;
    const rollbackSignal = new Error("EXPECTED_TEST_ROLLBACK");

    await expect(
      runInTransaction(async (transaction) => {
        const pageRepository = new PageRepository(transaction);
        const credentialRepository = new PageCredentialRepository(transaction);
        const postRepository = new PostRepository(transaction);
        const operationRepository = new FacebookOperationRepository(
          transaction,
        );

        const page = await pageRepository.upsertManagedPage({
          externalPageId,
          name: "Integration Test Page",
        });
        const encrypted = encryptToken(
          "integration-page-token",
          randomBytes(32).toString("base64"),
        );
        await credentialRepository.upsert(page.id, encrypted);
        const draft = await postRepository.createDraft({
          pageId: page.id,
          message: "Integration draft",
        });
        const operation = await operationRepository.createPending({
          pageId: page.id,
          postId: draft.id,
          type: "publish_now",
        });

        expect(
          (await credentialRepository.findByPageId(page.id))
            ?.accessTokenCiphertext,
        ).not.toEqual(Buffer.from("integration-page-token"));
        expect(operation.status).toBe("pending");
        throw rollbackSignal;
      }),
    ).rejects.toBe(rollbackSignal);

    const pageAfterRollback = await new PageRepository(
      getDatabase(),
    ).findByExternalId(externalPageId);
    expect(pageAfterRollback).toBeUndefined();
  });
});
