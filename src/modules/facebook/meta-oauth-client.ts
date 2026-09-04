import "server-only";

import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

export type MetaOauthToken = {
  accessToken: string;
  expiresIn?: number;
};

export class MetaOauthClient {
  constructor(
    private readonly options: {
      graphVersion: string;
      appId: string;
      appSecret: string;
      redirectUri: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  authorizationUrl(state: string, scopes: string[]): string {
    const version = this.options.graphVersion.startsWith("v")
      ? this.options.graphVersion
      : `v${this.options.graphVersion}`;
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: this.options.appId,
      redirect_uri: this.options.redirectUri,
      state,
      scope: scopes.join(","),
      response_type: "code",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<MetaOauthToken> {
    return this.request(
      new URLSearchParams({
        client_id: this.options.appId,
        client_secret: this.options.appSecret,
        redirect_uri: this.options.redirectUri,
        code,
      }),
    );
  }

  async exchangeLongLived(shortLivedToken: string): Promise<MetaOauthToken> {
    return this.request(
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: this.options.appId,
        client_secret: this.options.appSecret,
        fb_exchange_token: shortLivedToken,
      }),
    );
  }

  private async request(query: URLSearchParams): Promise<MetaOauthToken> {
    const version = this.options.graphVersion.startsWith("v")
      ? this.options.graphVersion
      : `v${this.options.graphVersion}`;
    const url = new URL(
      `https://graph.facebook.com/${version}/oauth/access_token`,
    );
    url.search = query.toString();
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new AppError({
        code: "FACEBOOK_OAUTH_NETWORK_ERROR",
        message: "Không thể kết nối Facebook để hoàn tất ủy quyền.",
        status: 502,
        retryable: true,
      });
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppError({
        code: "FACEBOOK_OAUTH_EXCHANGE_FAILED",
        message: "Facebook không chấp nhận mã ủy quyền.",
        status: 403,
      });
    }
    const parsed = oauthTokenSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError({
        code: "FACEBOOK_OAUTH_MALFORMED_RESPONSE",
        message: "Facebook trả về dữ liệu ủy quyền không hợp lệ.",
        status: 502,
        cause: parsed.error,
      });
    }
    return {
      accessToken: parsed.data.access_token,
      expiresIn: parsed.data.expires_in,
    };
  }
}
