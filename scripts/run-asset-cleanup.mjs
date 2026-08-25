const baseUrl = (
  process.env.FACEBOOK_CRON_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL
)?.replace(/\/$/, "");
const secret = process.env.ASSET_CLEANUP_SECRET;

if (!baseUrl) {
  throw new Error(
    "FACEBOOK_CRON_BASE_URL hoặc NEXT_PUBLIC_SITE_URL phải được cấu hình.",
  );
}
if (!secret || secret.length < 32) {
  throw new Error("ASSET_CLEANUP_SECRET phải có ít nhất 32 ký tự.");
}

try {
  const response = await fetch(`${baseUrl}/api/cron/assets/cleanup`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(4 * 60 * 1000),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(
      "/api/cron/assets/cleanup",
      response.status,
      payload?.error?.code ?? "ERROR",
    );
    process.exitCode = 1;
  } else {
    console.info(
      "/api/cron/assets/cleanup",
      payload?.result?.status ?? "completed",
    );
  }
} catch (error) {
  console.error(
    "/api/cron/assets/cleanup",
    error instanceof Error ? error.name : "REQUEST_FAILED",
  );
  process.exitCode = 1;
}
