import "server-only";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { PageCredentialRepository } from "@/db/repositories/page-credential-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { AppError } from "@/lib/errors/app-error";
import { MetaGraphClient } from "./meta-client";
import {
  createMetaClientFromCredential,
  toStoredPageToken,
  type StoredPageToken,
} from "./page-credential";

export const remotePostKindSchema = z.enum(["published", "scheduled"]);

export type RemotePostKind = z.infer<typeof remotePostKindSchema>;

export type RemoteFacebookPost = {
  localPostId: string | null;
  remoteId: string;
  kind: RemotePostKind;
  message: string;
  effectiveAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  permalinkUrl: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  remoteMediaIds: string[];
  mediaType: "text" | "image" | "video";
  engagement: {
    reactions: number;
    comments: number;
    shares: number;
  } | null;
  source: "facebook";
};

export type RemotePostPage = {
  id: string;
  externalPageId: string;
  name: string;
  avatarUrl: string | null;
  timezone: string | null;
};

export type RemotePostAccess = {
  load(localPageId: string): Promise<{
    page: RemotePostPage;
    pageCredential: StoredPageToken;
  }>;
};

export type RemotePostMetaClient = Pick<
  MetaGraphClient,
  "getPublishedPosts" | "getScheduledPosts"
>;

class DatabaseRemotePostAccess implements RemotePostAccess {
  async load(localPageId: string) {
    const database = getDatabase();
    const page = await new PageRepository(database).findById(localPageId);
    if (!page || !page.isActive || page.connectionStatus !== "active") {
      throw new AppError({
        code: "PAGE_NOT_ACTIVE",
        message: "Page chưa sẵn sàng để đọc bài viết.",
        status: 409,
      });
    }

    const credential = await new PageCredentialRepository(
      database,
    ).findByPageId(page.id);
    if (
      !credential ||
      credential.revokedAt ||
      (credential.expiresAt && credential.expiresAt <= new Date())
    ) {
      throw new AppError({
        code: "PAGE_CREDENTIAL_MISSING",
        message: "Page chưa có credential hợp lệ.",
        status: 409,
      });
    }

    return {
      page: {
        id: page.id,
        externalPageId: page.externalPageId,
        name: page.name,
        avatarUrl: page.avatarUrl,
        timezone: page.timezone,
      },
      pageCredential: toStoredPageToken(credential),
    };
  }
}

function toIsoDate(value?: string | number): string | null {
  if (value === undefined || value === "") return null;

  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric * 1000)
    : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getImageUrls(post: {
  full_picture?: string;
  attachments?: {
    data: Array<{
      media?: { image?: { src: string } };
      subattachments?: {
        data: Array<{ media?: { image?: { src: string } } }>;
      };
    }>;
  };
}): string[] {
  const rootAttachments = post.attachments?.data ?? [];
  const nestedAttachments = rootAttachments.flatMap(
    (attachment) => attachment.subattachments?.data ?? [],
  );
  const attachments =
    nestedAttachments.length > 0 ? nestedAttachments : rootAttachments;
  const urls = attachments.flatMap((attachment) =>
    attachment.media?.image?.src ? [attachment.media.image.src] : [],
  );
  if (urls.length === 0 && post.full_picture) urls.push(post.full_picture);
  return [...new Set(urls)];
}

function getMediaType(post: {
  full_picture?: string;
  attachments?: {
    data: Array<{
      media_type?: string;
      subattachments?: { data: Array<{ media_type?: string }> };
    }>;
  };
}): RemoteFacebookPost["mediaType"] {
  const attachments = post.attachments?.data ?? [];
  const mediaTypes = attachments.flatMap((attachment) => [
    attachment.media_type,
    ...(attachment.subattachments?.data.map((item) => item.media_type) ?? []),
  ]);
  if (mediaTypes.some((value) => value?.toLowerCase().includes("video"))) {
    return "video";
  }
  return post.full_picture || attachments.length > 0 ? "image" : "text";
}

function getRemoteMediaIds(post: {
  attachments?: {
    data: Array<{
      target?: { id: string };
      subattachments?: { data: Array<{ target?: { id: string } }> };
    }>;
  };
}): string[] {
  const ids = (post.attachments?.data ?? []).flatMap((attachment) => [
    ...(attachment.target?.id ? [attachment.target.id] : []),
    ...(attachment.subattachments?.data.flatMap((item) =>
      item.target?.id ? [item.target.id] : [],
    ) ?? []),
  ]);

  return [...new Set(ids)];
}

export class RemotePostReader {
  constructor(
    private readonly access: RemotePostAccess = new DatabaseRemotePostAccess(),
    private readonly clientFactory: (
      credential: StoredPageToken,
    ) => RemotePostMetaClient = createMetaClientFromCredential,
  ) {}

  async list(input: {
    localPageId: string;
    kind: RemotePostKind;
    after?: string;
    limit?: number;
    window?: { since: Date; until: Date };
  }): Promise<{
    page: RemotePostPage;
    posts: RemoteFacebookPost[];
    after: string | null;
    fetchedAt: string;
  }> {
    const localPageId = z.uuid().parse(input.localPageId);
    const kind = remotePostKindSchema.parse(input.kind);
    const after = input.after
      ? z.string().trim().min(1).max(2048).parse(input.after)
      : undefined;
    const context = await this.access.load(localPageId);
    const client = this.clientFactory(context.pageCredential);

    if (kind === "scheduled") {
      const result = input.limit
        ? await client.getScheduledPosts(
            context.page.externalPageId,
            after,
            input.limit,
          )
        : await client.getScheduledPosts(context.page.externalPageId, after);

      return {
        page: context.page,
        posts: result.posts.map((post) => {
          const imageUrls = getImageUrls(post);
          return {
            localPostId: null,
            remoteId: post.id,
            kind,
            message: post.message ?? "",
            effectiveAt: toIsoDate(post.scheduled_publish_time),
            createdAt: toIsoDate(post.created_time),
            updatedAt: null,
            permalinkUrl: null,
            imageUrl: imageUrls[0] ?? null,
            imageUrls,
            remoteMediaIds: getRemoteMediaIds(post),
            mediaType: getMediaType(post),
            engagement: null,
            source: "facebook",
          };
        }),
        after: result.after ?? null,
        fetchedAt: new Date().toISOString(),
      };
    }

    const result =
      input.limit || input.window
        ? await client.getPublishedPosts(
            context.page.externalPageId,
            after,
            input.limit ?? 50,
            input.window,
          )
        : await client.getPublishedPosts(context.page.externalPageId, after);

    return {
      page: context.page,
      posts: result.posts.map((post) => {
        const createdAt = toIsoDate(post.created_time);
        const updatedAt = toIsoDate(post.updated_time);
        const imageUrls = getImageUrls(post);

        return {
          localPostId: null,
          remoteId: post.id,
          kind,
          message: post.message ?? "",
          effectiveAt: createdAt ?? updatedAt,
          createdAt,
          updatedAt,
          permalinkUrl: post.permalink_url ?? null,
          imageUrl: imageUrls[0] ?? null,
          imageUrls,
          remoteMediaIds: getRemoteMediaIds(post),
          mediaType: getMediaType(post),
          engagement: {
            reactions: post.reactions?.summary?.total_count ?? 0,
            comments: post.comments?.summary?.total_count ?? 0,
            shares: post.shares?.count ?? 0,
          },
          source: "facebook" as const,
        };
      }),
      after: result.after ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }
}
