import "server-only";

import { getServerEnv, requireServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/errors/app-error";

export type FacebookConnectConfig = {
  appId: string;
  appSecret: string;
  graphVersion: string;
  redirectUri: string;
};

export function getFacebookConnectSiteUrl(): URL {
  const env = getServerEnv();
  let siteUrl: URL;
  try {
    siteUrl = new URL(requireServerEnv("NEXT_PUBLIC_SITE_URL"));
  } catch {
    throw new AppError({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
      message: "Facebook connect callback không hợp lệ.",
      status: 500,
    });
  }
  if (
    siteUrl.username ||
    siteUrl.password ||
    !["http:", "https:"].includes(siteUrl.protocol) ||
    (env.NODE_ENV === "production" && siteUrl.protocol !== "https:")
  ) {
    throw new AppError({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
      message: "Facebook connect public site URL không hợp lệ.",
      status: 500,
    });
  }
  return siteUrl;
}

export function getFacebookConnectConfig(): FacebookConnectConfig {
  const env = getServerEnv();
  const appId = requireServerEnv("FACEBOOK_CONNECT_APP_ID");
  if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_ID === appId) {
    throw new AppError({
      code: "FACEBOOK_CONNECT_APP_NOT_DISTINCT",
      message: "Meta App kết nối cá nhân phải khác Meta App admin-managed.",
      status: 500,
    });
  }
  const siteUrl = getFacebookConnectSiteUrl();
  let configured: URL;
  try {
    const expectedRedirect = new URL("/api/facebook/callback", siteUrl);
    configured = env.FACEBOOK_CONNECT_REDIRECT_URI
      ? new URL(env.FACEBOOK_CONNECT_REDIRECT_URI)
      : expectedRedirect;
  } catch {
    throw new AppError({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
      message: "Facebook connect callback không hợp lệ.",
      status: 500,
    });
  }
  const expectedRedirect = new URL("/api/facebook/callback", siteUrl);
  if (
    configured.username ||
    configured.password ||
    (env.NODE_ENV === "production" && configured.protocol !== "https:") ||
    configured.origin !== siteUrl.origin ||
    configured.pathname !== expectedRedirect.pathname ||
    configured.search ||
    configured.hash
  ) {
    throw new AppError({
      code: "FACEBOOK_CONNECT_REDIRECT_URI_INVALID",
      message: "Facebook connect callback không khớp public site URL.",
      status: 500,
    });
  }
  return {
    appId,
    appSecret: requireServerEnv("FACEBOOK_CONNECT_APP_SECRET"),
    graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
    redirectUri: configured.toString(),
  };
}
