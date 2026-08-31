import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

const graphErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    type: z.string().optional(),
    message: z.string().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

const pictureSchema = z
  .object({
    data: z.object({
      url: z.string().url(),
      is_silhouette: z.boolean().optional(),
    }),
  })
  .optional();

const managedPagesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      access_token: z.string().min(1),
      category: z.string().optional(),
      picture: pictureSchema,
      tasks: z.array(z.string()).optional().default([]),
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});

const graphIdSchema = z
  .union([z.string().min(1), z.number()])
  .transform((value) => String(value));

const userProfileSchema = z.object({
  id: graphIdSchema,
  name: z.string().min(1),
  picture: pictureSchema,
});

const pageCredentialSchema = z.object({
  id: graphIdSchema,
  name: z.string().min(1),
  access_token: z.string().min(1),
  category: z.string().optional(),
  picture: pictureSchema,
});

const tokenInspectionSchema = z.object({
  data: z.object({
    app_id: graphIdSchema,
    is_valid: z.boolean(),
    type: z.string().optional(),
    user_id: graphIdSchema.optional(),
    profile_id: graphIdSchema.optional(),
    scopes: z.array(z.string()).optional().default([]),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
  }),
});

const readProbeSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});

const postMutationSchema = z.object({ id: z.string().min(1) });
const photoMutationSchema = z.object({ id: z.string().min(1) });
const updateMutationSchema = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ id: z.string().min(1) }),
]);
const deleteMutationSchema = z.object({ success: z.boolean() });
const videoPostReferenceSchema = z.object({
  post_id: z.string().min(1).optional(),
});

function parseGraphResponse<Schema extends z.ZodType>(
  schema: Schema,
  payload: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError({
      code: "FACEBOOK_MALFORMED_RESPONSE",
      message: "Meta Graph API trả về dữ liệu không hợp lệ.",
      status: 502,
      retryable: true,
      cause: result.error,
    });
  }
  return result.data;
}

const engagementEdgeSchema = z
  .object({
    summary: z
      .object({
        total_count: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .optional();

const attachmentMediaSchema = z
  .object({
    image: z.object({ src: z.string().url() }).optional(),
  })
  .optional();

const attachmentTargetSchema = z
  .object({
    id: graphIdSchema,
  })
  .optional();

const subattachmentSchema = z.object({
  media_type: z.string().optional(),
  media: attachmentMediaSchema,
  target: attachmentTargetSchema,
});

const attachmentsSchema = z
  .object({
    data: z.array(
      z.object({
        media_type: z.string().optional(),
        media: attachmentMediaSchema,
        target: attachmentTargetSchema,
        subattachments: z
          .object({ data: z.array(subattachmentSchema) })
          .optional(),
      }),
    ),
  })
  .optional();

const scheduledPostsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      message: z.string().optional(),
      scheduled_publish_time: z.union([z.number(), z.string()]).optional(),
      is_published: z.boolean().optional(),
      created_time: z.string().optional(),
      full_picture: z.string().optional(),
      attachments: attachmentsSchema,
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});

const publishedPostsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      message: z.string().optional(),
      created_time: z.string().optional(),
      updated_time: z.string().optional(),
      permalink_url: z.string().optional(),
      is_published: z.boolean().optional(),
      full_picture: z.string().optional(),
      reactions: engagementEdgeSchema,
      comments: engagementEdgeSchema,
      shares: z.object({ count: z.number().int().nonnegative() }).optional(),
      attachments: attachmentsSchema,
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
    })
    .optional(),
});

export type ManagedPageCredential = {
  externalPageId: string;
  name: string;
  accessToken: string;
  avatarUrl?: string;
  category?: string;
  tasks: string[];
};

export type MetaUserProfile = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type MetaPageCredential = {
  externalPageId: string;
  name: string;
  accessToken: string;
  avatarUrl?: string;
  category?: string;
};

export type MetaTokenInspection = {
  appId: string;
  isValid: boolean;
  type?: string;
  userId?: string;
  profileId?: string;
  scopes: string[];
  expiresAt?: number;
  dataAccessExpiresAt?: number;
};

export type MetaPageReadAccess = {
  publishedPosts: boolean;
  scheduledPosts: boolean;
};

export type MetaPostTimeWindow = {
  since: Date;
  until: Date;
};

export type MetaPostSubmissionReceipt = {
  remotePostId: string;
  remoteMediaIds: string[];
};

export type MetaClientOptions = {
  graphVersion: string;
  accessToken: string;
  baseUrl?: string;
  videoBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class MetaGraphClient {
  private readonly graphVersion: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly videoBaseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MetaClientOptions) {
    this.graphVersion = options.graphVersion.startsWith("v")
      ? options.graphVersion
      : `v${options.graphVersion}`;
    this.accessToken = options.accessToken;
    this.baseUrl = options.baseUrl ?? "https://graph.facebook.com";
    this.videoBaseUrl =
      options.videoBaseUrl ??
      (options.baseUrl ? options.baseUrl : "https://graph-video.facebook.com");
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async getManagedPages(after?: string): Promise<{
    pages: ManagedPageCredential[];
    after?: string;
  }> {
    const query = new URLSearchParams({
      fields: "id,name,access_token,category,picture.type(small),tasks",
    });
    if (after) query.set("after", after);
    const result = parseGraphResponse(
      managedPagesSchema,
      await this.request("me/accounts", { query }),
    );

    return {
      pages: result.data.map((page) => ({
        externalPageId: page.id,
        name: page.name,
        accessToken: page.access_token,
        avatarUrl: page.picture?.data.url,
        category: page.category,
        tasks: page.tasks,
      })),
      after: result.paging?.cursors?.after,
    };
  }

  async getCurrentUser(): Promise<MetaUserProfile> {
    const query = new URLSearchParams({
      fields: "id,name,picture.type(small)",
    });
    const result = parseGraphResponse(
      userProfileSchema,
      await this.request("me", { query }),
    );

    return {
      id: result.id,
      name: result.name,
      avatarUrl: result.picture?.data.url,
    };
  }

  async getPageCredential(pageId: string): Promise<MetaPageCredential> {
    const query = new URLSearchParams({
      fields: "id,name,access_token,category,picture.type(small)",
    });
    const result = parseGraphResponse(
      pageCredentialSchema,
      await this.request(encodeURIComponent(pageId), { query }),
    );

    return {
      externalPageId: result.id,
      name: result.name,
      accessToken: result.access_token,
      avatarUrl: result.picture?.data.url,
      category: result.category,
    };
  }

  async inspectCurrentToken(input: {
    appId: string;
    appSecret: string;
  }): Promise<MetaTokenInspection> {
    const query = new URLSearchParams({ input_token: this.accessToken });
    const result = parseGraphResponse(
      tokenInspectionSchema,
      await this.request("debug_token", {
        query,
        authorizationToken: `${input.appId}|${input.appSecret}`,
      }),
    ).data;

    return {
      appId: result.app_id,
      isValid: result.is_valid,
      type: result.type,
      userId: result.user_id,
      profileId: result.profile_id,
      scopes: result.scopes,
      expiresAt: result.expires_at,
      dataAccessExpiresAt: result.data_access_expires_at,
    };
  }

  async probePageReadAccess(pageId: string): Promise<MetaPageReadAccess> {
    const query = new URLSearchParams({ fields: "id", limit: "1" });

    return {
      publishedPosts: await this.probeReadEdge(
        `${encodeURIComponent(pageId)}/posts`,
        query,
      ),
      scheduledPosts: await this.probeReadEdge(
        `${encodeURIComponent(pageId)}/scheduled_posts`,
        query,
      ),
    };
  }

  async publishText(pageId: string, message: string): Promise<string> {
    const result = parseGraphResponse(
      postMutationSchema,
      await this.request(`${encodeURIComponent(pageId)}/feed`, {
        method: "POST",
        body: new URLSearchParams({ message }),
      }),
    );
    return result.id;
  }

  async publishPost(input: {
    pageId: string;
    message: string;
    mediaUrls?: string[];
  }): Promise<MetaPostSubmissionReceipt> {
    const mediaIds = await this.uploadUnpublishedPhotos(
      input.pageId,
      input.mediaUrls ?? [],
    );
    if (mediaIds.length === 0) {
      return {
        remotePostId: await this.publishText(input.pageId, input.message),
        remoteMediaIds: [],
      };
    }
    return {
      remotePostId: await this.createFeedPost({
        pageId: input.pageId,
        message: input.message,
        mediaIds,
      }),
      remoteMediaIds: mediaIds,
    };
  }

  async publishVideo(input: {
    pageId: string;
    description: string;
    fileUrl: string;
  }): Promise<string> {
    const result = parseGraphResponse(
      postMutationSchema,
      await this.request(`${encodeURIComponent(input.pageId)}/videos`, {
        method: "POST",
        baseUrl: this.videoBaseUrl,
        timeoutMs: 120_000,
        body: new URLSearchParams({
          description: input.description,
          file_url: input.fileUrl,
        }),
      }),
    );
    return result.id;
  }

  async scheduleVideo(input: {
    pageId: string;
    description: string;
    fileUrl: string;
    scheduledFor: Date;
  }): Promise<string> {
    const result = parseGraphResponse(
      postMutationSchema,
      await this.request(`${encodeURIComponent(input.pageId)}/videos`, {
        method: "POST",
        baseUrl: this.videoBaseUrl,
        timeoutMs: 120_000,
        body: new URLSearchParams({
          description: input.description,
          file_url: input.fileUrl,
          published: "false",
          scheduled_publish_time: String(
            Math.floor(input.scheduledFor.getTime() / 1000),
          ),
        }),
      }),
    );
    return result.id;
  }

  async scheduleText(
    pageId: string,
    message: string,
    scheduledFor: Date,
  ): Promise<string> {
    const result = parseGraphResponse(
      postMutationSchema,
      await this.request(`${encodeURIComponent(pageId)}/feed`, {
        method: "POST",
        body: new URLSearchParams({
          message,
          published: "false",
          scheduled_publish_time: String(
            Math.floor(scheduledFor.getTime() / 1000),
          ),
        }),
      }),
    );
    return result.id;
  }

  async schedulePost(input: {
    pageId: string;
    message: string;
    scheduledFor: Date;
    mediaUrls?: string[];
  }): Promise<MetaPostSubmissionReceipt> {
    const mediaIds = await this.uploadUnpublishedPhotos(
      input.pageId,
      input.mediaUrls ?? [],
    );
    if (mediaIds.length === 0) {
      return {
        remotePostId: await this.scheduleText(
          input.pageId,
          input.message,
          input.scheduledFor,
        ),
        remoteMediaIds: [],
      };
    }
    return {
      remotePostId: await this.createFeedPost({
        pageId: input.pageId,
        message: input.message,
        mediaIds,
        scheduledFor: input.scheduledFor,
      }),
      remoteMediaIds: mediaIds,
    };
  }

  async getScheduledPosts(pageId: string, after?: string, limit = 50) {
    const query = new URLSearchParams({
      fields:
        "id,message,scheduled_publish_time,is_published,created_time,full_picture,attachments{media_type,media,target{id},subattachments.limit(10){media_type,media,target{id}}}",
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    if (after) query.set("after", after);

    const result = parseGraphResponse(
      scheduledPostsSchema,
      await this.request(`${encodeURIComponent(pageId)}/scheduled_posts`, {
        query,
      }),
    );

    return {
      posts: result.data,
      after: result.paging?.cursors?.after,
    };
  }

  async getPublishedPosts(
    pageId: string,
    after?: string,
    limit = 50,
    window?: MetaPostTimeWindow,
  ) {
    const query = new URLSearchParams({
      fields:
        "id,message,created_time,updated_time,permalink_url,is_published,full_picture,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares,attachments{media_type,media,target{id},subattachments.limit(10){media_type,media,target{id}}}",
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    if (after) query.set("after", after);
    if (window) {
      query.set("since", String(Math.floor(window.since.getTime() / 1000)));
      query.set("until", String(Math.floor(window.until.getTime() / 1000)));
    }

    const result = parseGraphResponse(
      publishedPostsSchema,
      await this.request(`${encodeURIComponent(pageId)}/posts`, { query }),
    );

    return {
      posts: result.data,
      after: result.paging?.cursors?.after,
    };
  }

  async reschedulePost(
    remotePostId: string,
    scheduledFor: Date,
  ): Promise<void> {
    parseGraphResponse(
      updateMutationSchema,
      await this.request(encodeURIComponent(remotePostId), {
        method: "POST",
        body: new URLSearchParams({
          scheduled_publish_time: String(
            Math.floor(scheduledFor.getTime() / 1000),
          ),
        }),
      }),
    );
  }

  async updatePostMessage(
    remotePostId: string,
    message: string,
  ): Promise<void> {
    parseGraphResponse(
      updateMutationSchema,
      await this.request(encodeURIComponent(remotePostId), {
        method: "POST",
        body: new URLSearchParams({ message }),
      }),
    );
  }

  async deletePost(remotePostId: string): Promise<void> {
    const result = parseGraphResponse(
      deleteMutationSchema,
      await this.request(encodeURIComponent(remotePostId), {
        method: "DELETE",
      }),
    );

    if (!result.success) {
      throw new AppError({
        code: "FACEBOOK_DELETE_REJECTED",
        message: "Facebook không xác nhận xóa bài viết.",
        status: 502,
      });
    }
  }

  async resolveVideoPostId(videoId: string): Promise<string | null> {
    const result = parseGraphResponse(
      videoPostReferenceSchema,
      await this.request(encodeURIComponent(videoId), {
        query: new URLSearchParams({ fields: "post_id" }),
      }),
    );
    return result.post_id ?? null;
  }

  async cancelScheduledPost(remotePostId: string): Promise<void> {
    await this.deletePost(remotePostId);
  }

  private async uploadUnpublishedPhotos(
    pageId: string,
    mediaUrls: string[],
  ): Promise<string[]> {
    if (mediaUrls.length > 10) {
      throw new AppError({
        code: "FACEBOOK_MEDIA_LIMIT_EXCEEDED",
        message: "Facebook post chỉ hỗ trợ tối đa 10 ảnh trong công cụ này.",
        status: 400,
      });
    }

    return Promise.all(
      mediaUrls.map(async (url) => {
        const result = parseGraphResponse(
          photoMutationSchema,
          await this.request(`${encodeURIComponent(pageId)}/photos`, {
            method: "POST",
            body: new URLSearchParams({ url, published: "false" }),
          }),
        );
        return result.id;
      }),
    );
  }

  private async createFeedPost(input: {
    pageId: string;
    message: string;
    mediaIds: string[];
    scheduledFor?: Date;
  }): Promise<string> {
    const body = new URLSearchParams({
      message: input.message,
      attached_media: JSON.stringify(
        input.mediaIds.map((mediaFbid) => ({ media_fbid: mediaFbid })),
      ),
    });
    if (input.scheduledFor) {
      body.set("published", "false");
      body.set(
        "scheduled_publish_time",
        String(Math.floor(input.scheduledFor.getTime() / 1000)),
      );
    }
    const result = parseGraphResponse(
      postMutationSchema,
      await this.request(`${encodeURIComponent(input.pageId)}/feed`, {
        method: "POST",
        body,
      }),
    );
    return result.id;
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST" | "DELETE";
      query?: URLSearchParams;
      body?: URLSearchParams;
      authorizationToken?: string;
      baseUrl?: string;
      timeoutMs?: number;
    },
  ): Promise<unknown> {
    const url = new URL(
      `${options.baseUrl ?? this.baseUrl}/${this.graphVersion}/${path}`,
    );
    options.query?.forEach((value, key) => url.searchParams.set(key, value));

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${options.authorizationToken ?? this.accessToken}`,
          ...(options.body
            ? {
                "content-type":
                  "application/x-www-form-urlencoded;charset=UTF-8",
              }
            : {}),
        },
        body: options.body,
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      throw new AppError({
        code: "FACEBOOK_NETWORK_ERROR",
        message: "Không thể kết nối Meta Graph API.",
        status: 502,
        retryable: true,
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const graphError = graphErrorSchema.safeParse(payload);
      const code = graphError.success ? graphError.data.error.code : undefined;
      const tokenInvalid = code === 190;
      const permissionDenied = code === 10 || code === 200;

      throw new AppError({
        code: tokenInvalid
          ? "FACEBOOK_TOKEN_INVALID"
          : permissionDenied
            ? "FACEBOOK_PERMISSION_DENIED"
            : "FACEBOOK_API_ERROR",
        message: tokenInvalid
          ? "Facebook Page token đã hết hạn hoặc bị thu hồi."
          : permissionDenied
            ? "Facebook token không còn đủ quyền cho thao tác này."
            : "Meta Graph API từ chối yêu cầu.",
        status: tokenInvalid || permissionDenied ? 403 : 502,
        retryable:
          !tokenInvalid &&
          !permissionDenied &&
          (response.status === 429 || response.status >= 500),
      });
    }

    return payload;
  }

  private async probeReadEdge(
    path: string,
    query: URLSearchParams,
  ): Promise<boolean> {
    try {
      parseGraphResponse(readProbeSchema, await this.request(path, { query }));
      return true;
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "FACEBOOK_PERMISSION_DENIED"
      ) {
        return false;
      }
      throw error;
    }
  }
}
