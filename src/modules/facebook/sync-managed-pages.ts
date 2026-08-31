import "server-only";
import { runInTransaction } from "@/db/client";
import { FacebookConnectionRepository } from "@/db/repositories/facebook-connection-repository";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import type { EncryptedToken } from "@/lib/crypto/token-crypto";
import type { ManagedPageCredential } from "./meta-client";

export type ManagedPagesClient = {
  getManagedPages(after?: string): Promise<{
    pages: ManagedPageCredential[];
    after?: string;
  }>;
};

export type PersistableManagedPage = Omit<
  ManagedPageCredential,
  "accessToken"
> & {
  encryptedAccessToken: EncryptedToken;
};

export type SafeSyncedPage = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl?: string;
  category?: string;
  tasks: string[];
};

export type PersistManagedPages = (
  pagesToPersist: PersistableManagedPage[],
) => Promise<SafeSyncedPage[]>;

async function persistManagedPages(
  pagesToPersist: PersistableManagedPage[],
): Promise<SafeSyncedPage[]> {
  return runInTransaction(async (transaction) => {
    const pageRepository = new PageRepository(transaction);
    const credentialRepository = new PageCredentialRepository(transaction);
    const connectionRepository = new FacebookConnectionRepository(transaction);
    const safePages: SafeSyncedPage[] = [];

    for (const managedPage of pagesToPersist) {
      const page = await pageRepository.upsertManagedPage({
        externalPageId: managedPage.externalPageId,
        name: managedPage.name,
        avatarUrl: managedPage.avatarUrl,
        category: managedPage.category,
        remoteMetadata: {
          source: "managed_pages_sync",
          tasks: managedPage.tasks,
        },
      });
      await credentialRepository.upsert(
        page.id,
        managedPage.encryptedAccessToken,
      );
      safePages.push({
        id: page.id,
        externalPageId: page.externalPageId,
        name: page.name,
        avatarUrl: page.avatarUrl ?? undefined,
        category: page.category ?? undefined,
        tasks: managedPage.tasks,
      });
    }

    await pageRepository.markMissingManagedPages(
      pagesToPersist.map((page) => page.externalPageId),
    );

    await connectionRepository.markActive({
      providerMetadata: { managedPageCount: safePages.length },
    });
    return safePages;
  });
}

export async function syncManagedPages(input: {
  client: ManagedPagesClient;
  tokenEncryption: Pick<
    import("@/lib/crypto/token-keyring").TokenKeyring,
    "encrypt"
  >;
  persist?: PersistManagedPages;
}): Promise<SafeSyncedPage[]> {
  const managedPages: ManagedPageCredential[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const result = await input.client.getManagedPages(cursor);
    managedPages.push(...result.pages);
    cursor = result.after;

    if (cursor && seenCursors.has(cursor)) {
      throw new Error("Meta returned a repeated Page cursor");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  const pagesToPersist = managedPages.map(({ accessToken, ...page }) => ({
    ...page,
    encryptedAccessToken: input.tokenEncryption.encrypt(accessToken),
  }));

  return (input.persist ?? persistManagedPages)(pagesToPersist);
}
