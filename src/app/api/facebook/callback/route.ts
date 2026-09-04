import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApprovedViewer } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { AppError } from "@/lib/errors/app-error";
import { getFacebookConnectSiteUrl } from "@/modules/facebook/facebook-connect-config";
import { UserFacebookConnectionService } from "@/modules/facebook/user-facebook-connection-service";

export const dynamic = "force-dynamic";

function destination(site: URL, code: "connected" | "denied" | "error") {
  const target = new URL("/pages", site);
  target.searchParams.set("facebook", code);
  return target;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let site: URL;
  try {
    site = getFacebookConnectSiteUrl();
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
  try {
    const viewer = await requireApprovedViewer();
    const state = url.searchParams.get("state") ?? "";
    const providerError = url.searchParams.get("error");
    const service = new UserFacebookConnectionService();
    if (providerError) {
      await service.rejectCallback(viewer, state);
      return NextResponse.redirect(destination(site, "denied"));
    }
    await service.complete({
      viewer,
      state,
      code: url.searchParams.get("code") ?? "",
    });
    return NextResponse.redirect(destination(site, "connected"));
  } catch (error) {
    const safeCode =
      error instanceof AppError && error.code === "FACEBOOK_OAUTH_STATE_INVALID"
        ? "denied"
        : "error";
    return NextResponse.redirect(destination(site, safeCode));
  }
}
